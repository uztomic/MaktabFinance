// =====================================================================
//  "Mening oyligim" — o'qituvchi PWA si (TZ 3.1, 4.11.7).
//
//  RLS `payroll_runs_select_own` va `payroll_lines_select_own`
//  siyosatlari tufayli o'qituvchi faqat O'ZINING qaydnomasini ko'radi.
//
//  TZ 4.11.7 — har bir qator qayerdan kelgani ko'rinadi. Bu
//  o'qituvchi bilan buxgalter o'rtasidagi bahsni oldini oladi.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, date, money, num, periodLabel, shiftPeriod } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Loading, Notice, PageHeader,
} from '@/ui';

export default function MyPayroll() {
  const t = useT();
  const { lang } = useI18n();
  const [period, setPeriod] = useState(currentPeriod());

  const run = useQuery({
    queryKey: ['my-payroll', period],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_runs')
        .select('id, period, status, period_from, period_to, approved_at')
        .eq('period', period)
        .neq('status', 'cancelled')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const lines = useQuery({
    queryKey: ['my-payroll-lines', run.data?.id],
    enabled: !!run.data?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_lines')
        .select('id, description, quantity, unit_price, amount, source_kind')
        .eq('payroll_run_id', run.data!.id)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  if (run.isLoading) return <Loading />;
  if (run.error) {
    return (
      <ErrorState
        message={(run.error as Error).message}
        onRetry={() => run.refetch()}
      />
    );
  }

  const rows = lines.data ?? [];
  const gross = rows.filter((l) => Number(l.amount) > 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const deductions = rows.filter((l) => Number(l.amount) < 0)
    .reduce((s, l) => s + Number(l.amount), 0);
  const net = gross + deductions;

  return (
    <>
      <PageHeader
        title={t('nav.myPayroll')}
        subtitle={periodLabel(period, lang)}
        actions={
          <>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
          </>
        }
      />

      {!run.data
        ? (
          <EmptyState
            title={t('common.empty')}
            hint={t('payroll.notCalculated')}
          />
        )
        : (
          <>
            <div className="mb-4 rounded-lg border bg-[var(--bg)] px-4 py-4 text-center">
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                {t('payroll.net')}
              </div>
              <div className="num mt-1 text-3xl font-semibold">
                {money(net, lang)}
              </div>
              <div className="mt-2 flex justify-center">
                <Badge tone={run.data.status === 'approved' ? 'ok' : 'warn'}>
                  {run.data.status === 'approved'
                    ? t('payroll.approved')
                    : t('payroll.draft')}
                </Badge>
              </div>
              <div className="mt-1 text-[12px] text-[var(--text-muted)]">
                {date(run.data.period_from, lang)} — {date(run.data.period_to, lang)}
              </div>
            </div>

            {run.data.status !== 'approved' && (
              <div className="mb-4">
                <Notice tone="warn">
                  Hisob hali tasdiqlanmagan — summa o'zgarishi mumkin (TZ 4.11.8).
                </Notice>
              </div>
            )}

            <Card title={t('payroll.sheet')} padded={false}>
              {rows.length === 0 ? <EmptyState /> : (
                <div className="divide-y divide-[var(--border-soft)]">
                  {rows.map((l) => {
                    const amount = Number(l.amount);
                    const negative = amount < 0;
                    return (
                      <div
                        key={l.id}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-sm">{l.description}</div>
                          {Number(l.quantity) !== 1 && (
                            <div className="num text-[12px] text-[var(--text-muted)]">
                              {num(l.quantity, lang, 2)} × {money(l.unit_price, lang)}
                            </div>
                          )}
                        </div>
                        <span
                          className={`num shrink-0 text-sm font-semibold ${
                            negative ? 'text-[var(--danger)]' : ''
                          }`}
                        >
                          {negative ? '−' : ''}{money(Math.abs(amount), lang)}
                        </span>
                      </div>
                    );
                  })}

                  <div className="bg-[var(--bg-subtle)] px-4 py-3">
                    <div className="flex justify-between text-[13px]">
                      <span className="text-[var(--text-muted)]">
                        {t('payroll.gross')}
                      </span>
                      <span className="num font-medium">{money(gross, lang)}</span>
                    </div>
                    {deductions < 0 && (
                      <div className="mt-1 flex justify-between text-[13px]">
                        <span className="text-[var(--text-muted)]">
                          {t('payroll.deductions')}
                        </span>
                        <span className="num font-medium text-[var(--danger)]">
                          −{money(-deductions, lang)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
    </>
  );
}
