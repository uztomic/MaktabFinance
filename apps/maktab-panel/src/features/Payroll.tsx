// =====================================================================
//  Oylik hisobi ro'yxati (TZ 4.11).
//
//  Hisoblash FAQAT SERVER TOMONDA (TZ 4.11.11) — bu sahifa
//  `calc_payroll` va `approve_payroll` funksiyalarini chaqiradi,
//  hech qanday hisob-kitob brauzerda bajarilmaydi.
//
//  TZ 4.11.8 — tasdiqlanmaguncha hisob KUCHGA KIRMAYDI.
//  TZ 4.11.9 — tasdiqlangandan keyin avtomatik xarajat yaratiladi.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, money, periodLabel, shiftPeriod } from '@/lib/format';
import { exportTable } from '@/lib/export';
import { useConfirm } from '@/ui/Feedback';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';

export default function Payroll() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { can, mayWrite } = useAuth();

  const confirm = useConfirm();
  const [period, setPeriod] = useState(currentPeriod());
  const [filter, setFilter] = useState<'all' | 'draft' | 'approved'>('all');

  const rows = useQuery({
    queryKey: ['payroll', period],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_payroll', {
        p_period: period,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const teachers = useQuery({
    queryKey: ['teachers-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, full_name')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  //  Oylik hisobi "muvaffaqiyatli" tugab, natijasi noto'g'ri bo'lishi
  //  mumkin: soat narxi 0 bo'lsa o'rniga kirilgan darslar to'lanmaydi,
  //  ushlanmalar ro'yxati bo'sh bo'lsa soliq ushlanmaydi. Hisobning
  //  o'zi buni aytolmaydi — shuning uchun alohida tekshiruv.
  const issues = useQuery({
    queryKey: ['payroll-issues', period],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('payroll_config_issues', {
        p_period: period,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const calcAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('calc_payroll_batch', {
        p_period: period,
      });
      if (error) throw error;
      return data as {
        calculated: number;
        skipped: number;
        failed: number;
        errors: Array<{ teacher: string; error: string }>;
      };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll', period] }),
  });

  const approve = useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.rpc('approve_payroll', {
        p_run_id: runId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll', period] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    },
  });

  /**
   *  Hammasini tasdiqlash — oy oxirida 20+ o'qituvchini bittalab
   *  bosish o'rniga. Har biri alohida RPC: bittasi xato bersa
   *  qolganlari to'xtamaydi, xatolar ro'yxati ko'rsatiladi.
   */
  const approveAll = useMutation({
    mutationFn: async (ids: string[]) => {
      const failed: string[] = [];
      //  Birinchisi YOLG'IZ: u kerak bo'lsa "Ish haqi" xarajat
      //  turkumini yaratadi — parallel so'rovlar uni ikki marta
      //  yaratib qo'ymasligi uchun. Qolganlari 4 tadan parallel.
      const first = await supabase.rpc('approve_payroll', { p_run_id: ids[0] });
      if (first.error) failed.push(first.error.message);
      for (let i = 1; i < ids.length; i += 4) {
        const res = await Promise.all(ids.slice(i, i + 4).map((id) =>
          supabase.rpc('approve_payroll', { p_run_id: id })));
        for (const r of res) if (r.error) failed.push(r.error.message);
      }
      return { done: ids.length - failed.length, failed };
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['payroll', period] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    },
  });

  /**
   *  Oylikni bekor qilish.
   *
   *  Uchala ehtiyojni bitta amal qoplaydi: berilgan pulni qaytarish,
   *  xato summani tuzatish va butunlay olib tashlash. Bekor qilingan
   *  hisob ro'yxatdan chiqadi va "Hammasini hisoblash" uni yangidan
   *  quradi — tuzatish uchun alohida tugma kerak emas.
   *
   *  Yozuv o'chirilmaydi: pul berilgani ham, qaytarilgani ham
   *  jurnalda qolishi kerak.
   */
  const [cancelling, setCancelling] =
    useState<{ id: string; name: string; net: number } | null>(null);

  const cancel = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('cancel_payroll', {
        p_run_id: id, p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payroll', period] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      setCancelling(null);
    },
  });

  if (!can('payroll.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const data = rows.data ?? [];
  const totals = data.reduce((acc, r) => ({
    gross: acc.gross + Number(r.gross_total ?? 0),
    deductions: acc.deductions + Number(r.deductions ?? 0),
    net: acc.net + Number(r.net_total ?? 0),
  }), { gross: 0, deductions: 0, net: 0 });

  const notCalculated = (teachers.data ?? []).filter(
    (te) => !data.some((r) => r.teacher_id === te.id),
  );
  const drafts = data.filter((r) => r.status !== 'approved');
  const approvedCount = data.length - drafts.length;
  const totalTeachers = Math.max(teachers.data?.length ?? 0, data.length);
  const shown = filter === 'all' ? data
    : filter === 'draft' ? drafts : data.filter((r) => r.status === 'approved');

  //  Oylik jarayoni 3 bosqich — foydalanuvchi qaysi bosqichda
  //  ekanini darhol ko'radi. Ilgari "Hisoblangan" holati tasdiqlangan
  //  deb o'ylanib, xarajat yozilmay qolardi.
  //  4 — hammasi tugagan: uchala bosqich ham ✓.
  const step = data.length === 0 ? 1 : drafts.length > 0 ? 2 : 4;

  const doExport = () => exportTable(
    `oylik-${period.slice(0, 7)}`,
    [
      { header: t('common.fullName'), value: (r: (typeof data)[number]) => r.teacher_name },
      { header: t('lessons.hours'), value: (r) => Number(r.hours ?? 0), numeric: true },
      { header: t('payroll.gross'), value: (r) => Number(r.gross_total ?? 0), numeric: true },
      { header: t('payroll.deductions'), value: (r) => Number(r.deductions ?? 0), numeric: true },
      { header: t('payroll.net'), value: (r) => Number(r.net_total ?? 0), numeric: true },
      { header: t('common.status'), value: (r) => r.status === 'approved' ? t('payroll.approved') : t('payroll.draft') },
    ],
    data,
    [`${t('payroll.title')} — ${periodLabel(period, lang)}`],
  );

  const doApproveAll = async () => {
    const ok = await confirm({
      title: t('payroll.approveAll'),
      message: t('payroll.approveAllConfirm', {
        count: drafts.length,
        amount: money(drafts.reduce((a, r) => a + Number(r.net_total ?? 0), 0), lang),
      }),
      warning: t('payroll.approveWarning'),
      confirmLabel: t('payroll.approveAll'),
    });
    if (ok) approveAll.mutate(drafts.map((r) => r.payroll_run_id!));
  };

  return (
    <>
      <PageHeader
        title={t('payroll.title')}
        subtitle={periodLabel(period, lang)}
        actions={
          <>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}
                    aria-label={t('payroll.prevMonth')}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}
                    aria-label={t('payroll.nextMonth')}>→</Button>
            {data.length > 0 && (
              <Button size="sm" onClick={doExport}>{t('common.export')}</Button>
            )}
            {mayWrite('payroll.manage') && (
              <Button variant="primary" onClick={() => calcAll.mutate()}
                      disabled={calcAll.isPending}>
                {calcAll.isPending ? t('common.saving') : t('payroll.calculateAll')}
              </Button>
            )}
          </>
        }
      />

      {/* --- Bosqichlar: 1 Hisoblash → 2 Tekshirish → 3 Tasdiqlash ---- */}
      <ol className="mb-3 grid grid-cols-3 gap-1.5 text-[12px]">
        {[
          { n: 1, label: t('payroll.step1'), sub: `${data.length}/${totalTeachers}` },
          { n: 2, label: t('payroll.step2'), sub: drafts.length > 0 ? t('payroll.waiting', { count: drafts.length }) : '✓' },
          { n: 3, label: t('payroll.step3'), sub: `${approvedCount}/${data.length || 0}` },
        ].map((x) => (
          <li key={x.n}
              className={`rounded-lg border px-2.5 py-2 ${x.n === step
                ? 'border-[var(--sel-border)] bg-[var(--sel-bg)]'
                : x.n < step ? 'opacity-80' : 'opacity-60'}`}>
            <div className="flex items-center gap-1.5 font-semibold">
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]
                ${x.n < step ? 'bg-[var(--ok)] text-white' : 'border'}`}>
                {x.n < step ? '✓' : x.n}
              </span>
              <span className="truncate">{x.label}</span>
            </div>
            <div className="mt-0.5 pl-6 text-[11px] text-[var(--text-muted)]">{x.sub}</div>
          </li>
        ))}
      </ol>

      {data.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: t('payroll.gross'), value: money(totals.gross, lang) },
            { label: t('payroll.deductions'), value: `−${money(totals.deductions, lang)}`, tone: 'text-[var(--danger)]' },
            { label: t('payroll.net'), value: money(totals.net, lang), tone: 'font-semibold' },
            { label: t('payroll.toApprove'), value: String(drafts.length), tone: drafts.length ? 'text-[var(--warn)]' : 'text-[var(--ok)]' },
          ].map((x) => (
            <Card key={x.label}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{x.label}</div>
              <div className={`mt-1 font-mono text-[17px] tabular-nums ${x.tone ?? ''}`}>{x.value}</div>
            </Card>
          ))}
        </div>
      )}

      {drafts.length > 0 && mayWrite('payroll.approve') && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border
          border-[var(--sel-border)] bg-[var(--sel-bg)] px-3 py-2.5">
          <span className="text-[13px]">{t('payroll.approveHint', { count: drafts.length })}</span>
          <Button variant="accent" onClick={doApproveAll} disabled={approveAll.isPending}>
            {approveAll.isPending ? t('common.saving') : t('payroll.approveAll')}
          </Button>
        </div>
      )}
      {approveAll.data && approveAll.data.failed.length > 0 && (
        <div className="mb-3">
          <Notice tone="danger">
            {t('payroll.approveAllFailed', { count: approveAll.data.failed.length })}: {approveAll.data.failed.join('; ')}
          </Notice>
        </div>
      )}

      {(issues.data?.length ?? 0) > 0 && (
        <div className="mb-3 space-y-2">
          {issues.data!.map((i) => (
            <Notice
              key={i.code}
              tone={i.severity === 'error' ? 'danger'
                : i.severity === 'warning' ? 'warn' : 'neutral'}
            >
              {i.message}
              {i.hint && (
                <span className="ml-1.5 text-[var(--text-muted)]">
                  → {i.hint}
                </span>
              )}
            </Notice>
          ))}
        </div>
      )}

      {calcAll.data && (
        <div className="mb-3">
          {/*  Tasdiqlangan hisob qayta hisoblanmaydi (TZ 4.11.8) va bu
              XATO emas. Ilgari u ham xato deb sanalardi va har oy
              oxirida "22 ta xatolik" degan soxta ogohlantirish
              chiqardi — haqiqiy xatolar esa o'sha 22 ta orasida
              ko'rinmay ketardi. */}
          <Notice tone={calcAll.data.failed > 0 ? 'warn' : 'ok'}>
            <div>
              {t('payroll.calculate')}: {calcAll.data.calculated}
              {calcAll.data.skipped > 0
                && ` · ${t('payroll.calcSkipped')}: ${calcAll.data.skipped}`}
              {calcAll.data.failed > 0
                && ` · ${t('payroll.calcFailed')}: ${calcAll.data.failed}`}
            </div>
            {calcAll.data.errors?.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[12px]">
                {calcAll.data.errors.map((e) => (
                  <li key={e.teacher}>
                    <span className="font-medium">{e.teacher}</span>
                    {' — '}
                    {e.error}
                  </li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      )}

      {calcAll.error && (
        <div className="mb-3">
          <Notice tone="danger">{(calcAll.error as Error).message}</Notice>
        </div>
      )}

      {notCalculated.length > 0 && (
        <div className="mb-3">
          <Notice tone="neutral">
            {t('payroll.notCalcList')}: {notCalculated.map((x) => x.full_name).join(', ')}
          </Notice>
        </div>
      )}

      {data.length > 0 && (
        <div className="mb-2 flex gap-1.5">
          {(['all', 'draft', 'approved'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-[12px] ${filter === f
                ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] font-medium' : 'text-[var(--text-muted)]'}`}>
              {f === 'all' ? `${t('common.all')} · ${data.length}`
                : f === 'draft' ? `${t('payroll.draft')} · ${drafts.length}`
                : `${t('payroll.approved')} · ${approvedCount}`}
            </button>
          ))}
        </div>
      )}

      <Card padded={false}>
        {data.length === 0
          ? (
            <EmptyState
              hint={t('payroll.notCalculated')}
              action={mayWrite('payroll.manage') && (
                <Button onClick={() => calcAll.mutate()}>
                  {t('payroll.calculateAll')}
                </Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.fullName')}</Th>
                  <Th align="right">{t('lessons.hours')}</Th>
                  <Th align="right">{t('payroll.gross')}</Th>
                  <Th align="right">{t('payroll.deductions')}</Th>
                  <Th align="right">{t('payroll.net')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <Tr key={r.payroll_run_id}>
                    <Td>
                      <Link to={`/oylik/${r.payroll_run_id}`}
                            className="font-medium hover:underline">
                        {r.teacher_name}
                      </Link>
                    </Td>
                    <Td align="right" mono className="text-[var(--text-muted)]">
                      {Number(r.hours ?? 0)}
                    </Td>
                    <Td align="right" mono>{money(r.gross_total, lang)}</Td>
                    <Td align="right" mono className="text-[var(--danger)]">
                      {Number(r.deductions) > 0 ? `−${money(r.deductions, lang)}` : '—'}
                      {/* Yaxlitlash ushlanma EMAS — u alohida ko'rsatiladi.
                          Ilgari ikkalasi bir raqamga qo'shilib ketardi va
                          buxgalter soliq summasini shu ustundan olganda
                          deklaratsiyaga to'g'ri kelmasdi. */}
                      {Number(r.rounding ?? 0) !== 0 && (
                        <div className="text-[11px] font-normal text-[var(--text-faint)]">
                          {t('payroll.rounding')}{' '}
                          {Number(r.rounding) < 0 ? '−' : '+'}
                          {money(Math.abs(Number(r.rounding)), lang)}
                        </div>
                      )}
                    </Td>
                    <Td align="right" mono className="font-semibold">
                      {money(r.net_total, lang)}
                    </Td>
                    <Td>
                      <Badge tone={r.status === 'approved' ? 'ok' : 'warn'}>
                        {r.status === 'approved' ? t('payroll.approved') : t('payroll.draft')}
                      </Badge>
                    </Td>
                    <Td align="right">
                      {mayWrite('payroll.approve') && (
                        <div className="flex justify-end gap-1.5">
                          {r.status !== 'approved' && (
                            <Button
                              size="sm"
                              variant="accent"
                              onClick={() => approve.mutate(r.payroll_run_id!)}
                              disabled={approve.isPending}
                            >
                              {t('payroll.approve')}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setCancelling({
                              id: r.payroll_run_id!,
                              name: r.teacher_name ?? '',
                              net: Number(r.net_total ?? 0),
                            })}
                          >
                            {t('payroll.cancel')}
                          </Button>
                        </div>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td>{t('common.total')}</Td>
                  <Td />
                  <Td align="right" mono>{money(totals.gross, lang)}</Td>
                  <Td align="right" mono className="text-[var(--danger)]">
                    −{money(totals.deductions, lang)}
                  </Td>
                  <Td align="right" mono>{money(totals.net, lang)}</Td>
                  <Td /><Td />
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>

      {approve.error && (
        <div className="mt-3">
          <Notice tone="danger">{(approve.error as Error).message}</Notice>
        </div>
      )}

      <div className="mt-3">
        <Notice tone="neutral">{t('payroll.approveWarning')}</Notice>
      </div>

      {cancelling && (
        <CancelPayrollModal
          target={cancelling}
          onClose={() => setCancelling(null)}
          onSubmit={(reason) =>
            cancel.mutate({ id: cancelling.id, reason })}
          busy={cancel.isPending}
          error={cancel.error ? (cancel.error as Error).message : null}
        />
      )}
    </>
  );
}

/**
 *  Bekor qilish sababi MAJBURIY.
 *
 *  Pul qaytarilganda "nega" degan savol albatta tug'iladi — bir oy
 *  o'tib buni hech kim eslay olmaydi. Shuning uchun sabab jurnalga
 *  yoziladi va bo'sh qoldirib bo'lmaydi.
 */
function CancelPayrollModal({ target, onClose, onSubmit, busy, error }: {
  target: { id: string; name: string; net: number };
  onClose: () => void;
  onSubmit: (reason: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const { lang } = useI18n();
  const [reason, setReason] = useState('');

  return (
    <Modal
      open
      title={`${t('payroll.cancel')} — ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onClick={() => onSubmit(reason)}
            disabled={busy || reason.trim().length < 3}
          >
            {busy ? t('common.saving') : t('payroll.cancel')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="warn">
          {t('payroll.cancelWarning', { amount: money(target.net, lang) })}
        </Notice>

        <Field label={t('payroll.cancelReason')} required
               hint={t('payroll.cancelReasonHint')}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        </Field>

        {error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>
  );
}
