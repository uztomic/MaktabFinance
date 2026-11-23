// =====================================================================
//  Hisoblanma (TZ 4.6).
//
//  Buxgalterning oylik sikli shu ekranda:
//
//    1. Shakllantirish  — qat'iy qatorlar + kunlik xizmatlar taxminiy
//                         summada (TZ 4.6.1 "dastlabki hisoblanma")
//    2. Ota-onalarga    — Telegram orqali xabar (TZ 4.9)
//    3. Yakunlash       — oy oxirida yo'qlik asosida qayta hisoblash
//                         (TZ 4.6.1 "yakuniy hisoblanma")
//    4. Tasdiqlash      — qulflash (TZ 4.6.7)
//
//  Hech qanday hisob-kitob brauzerda bajarilmaydi — har bir tugma
//  server funksiyasini chaqiradi (TZ 5.4.6).
// =====================================================================

import { Fragment, useMemo, useState } from 'react';
import { useConfirm } from '@/ui/Feedback';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import {
  currentPeriod, date, dateTime, type Lang, money, periodLabel, shiftPeriod,
} from '@/lib/format';
import { exportTable } from '@/lib/export';
import { MonthPicker } from '@/ui/MonthPicker';
import { PeriodLockButton } from './PeriodLock';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Money, Notice,
  PageHeader, Select, Spinner, Table, Td, Th, Tr,
} from '@/ui';

type Status = 'preliminary' | 'final' | 'approved' | 'cancelled';

/** `period_forecast` qaytaradigan ma'lumot. */
interface Forecast {
  ok: number;
  not_started: number;
  ended: number;
  left: number;
  summer: number;
  no_contract: number;
  first_period: string | null;
  expected_total: number;
  expected_tuition: number;
  expected_service: number;
  expected_discount: number;
  by_class: Array<{ class_name: string; students: number; total: number }>;
  payroll_net: number;
  payroll_runs: number;
  payroll_teachers: number;
  payroll_missing: number;
  net: number;
}

const TONE: Record<Status, 'warn' | 'brand' | 'ok' | 'neutral'> = {
  preliminary: 'warn',
  final: 'brand',
  approved: 'ok',
  cancelled: 'neutral',
};

export default function Invoices() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, can, mayWrite } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [note, setNote] = useState<string | null>(null);
  const confirm = useConfirm();
  //  Ro'yxat filtrlari — 150 qatorli ro'yxatda kerakli bolani topish uchun.
  const [q, setQ] = useState('');
  const [klass, setKlass] = useState('');
  const [statusF, setStatusF] = useState<'' | Status>('');
  const [openId, setOpenId] = useState<string | null>(null);
  //  Qadamlar paneli yopiq turadi — kundalik ishda faqat keyingi amal kerak.
  const [stepsOpen, setStepsOpen] = useState(false);

  const activeBranch = branchId ?? branches[0]?.id ?? null;
  const canRun = mayWrite('invoices.generate');

  // --- Hisoblanmalar ro'yxati ---------------------------------------
  const rows = useQuery({
    queryKey: ['invoices', activeBranch, period],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_invoice_totals')
        .select('invoice_id, student_id, branch_id, period, status, due_date, total, has_preliminary')
        .eq('branch_id', activeBranch!)
        .eq('period', period)
        .neq('status', 'cancelled');
      if (error) throw error;
      return data ?? [];
    },
  });

  // O'quvchi nomlarini alohida olamiz (ko'rinishda ular yo'q).
  const students = useQuery({
    queryKey: ['students-names', activeBranch],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, class_name, payment_code')
        .eq('branch_id', activeBranch!)
        .is('deleted_at', null);
      if (error) throw error;
      return new Map((data ?? []).map((s) => [s.id, s]));
    },
  });

  /**
   *  Oxirgi avtomatik shakllantirish.
   *
   *  NEGA KERAK: hisoblanmalar endi kechasi o'zi yaratiladi. Buni
   *  ko'rsatmasak, buxgalter ertalab tayyor ro'yxatni ko'radi va uni
   *  kim yaratganini bilmaydi — "kimdir mening nomimdan ishlayaptimi"
   *  degan shubha tug'iladi.
   */
  const autoRun = useQuery({
    queryKey: ['invoices-auto-run'],
    queryFn: async () => {
      const { data } = await supabase
        .from('school_settings')
        .select('value')
        .eq('key', 'invoices.last_auto_run')
        .maybeSingle();
      return (data?.value ?? null) as
        { period: string; at: string; created: number } | null;
    },
  });

  /**
   *  Davr prognozi: daromad sinflar kesimida, oylik va qo'lda
   *  qoladigan summa. Nega hisoblanma qurilmagani ham shu yerdan.
   *
   *  Ilgari tugma bosilganda "O'tkazib yuborildi: 227" chiqardi va
   *  tamom. Bu raqam hech narsani tushuntirmaydi: tizim buzilganmi,
   *  ma'lumot yo'qmi, yoki hammasi to'g'rimi? Sabablar esa butunlay
   *  boshqa-boshqa va har biriga boshqacha javob kerak.
   */
  const diag = useQuery({
    queryKey: ['period-forecast', activeBranch, period],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('period_forecast', {
        p_branch_id: activeBranch!, p_period: period,
      });
      if (error) throw error;
      return data as unknown as Forecast;
    },
  });

  // --- Yo'qlik bo'shliqlari — yakunlashni to'sadi (TZ 4.6.1.2) ------
  const gaps = useQuery({
    queryKey: ['absence-gaps-period', activeBranch, period],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_absence_warnings', {
        p_branch_id: activeBranch!,
        p_days_back: 45,
      });
      if (error) throw error;
      // Faqat tanlangan davrdagilar.
      const end = new Date(new Date(period).getFullYear(),
        new Date(period).getMonth() + 1, 0).toISOString().slice(0, 10);
      return (data ?? []).filter((g) => g.day >= period && g.day <= end);
    },
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['absence-gaps-period'] });
    qc.invalidateQueries({ queryKey: ['invoice-diag'] });
    qc.invalidateQueries({ queryKey: ['stale-invoices'] });
    qc.invalidateQueries({ queryKey: ['students'] });
  }

  /**
   *  ESKIRGAN HISOBLANMA.
   *
   *  Shartnoma hisoblanmadan KEYIN tuzatilsa, hisoblanma o'z-o'zidan
   *  yangilanmaydi. Bu jimgina xato: ro'yxatda hamma narsa joyida
   *  ko'rinadi, faqat bitta bolaning summasi shartnomadagidan boshqa
   *  bo'ladi.
   *
   *  Avtomatik tuzatilmaydi ham: tungi cron faqat davrda BITTA HAM
   *  hisoblanma bo'lmagan filialga yozadi — bor joyga ataylab tegmaydi,
   *  chunki qo'lda kiritilgan qatorni o'chirib yuborardi.
   *
   *  Shuning uchun KO'RSATILADI, qaror esa odamniki: "Shakllantirish"
   *  tugmasi tasdiqlanmagan hisoblanmani qayta quradi.
   */
  const stale = useQuery({
    queryKey: ['stale-invoices', activeBranch, period],
    enabled: !!activeBranch && can('reports.view'),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stale_invoices', {
        p_branch_id: activeBranch!, p_period: period,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- Amallar (hammasi server tomonda) -----------------------------
  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_invoices', {
        p_branch_id: activeBranch!, p_period: period,
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (d) => {
      refresh();
      //  Hech narsa yaratilmagan bo'lsa raqam ko'rsatishdan foyda yo'q —
      //  sababi quyidagi tashxis xabarida yoziladi.
      //  Hammasi qulflangan bo'lsa ham javob kerak — aks holda tugma
      //  "ishlamayapti" deb o'ylanadi.
      setNote(d.created + d.rebuilt === 0
        ? (d.locked > 0 ? t('inv.allLocked', { count: d.locked }) : null)
        : `${t('inv.created')}: ${d.created} · ${t('inv.rebuilt')}: ${d.rebuilt} · ` +
        `${t('inv.locked')}: ${d.locked} · ${t('inv.skipped')}: ${d.skipped}`);
    },
  });

  const finalize = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('finalize_invoices', {
        p_branch_id: activeBranch!, p_period: period,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: (d) => {
      refresh();
      setNote(`${t('inv.finalize')}: ${d.finalized} · ${d.method}`);
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('approve_invoices', {
        p_branch_id: activeBranch!, p_period: period,
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (d) => {
      refresh();
      setNote(`${t('inv.approve')}: ${d.approved}`);
    },
  });

  const notify = useMutation({
    mutationFn: async (final: boolean) => {
      const { data, error } = await supabase.rpc('notify_invoices', {
        p_branch_id: activeBranch!, p_period: period, p_final: final,
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (d) => setNote(t('inv.queued', { count: d.queued })),
  });

  const listAll = useMemo(() => (rows.data ?? []).map((r) => ({
    ...r,
    student: r.student_id ? students.data?.get(r.student_id) : undefined,
  })).sort((a, b) =>
    (a.student?.class_name ?? '').localeCompare(b.student?.class_name ?? '') ||
    (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? '')),
  [rows.data, students.data]);

  if (!can('invoices.generate')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const list = listAll;
  const counts = {
    preliminary: list.filter((r) => r.status === 'preliminary').length,
    final: list.filter((r) => r.status === 'final').length,
    approved: list.filter((r) => r.status === 'approved').length,
  };
  const classes = [...new Set(list.map((r) => r.student?.class_name).filter(Boolean) as string[])];
  const needle = q.trim().toLowerCase();
  const shown = list.filter((r) =>
    (!klass || r.student?.class_name === klass) &&
    (!statusF || r.status === statusF) &&
    (!needle || (r.student?.full_name ?? '').toLowerCase().includes(needle) ||
      (r.student?.payment_code ?? '').toLowerCase().includes(needle)));

  const total = shown.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const hasPreliminary = list.some((r) => r.has_preliminary);
  const allApproved = list.length > 0 && list.every((r) => r.status === 'approved');

  //  QAYSI QADAMDAMIZ. Ilgari 5 ta tugma bir xil ko'rinardi va
  //  buxgalter "endi nima qilaman" degan savolga javob topolmasdi.
  //  1 — hali yo'q; 2/3 — dastlabki (yuborish, so'ng oy oxirida
  //  yakunlash); 4 — yakuniy, tasdiqlash kerak; 5 — hammasi tasdiqlangan.
  const stage = list.length === 0 ? 1
    : counts.preliminary > 0 ? (period < currentPeriod() ? 3 : 2)
    : counts.final > 0 ? 4 : 5;

  const askFinalize = async () => {
    if (await confirm({
      title: t('inv.finalize'),
      message: t('inv.confirmFinalize', { count: counts.preliminary, period: periodLabel(period, lang) }),
      confirmLabel: t('inv.finalize'),
    })) finalize.mutate();
  };
  const askApprove = async () => {
    if (await confirm({
      title: t('inv.approve'),
      message: t('inv.confirmApprove', { count: list.length - counts.approved, amount: money(list.reduce((a, r) => a + Number(r.total ?? 0), 0), lang) }),
      //  Yakunlanmagan (taxminiy) hisoblanma ham tasdiqlanishi mumkin —
      //  lekin unda kunlik xizmatlar taxminiy summada qotib qoladi.
      warning: hasPreliminary
        ? `${t('inv.approveHint')} ${t('inv.approvePrelimWarn')}`
        : t('inv.approveHint'),
      confirmLabel: t('inv.approve'),
    })) approve.mutate();
  };
  const askNotify = async () => {
    if (await confirm({
      title: t('inv.notify'),
      message: t('inv.confirmNotify', { count: list.length }),
      confirmLabel: t('inv.notify'),
    })) notify.mutate(false);
  };
  const busy = generate.isPending || finalize.isPending ||
    approve.isPending || notify.isPending;

  const error = generate.error ?? finalize.error ?? approve.error ?? notify.error;

  return (
    <>
      <PageHeader
        title={t('inv.title')}
        subtitle={`${periodLabel(period, lang)} · ${t('common.showing', { count: list.length })}`}
        actions={
          <>
            <MonthPicker value={period} onChange={setPeriod}
                         max={shiftPeriod(currentPeriod(), 3)} />
            <Button
              disabled={list.length === 0}
              onClick={() => exportTable(
                `hisoblanma-${period.slice(0, 7)}`,
                [
                  { header: t('common.fullName'), value: (r) => r.student?.full_name },
                  { header: t('students.class'), value: (r) => r.student?.class_name },
                  { header: t('students.paymentCode'), value: (r) => r.student?.payment_code },
                  { header: t('common.status'), value: (r) => t(`inv.status.${r.status}`) },
                  { header: t('inv.dueDate'), value: (r) => r.due_date },
                  { header: t('common.total'), value: (r) => r.total, numeric: true },
                ],
                list,
                [t('inv.title'), periodLabel(period, lang)],
              )}
            >
              {t('common.export')}
            </Button>
          </>
        }
      />

      {/* --- Oylik sikl: qaysi qadamdasiz ----------------------------- */}
      {/*  Hisoblanma oy boshida TIZIMNING O'ZI tuzadi. Kundalik ishda
           faqat holat va keyingi bitta amal kerak — qolgan qadamlar
           "Barcha amallar" ichida. */}
      {canRun && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">{t(`inv.stage.${stage}`)}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="warn">{t('inv.status.preliminary')} · {counts.preliminary}</Badge>
                <Badge tone="brand">{t('inv.status.final')} · {counts.final}</Badge>
                <Badge tone="ok">{t('inv.status.approved')} · {counts.approved}</Badge>
                {autoRun.data?.period === period && (
                  <span className="text-[12px] text-[var(--text-faint)]">
                    {t('inv.autoShort', { date: dateTime(autoRun.data.at, lang) })}
                  </span>
                )}
              </div>
            </div>
            {stage === 1 && (
              <Button variant="primary" disabled={busy} onClick={() => generate.mutate()}>{t('inv.generate')}</Button>
            )}
            {stage === 2 && (
              <Button variant="primary" disabled={busy || list.length === 0} onClick={askNotify}>{t('inv.notify')}</Button>
            )}
            {stage === 3 && (
              <Button variant="primary" onClick={askFinalize}
                      disabled={busy || counts.preliminary === 0 || (gaps.data?.length ?? 0) > 0}>{t('inv.finalize')}</Button>
            )}
            {stage === 4 && (
              <Button variant="primary" disabled={busy || list.length === 0 || allApproved} onClick={askApprove}>{t('inv.approve')}</Button>
            )}
            <Button variant="ghost" onClick={() => setStepsOpen((o) => !o)}>
              {stepsOpen ? t('inv.hide') : t('inv.allSteps')}
            </Button>
          </div>
          {stepsOpen && (<>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <StepButton
              n={1} label={t('inv.generate')} hint={t('inv.generateHint')}
              state={stage > 1 ? 'done' : 'current'}
              onClick={() => generate.mutate()} disabled={busy}
            />
            <StepButton
              n={2} label={t('inv.notify')} hint={t('inv.notifyHint')}
              state={stage === 2 ? 'current' : stage > 2 ? 'done' : 'todo'}
              onClick={askNotify}
              disabled={busy || list.length === 0}
            />
            <StepButton
              n={3} label={t('inv.finalize')} hint={t('inv.finalizeHint')}
              state={stage === 3 ? 'current' : stage > 3 ? 'done' : 'todo'}
              onClick={askFinalize}
              disabled={busy || counts.preliminary === 0 || (gaps.data?.length ?? 0) > 0}
            />
            <StepButton
              n={4} label={t('inv.approve')} hint={t('inv.approveHint')}
              state={stage === 4 ? 'current' : stage > 4 ? 'done' : 'todo'}
              onClick={askApprove}
              disabled={busy || list.length === 0 || allApproved}
            />
          </div>
          <div className="mt-2 flex justify-end">
            <PeriodLockButton
              period={period}
              branchId={activeBranch}
              allApproved={allApproved}
            />
          </div>
          </>)}
          {busy && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
              <Spinner /> {t('common.saving')}
            </div>
          )}
        </Card>
      )}

      {/* --- Holat xabarlari ------------------------------------ */}
      <div className="mb-4 space-y-2">
        {(gaps.data?.length ?? 0) > 0 && (
          <Notice tone="warn">
            <strong>{t('inv.gapsBlock')}.</strong>{' '}
            {t('dashboard.absenceWarningHint', { count: gaps.data!.length })}{' '}
            <Link to="/davomat" className="font-medium underline">
              {t('nav.absences')}
            </Link>
          </Notice>
        )}
        {diag.data && (
          <PeriodDiagnosis d={diag.data} onGo={(pp) => setPeriod(pp)} />
        )}
        {(stale.data?.length ?? 0) > 0 && (
          <StaleInvoices rows={stale.data!} lang={lang} t={t} />
        )}
        {note && <Notice tone="ok">{note}</Notice>}
        {error && <Notice tone="danger">{(error as Error).message}</Notice>}
      </div>

      {/* Davr foyda jamlanmasi bu yerdan olindi — u bosh sahifada va
          hisobotlarda bor; bu sahifa faqat hisoblanmalar haqida. */}

      {/* --- Ro'yxat -------------------------------------------- */}
      {list.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={t('students.searchHint')} className="max-w-xs" />
          <Select value={klass} onChange={(e) => setKlass(e.target.value)} className="w-auto">
            <option value="">{t('inv.allClasses')}</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={statusF} onChange={(e) => setStatusF(e.target.value as '' | Status)} className="w-auto">
            <option value="">{t('inv.allStatuses')}</option>
            <option value="preliminary">{t('inv.status.preliminary')}</option>
            <option value="final">{t('inv.status.final')}</option>
            <option value="approved">{t('inv.status.approved')}</option>
          </Select>
          {hasPreliminary && (
            <span className="text-[12px] text-[var(--text-muted)]">
              <span className="text-[var(--warn)]">●</span> {t('inv.dotLegend')}
            </span>
          )}
        </div>
      )}
      <Card padded={false}>
        {list.length === 0
          ? (
            <EmptyState
              title={t('inv.noInvoices')}
              hint={(diag.data?.ok ?? 0) === 0
                ? t('inv.emptyNobody')
                : period > currentPeriod()
                  ? t('inv.emptyFuture')
                  : canRun
                    ? t('inv.emptyAuto')
                    : ''}
              action={canRun && (
                <Button variant="primary" onClick={() => generate.mutate()}
                        disabled={busy}>
                  {t('inv.generate')}
                </Button>
              )}
            />
          )
          : shown.length === 0
          ? <EmptyState title={t('inv.noMatch')} hint="" />
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.fullName')}</Th>
                  <Th>{t('students.class')}</Th>
                  <Th>{t('students.paymentCode')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th>{t('inv.dueDate')}</Th>
                  <Th align="right">{t('common.total')}</Th>
                  <Th align="right">{t('inv.details')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Fragment key={r.invoice_id}>
                    <Tr>
                      <Td>
                        <Link to={`/oquvchilar/${r.student_id}`}
                              className="font-medium hover:underline">
                          {r.student?.full_name ?? '—'}
                        </Link>
                      </Td>
                      <Td className="text-[var(--text-muted)]">
                        {r.student?.class_name ?? '—'}
                      </Td>
                      <Td mono className="text-[var(--text-muted)]">
                        {r.student?.payment_code ?? '—'}
                      </Td>
                      <Td>
                        <Badge tone={TONE[(r.status ?? 'preliminary') as Status]}>
                          {t(`inv.status.${r.status}`)}
                        </Badge>
                        {r.has_preliminary && (
                          <span className="ml-1 text-[11px] text-[var(--warn)]"
                                title={t('inv.dotLegend')}>●</span>
                        )}
                      </Td>
                      <Td mono className="text-[var(--text-muted)]">
                        {date(r.due_date, lang)}
                      </Td>
                      <Td align="right" mono><Money value={r.total} bold /></Td>
                      <Td align="right">
                        <Button size="sm" variant="ghost"
                          aria-expanded={openId === r.invoice_id}
                          onClick={() => setOpenId(openId === r.invoice_id ? null : r.invoice_id)}>
                          {openId === r.invoice_id ? t('inv.hide') : t('inv.showLines')}
                        </Button>
                      </Td>
                    </Tr>
                    {openId === r.invoice_id && (
                      <tr>
                        <td colSpan={7} className="bg-[var(--bg-subtle)] px-4 py-2">
                          <InvoiceLines invoiceId={r.invoice_id!} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td>{t('common.total')}{shown.length !== list.length ? ` (${shown.length})` : ''}</Td>
                  <Td /><Td /><Td /><Td />
                  <Td align="right" mono>{money(total, lang)}</Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>
    </>
  );
}

/**
 *  Davr bo'yicha tashxis.
 *
 *  Hammasi joyida bo'lsa HECH NARSA ko'rsatilmaydi — ekranni ortiqcha
 *  xabar bilan to'ldirish foydalanuvchini muhimini payqamaydigan
 *  qilib qo'yadi.
 */
/**
 *  Davr bo'yicha hisob: daromad — oylik = qo'lda qoladi.
 *
 *  DAROMAD IKKI MANBADAN. Hisoblanma allaqachon qurilgan bo'lsa
 *  HAQIQIY summa olinadi (yakunlashda kunlik xizmatlar yo'qlik
 *  bo'yicha qayta hisoblangan bo'lishi mumkin), aks holda prognoz.
 *  Ikkalasini aralashtirsak, oy oxirida jadval bilan bu yerdagi
 *  raqam bir-biriga to'g'ri kelmasdi.
 *
 *  Sinf kesimi ham shu qoidaga bo'ysunadi.
 */

/**
 *  Shartnomadan farq qiladigan hisoblanmalar.
 *
 *  Nega ro'yxat bilan: "3 ta hisoblanma farq qiladi" degan yozuv
 *  odamni butun ro'yxatni ko'zdan kechirishga majbur qilardi. Kim
 *  ekani va farq qanchaligi shu yerda ko'rinsa, tekshirish bir
 *  bosishda tugaydi.
 */
function StaleInvoices({ rows, lang, t }: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
  lang: Lang;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  return (
    <Notice tone="warn">
      <strong>{t('inv.stale', { count: rows.length })}</strong>{' '}
      {t('inv.staleHint')}
      <ul className="mt-1.5 space-y-0.5">
        {rows.slice(0, 12).map((r) => (
          <li key={r.invoice_id} className="text-[13px]">
            <Link to={`/oquvchilar/${r.student_id}`}
                  className="font-medium underline">
              {r.student_name}
            </Link>
            {r.class_name && (
              <span className="text-[var(--text-muted)]"> · {r.class_name}</span>
            )}
            <span className="num">
              {' '}— {money(r.charged, lang)} → {money(r.expected, lang)}
            </span>
          </li>
        ))}
        {rows.length > 12 && (
          <li className="text-[12px] text-[var(--text-muted)]">
            {t('common.andMore', { count: rows.length - 12 })}
          </li>
        )}
      </ul>
    </Notice>
  );
}


function PeriodDiagnosis({ d, onGo }: {
  d: Forecast;
  onGo: (period: string) => void;
}) {
  const t = useT();
  const { lang } = useI18n();

  //  Shartnomasizlar — YAGONA haqiqiy muammo. Qolganlari tabiiy hol.
  const problem = d.no_contract > 0;

  const lines: string[] = [];
  if (d.not_started > 0) lines.push(t('inv.diag.notStarted', { count: d.not_started }));
  if (d.summer > 0)      lines.push(t('inv.diag.summer', { count: d.summer }));
  if (d.left + d.ended > 0) lines.push(t('inv.diag.gone', { count: d.left + d.ended }));
  if (d.no_contract > 0) lines.push(t('inv.diag.noContract', { count: d.no_contract }));

  if (lines.length === 0) return null;

  const goto = d.first_period && d.ok === 0 && d.not_started > 0
    ? d.first_period.slice(0, 10)
    : null;

  return (
    <Notice tone={problem ? 'warn' : 'neutral'}>
      <div className="space-y-1">
        {lines.map((l) => <p key={l}>{l}</p>)}
        {goto && (
          <p className="pt-1">
            <button
              type="button"
              onClick={() => onGo(goto)}
              className="font-medium underline"
            >
              {t('inv.diag.goFirst', { period: periodLabel(goto, lang) })}
            </button>
          </p>
        )}
      </div>
    </Notice>
  );
}

/** Sikl qadami — raqami, nomi va nima qilishi ko'rinib turadi. */
/**
 *  Hisoblanma qanday tuzilgan: o'quv to'lovi + xizmatlar − chegirma.
 *  Ilgari buni ko'rish uchun o'quvchi kartochkasiga o'tish kerak edi.
 */
function InvoiceLines({ invoiceId }: { invoiceId: string }) {
  const t = useT();
  const { lang } = useI18n();
  const lines = useQuery({
    queryKey: ['invoice-lines', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('id, description, kind, quantity, unit_price, amount, is_preliminary, sort_order')
        .eq('invoice_id', invoiceId)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });
  if (lines.isLoading) return <Spinner />;
  if (lines.error) return <Notice tone="danger">{(lines.error as Error).message}</Notice>;
  return (
    <ul className="divide-y text-[13px]">
      {(lines.data ?? []).map((l) => (
        <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
          <span className="min-w-0">
            {l.description}
            <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">{t(`inv.kind.${l.kind}`)}</span>
            {l.is_preliminary && <span className="ml-1 text-[11px] text-[var(--warn)]">● {t('inv.preliminary')}</span>}
          </span>
          <span className="num whitespace-nowrap text-[var(--text-muted)]">
            {Number(l.quantity) !== 1 && `${l.quantity} × ${money(l.unit_price, lang)} = `}
            <span className={Number(l.amount) < 0 ? 'text-[var(--ok)]' : 'font-medium text-[var(--text)]'}>
              {money(l.amount, lang)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepButton({
  n, label, hint, onClick, disabled, state,
}: {
  n: number;
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  state: 'done' | 'current' | 'todo';
}) {
  const current = state === 'current';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={current ? 'step' : undefined}
      className={`rounded-lg border p-3 text-left transition-colors
        disabled:cursor-not-allowed disabled:opacity-50
        ${current
          ? 'bg-[var(--primary)] border-[var(--primary)] text-[var(--on-primary)] shadow-md hover:bg-[var(--primary-hover)]'
          : 'hover:bg-[var(--bg-subtle)]'}`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center
          rounded-full text-[11px] font-semibold
          ${state === 'done' ? 'bg-[var(--ok)] text-white'
            : current ? 'border border-current text-[var(--on-primary)]'
            : 'bg-[var(--bg-inset)] text-[var(--text-muted)]'}`}>
          {state === 'done' ? '✓' : n}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className={`mt-1 pl-7 text-[11px] leading-snug
        ${current ? 'text-[var(--on-primary)] opacity-80' : 'text-[var(--text-muted)]'}`}>
        {hint}
      </p>
    </button>
  );
}
