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
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Notice,
  PageHeader, Table, Td, Th, Tr,
} from '@/ui';

export default function Payroll() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { can, mayWrite } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());

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
      return data as { calculated: number; failed: number; errors: unknown[] };
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

  return (
    <>
      <PageHeader
        title={t('payroll.title')}
        subtitle={periodLabel(period, lang)}
        actions={
          <>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
            {mayWrite('payroll.manage') && (
              <Button variant="primary" onClick={() => calcAll.mutate()}
                      disabled={calcAll.isPending}>
                {calcAll.isPending ? t('common.saving') : t('payroll.calculateAll')}
              </Button>
            )}
          </>
        }
      />

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
          <Notice tone={calcAll.data.failed > 0 ? 'warn' : 'ok'}>
            {t('payroll.calculate')}: {calcAll.data.calculated}
            {calcAll.data.failed > 0 && ` · ${t('common.error')}: ${calcAll.data.failed}`}
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
                {data.map((r) => (
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
                      {r.status !== 'approved' && mayWrite('payroll.approve') && (
                        <Button
                          size="sm"
                          variant="accent"
                          onClick={() => approve.mutate(r.payroll_run_id!)}
                          disabled={approve.isPending}
                        >
                          {t('payroll.approve')}
                        </Button>
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
    </>
  );
}
