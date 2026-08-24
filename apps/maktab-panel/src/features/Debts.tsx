// =====================================================================
//  Qarzdorlik (TZ 4.8).
//
//  TZ 4.8.1 — qarzdorlik hisoblanma va TASDIQLANGAN to'lovlar farqi
//  sifatida real vaqtda hisoblanadi. Hech qayerda saqlanmaydi.
//
//  TZ 4.8.3 — muddati o'tgan qarzdorlik alohida ustunda.
//  TZ 4.8.5 — ortiqcha to'lov (avans) alohida ro'yxatda.
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Money,
  Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';

export default function Debts() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can } = useAuth();

  const [search, setSearch] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [klass, setKlass] = useState('');

  const debts = useQuery({
    queryKey: ['debts', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_debts', {
        p_branch_id: branchId ?? undefined,
        p_min_amount: 0.01,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const advances = useQuery({
    queryKey: ['advances', branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_advances', {
        p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const classes = useMemo(() => {
    const s = new Set<string>();
    for (const d of debts.data ?? []) if (d.class_name) s.add(d.class_name);
    return [...s].sort();
  }, [debts.data]);

  const rows = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (debts.data ?? []).filter((d) => {
      if (onlyOverdue && Number(d.overdue_amount ?? 0) <= 0) return false;
      if (klass && d.class_name !== klass) return false;
      if (!n) return true;
      return d.full_name?.toLowerCase().includes(n) ||
        d.payment_code?.toLowerCase().includes(n);
    });
  }, [debts.data, search, onlyOverdue, klass]);

  if (!can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (debts.isLoading) return <Loading />;
  if (debts.error) {
    return <ErrorState message={(debts.error as Error).message}
                       onRetry={() => debts.refetch()} />;
  }

  const totalDebt = rows.reduce((s, d) => s + Number(d.balance ?? 0), 0);
  const totalOverdue = rows.reduce((s, d) => s + Number(d.overdue_amount ?? 0), 0);
  const totalAdvance = (advances.data ?? [])
    .reduce((s, a) => s + Number(a.advance ?? 0), 0);

  return (
    <>
      <PageHeader
        title={t('debt.title')}
        subtitle={t('common.showing', { count: rows.length })}
        actions={
          <Button
            disabled={rows.length === 0}
            onClick={() => exportTable(
              'qarzdorlik',
              [
                { header: t('common.fullName'), value: (d) => d.full_name },
                { header: t('students.class'), value: (d) => d.class_name },
                { header: t('students.paymentCode'), value: (d) => d.payment_code },
                { header: t('rep.charged'), value: (d) => d.charged, numeric: true },
                { header: t('rep.collected'), value: (d) => d.paid, numeric: true },
                { header: t('debt.title'), value: (d) => d.balance, numeric: true },
                { header: t('debt.overdue'), value: (d) => d.overdue_amount, numeric: true },
                { header: t('debt.daysOverdue'), value: (d) => d.days_overdue, numeric: true },
              ],
              rows,
              [t('debt.title')],
            )}
          >
            {t('common.export')}
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label={t('debt.totalDebt')} value={money(totalDebt, lang)} tone="danger" />
        <Stat label={t('debt.overdue')} value={money(totalOverdue, lang)} tone="danger" />
        <Stat label={t('debt.advances')} value={money(totalAdvance, lang)} tone="ok" />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('students.searchHint')}
          className="max-w-xs"
          type="search"
        />
        <Select value={klass} onChange={(e) => setKlass(e.target.value)}
                className="w-auto">
          <option value="">{t('common.all')}</option>
          {classes.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={onlyOverdue}
            onChange={(e) => setOnlyOverdue(e.target.checked)}
            className="h-4 w-4"
          />
          {t('debt.onlyOverdue')}
        </label>
      </div>

      <Card padded={false}>
        {rows.length === 0 ? <EmptyState title={t('debt.noDebt')} hint="" /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.fullName')}</Th>
                <Th>{t('students.class')}</Th>
                <Th>{t('students.paymentCode')}</Th>
                <Th align="right">{t('rep.charged')}</Th>
                <Th align="right">{t('rep.collected')}</Th>
                <Th align="right">{t('debt.title')}</Th>
                <Th align="right">{t('debt.overdue')}</Th>
                <Th>{t('debt.oldestDue')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <Tr key={d.student_id}>
                  <Td>
                    <Link to={`/oquvchilar/${d.student_id}`}
                          className="font-medium hover:underline">
                      {d.full_name}
                    </Link>
                  </Td>
                  <Td className="text-[var(--text-muted)]">{d.class_name ?? '—'}</Td>
                  <Td mono className="text-[var(--text-muted)]">{d.payment_code}</Td>
                  <Td align="right" mono>{money(d.charged, lang)}</Td>
                  <Td align="right" mono className="text-[var(--ok)]">
                    {money(d.paid, lang)}
                  </Td>
                  <Td align="right" mono><Money value={d.balance} colored bold /></Td>
                  <Td align="right" mono>
                    {Number(d.overdue_amount) > 0
                      ? <span className="text-[var(--danger)]">
                          {money(d.overdue_amount, lang)}
                        </span>
                      : '—'}
                  </Td>
                  <Td>
                    {d.oldest_due
                      ? (
                        <span className="flex items-center gap-1.5">
                          <span className="num text-[12px] text-[var(--text-muted)]">
                            {date(d.oldest_due, lang)}
                          </span>
                          {Number(d.days_overdue) > 0 && (
                            <Badge tone="danger">
                              +{d.days_overdue} {t('debt.daysOverdue')}
                            </Badge>
                          )}
                        </span>
                      )
                      : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--bg-subtle)] font-semibold">
                <Td>{t('common.total')}</Td>
                <Td /><Td /><Td /><Td />
                <Td align="right" mono className="text-[var(--danger)]">
                  {money(totalDebt, lang)}
                </Td>
                <Td align="right" mono className="text-[var(--danger)]">
                  {money(totalOverdue, lang)}
                </Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      {/* --- Avanslar (TZ 4.8.5) --------------------------------- */}
      {(advances.data?.length ?? 0) > 0 && (
        <Card title={t('debt.advances')} className="mt-4" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>{t('common.fullName')}</Th>
                <Th>{t('students.class')}</Th>
                <Th align="right">{t('students.advance')}</Th>
              </tr>
            </thead>
            <tbody>
              {advances.data!.map((a) => (
                <Tr key={a.student_id}>
                  <Td>
                    <Link to={`/oquvchilar/${a.student_id}`}
                          className="font-medium hover:underline">
                      {a.full_name}
                    </Link>
                  </Td>
                  <Td className="text-[var(--text-muted)]">{a.class_name ?? '—'}</Td>
                  <Td align="right" mono className="text-[var(--ok)]">
                    {money(a.advance, lang)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'danger';
}) {
  return (
    <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide
        text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`num mt-1 text-xl font-semibold tracking-tight
        ${tone === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}>
        {value}
      </div>
    </div>
  );
}
