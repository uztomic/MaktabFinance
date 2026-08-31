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

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import {
  currentPeriod, date, dateTime, money, periodLabel, shiftPeriod,
} from '@/lib/format';
import { exportTable } from '@/lib/export';
import { PeriodLockButton } from './PeriodLock';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Money, Notice,
  PageHeader, Table, Td, Th, Tr,
} from '@/ui';

type Status = 'preliminary' | 'final' | 'approved' | 'cancelled';

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
    qc.invalidateQueries({ queryKey: ['students'] });
  }

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
      setNote(
        `${t('inv.created')}: ${d.created} · ${t('inv.rebuilt')}: ${d.rebuilt} · ` +
        `${t('inv.locked')}: ${d.locked} · ${t('inv.skipped')}: ${d.skipped}`,
      );
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

  if (!can('invoices.generate')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const list = (rows.data ?? []).map((r) => ({
    ...r,
    student: r.student_id ? students.data?.get(r.student_id) : undefined,
  })).sort((a, b) =>
    (a.student?.class_name ?? '').localeCompare(b.student?.class_name ?? '') ||
    (a.student?.full_name ?? '').localeCompare(b.student?.full_name ?? ''));

  const total = list.reduce((s, r) => s + Number(r.total ?? 0), 0);
  const hasPreliminary = list.some((r) => r.has_preliminary);
  const allApproved = list.length > 0 && list.every((r) => r.status === 'approved');
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
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
            <Button
              size="sm"
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

      {/* --- Oylik sikl tugmalari ------------------------------- */}
      {canRun && (
        <Card className="mb-4">
          <div className="flex flex-wrap gap-2">
            <StepButton
              n={1} label={t('inv.generate')} hint={t('inv.generateHint')}
              onClick={() => generate.mutate()} disabled={busy}
              variant="primary"
            />
            <StepButton
              n={2} label={t('inv.notify')} hint={t('inv.notifyHint')}
              onClick={() => notify.mutate(false)}
              disabled={busy || list.length === 0}
            />
            <StepButton
              n={3} label={t('inv.finalize')} hint={t('inv.finalizeHint')}
              onClick={() => finalize.mutate()}
              disabled={busy || list.length === 0 || (gaps.data?.length ?? 0) > 0}
            />
            <StepButton
              n={4} label={t('inv.approve')} hint={t('inv.approveHint')}
              onClick={() => approve.mutate()}
              disabled={busy || list.length === 0 || allApproved}
              variant="accent"
            />
            <PeriodLockButton
              period={period}
              branchId={activeBranch}
              allApproved={allApproved}
            />
          </div>
        </Card>
      )}

      {/* --- Holat xabarlari ------------------------------------ */}
      <div className="mb-4 space-y-2">
        {(gaps.data?.length ?? 0) > 0 && (
          <Notice tone="warn">
            <strong>{t('inv.gapsBlock')}.</strong>{' '}
            {t('dashboard.absenceWarningHint', { count: gaps.data!.length })}{' '}
            <Link to="/yoqlik" className="font-medium underline">
              {t('nav.absences')}
            </Link>
          </Notice>
        )}
        {autoRun.data?.period === period && (
          <Notice tone="neutral">
            {t('inv.autoRun', {
              date: dateTime(autoRun.data.at, lang),
              count: autoRun.data.created,
            })}
          </Notice>
        )}
        {hasPreliminary && (
          <Notice tone="neutral">{t('inv.hasPreliminary')}</Notice>
        )}
        {note && <Notice tone="ok">{note}</Notice>}
        {error && <Notice tone="danger">{(error as Error).message}</Notice>}
      </div>

      {/* --- Ro'yxat -------------------------------------------- */}
      <Card padded={false}>
        {list.length === 0
          ? (
            <EmptyState
              title={t('inv.noInvoices')}
              hint={period > currentPeriod()
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
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <Tr key={r.invoice_id}>
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
                        <span className="ml-1 text-[11px] text-[var(--warn)]">●</span>
                      )}
                    </Td>
                    <Td mono className="text-[var(--text-muted)]">
                      {date(r.due_date, lang)}
                    </Td>
                    <Td align="right" mono><Money value={r.total} bold /></Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td>{t('common.total')}</Td>
                  <Td /><Td /><Td /><Td />
                  <Td align="right" mono>{money(total, lang)}</Td>
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>
    </>
  );
}

/** Sikl qadami — raqami, nomi va nima qilishi ko'rinib turadi. */
function StepButton({
  n, label, hint, onClick, disabled, variant = 'secondary',
}: {
  n: number;
  label: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  variant?: 'primary' | 'secondary' | 'accent';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-lg border p-3 text-left transition-colors
        min-w-[13rem] disabled:cursor-not-allowed disabled:opacity-45
        ${variant === 'primary'
          ? 'border-brand-700 bg-brand-900 text-white hover:bg-brand-800'
          : variant === 'accent'
          ? 'border-accent-600 bg-accent-600 text-white hover:bg-accent-700'
          : 'hover:bg-[var(--bg-subtle)]'}`}
    >
      <div className="flex items-center gap-2">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center
          rounded-full text-[11px] font-semibold
          ${variant === 'secondary'
            ? 'bg-[var(--bg-inset)] text-[var(--text-muted)]'
            : 'bg-white/20 text-white'}`}>
          {n}
        </span>
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className={`mt-1 pl-7 text-[11px] leading-snug
        ${variant === 'secondary' ? 'text-[var(--text-muted)]' : 'text-white/75'}`}>
        {hint}
      </p>
    </button>
  );
}
