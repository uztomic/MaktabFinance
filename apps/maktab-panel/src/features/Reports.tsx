// =====================================================================
//  Hisobotlar (TZ 4.12).
//
//  TZ 4.12.1 — "Kunlik, haftalik, oylik va yillik kesimlar ALOHIDA
//  FUNKSIYA EMAS, balki sana filtri natijasidir." Shuning uchun bitta
//  sana oralig'i barcha hisobotga qo'llanadi.
//
//  TZ 4.12.2 — jamlanma qiymatlar bazada saqlanmaydi: har bir hisobot
//  server funksiyasi orqali boshlang'ich yozuvlardan hisoblanadi.
//
//  TZ 4.12.3/4.12.4 — har bir hisobot filial kesimida chiqadi va
//  filiallar yig'indisi jamlangan qiymatga teng bo'ladi (bitta
//  manbadan kelgani uchun).
// =====================================================================

import { type ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, date, isoDate, money, num, periodLabel } from '@/lib/format';
import { type Column, exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';

type ReportId =
  | 'summary' | 'classes' | 'pnl' | 'revenue' | 'expenses' | 'enrollment'
  | 'cash' | 'methods' | 'sources' | 'usage' | 'payroll';

export default function Reports() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can } = useAuth();

  const monthStart = isoDate(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(isoDate());
  const [tab, setTab] = useState<ReportId>('summary');

  if (!can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  const TABS: Array<{ id: ReportId; label: string }> = [
    { id: 'summary', label: t('rep.summary') },
    { id: 'classes', label: t('cls.byClass') },
    { id: 'pnl', label: t('rep.pnl') },
    { id: 'revenue', label: t('rep.revenue') },
    { id: 'expenses', label: t('rep.expenses') },
    { id: 'cash', label: t('rep.cash') },
    { id: 'methods', label: t('payMethod.breakdown') },
    { id: 'enrollment', label: t('rep.enrollment') },
    { id: 'sources', label: t('rep.sources') },
    { id: 'usage', label: t('rep.usage') },
    { id: 'payroll', label: t('rep.payroll') },
  ];

  /** Tayyor oraliqlar — buxgalter har safar sana yozmasin. */
  function quick(kind: 'month' | 'prevMonth' | 'quarter' | 'year') {
    const now = new Date();
    if (kind === 'month') {
      setFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(isoDate());
    } else if (kind === 'prevMonth') {
      setFrom(isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setTo(isoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else if (kind === 'quarter') {
      setFrom(isoDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)));
      setTo(isoDate());
    } else {
      setFrom(isoDate(new Date(now.getFullYear(), 0, 1)));
      setTo(isoDate());
    }
  }

  return (
    <>
      <PageHeader
        title={t('rep.title')}
        subtitle={`${date(from, lang)} — ${date(to, lang)}`}
      />

      {/* --- Sana oralig'i (TZ 4.12.1) ------------------------- */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('common.from')}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('common.to')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => quick('month')}>
              {t('rep.quick.month')}
            </Button>
            <Button size="sm" onClick={() => quick('prevMonth')}>
              {t('rep.quick.prevMonth')}
            </Button>
            <Button size="sm" onClick={() => quick('quarter')}>
              {t('rep.quick.quarter')}
            </Button>
            <Button size="sm" onClick={() => quick('year')}>
              {t('rep.quick.year')}
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {TABS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium
              transition-colors
              ${tab === x.id
                ? 'border-brand-700 text-[var(--text)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      <ReportBody id={tab} from={from} to={to} branchId={branchId} />
    </>
  );
}

// =====================================================================

function ReportBody({
  id, from, to, branchId,
}: {
  id: ReportId;
  from: string;
  to: string;
  branchId: string | null;
}) {
  const t = useT();
  const { lang } = useI18n();

  // Xarajat kategoriyasini bosib ichkariga kirish (TZ 4.12.6).
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);

  const q = useQuery({
    queryKey: ['report', id, from, to, branchId],
    queryFn: async () => {
      const branch = branchId ?? undefined;

      if (id === 'summary') {
        const { data, error } = await supabase.rpc('report_financial_summary',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'classes') {
        const { data, error } = await supabase.rpc('report_by_class',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'pnl') {
        const { data, error } = await supabase.rpc('report_pnl',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'sources') {
        const { data, error } = await supabase.rpc('report_lead_sources',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'methods') {
        const { data, error } = await supabase.rpc('report_payment_methods',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'revenue') {
        const { data, error } = await supabase.rpc('report_revenue_mix',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'expenses') {
        const { data, error } = await supabase.rpc('report_expenses',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'enrollment') {
        const { data, error } = await supabase.rpc('report_enrollment',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'cash') {
        const { data, error } = await supabase.rpc('report_cash',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      if (id === 'usage') {
        const { data, error } = await supabase.rpc('report_service_usage',
          { p_from: from, p_to: to, p_branch_id: branch });
        if (error) throw error;
        return data ?? [];
      }
      // payroll — davr bo'yicha, sana oralig'i emas
      const { data, error } = await supabase.rpc('report_payroll',
        { p_period: from });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (q.isLoading) return <Loading />;
  if (q.error) {
    return <ErrorState message={(q.error as Error).message}
                       onRetry={() => q.refetch()} />;
  }

  // deno-lint-ignore no-explicit-any
  const rows = (q.data ?? []) as any[];

  // Jamlanma — jadval emas, kartochkalar. Shuning uchun umumiy
  // jadval mantiqidan oldin ajratiladi.
  if (id === 'summary') {
    return <FinancialSummary row={rows[0] ?? null} from={from} to={to} />;
  }

  if (rows.length === 0) return <Card><EmptyState /></Card>;

  const M = (v: unknown) => money(v as number, lang);
  const N = (v: unknown) => num(v as number, lang, 1);

  // Har bir hisobot uchun: ustunlar + jami qatori.
  // deno-lint-ignore no-explicit-any
  const SPECS: Record<ReportId, {
    columns: Array<Column<any> & {
      render?: (r: any) => React.ReactNode;
      align?: 'right';
      /** Jami qatorida qaysi maydon yig'iladi. */
      sumKey?: string;
      /** Jami pul formatida ko'rsatiladimi. */
      sumMoney?: boolean;
    }>;
    filename: string;
    title: string;
  }> = {
    summary: { filename: 'jamlanma', title: t('rep.summary'), columns: [] },
    classes: {
      filename: 'sinflar',
      title: t('cls.byClass'),
      columns: [
        { header: t('cls.name'), value: (r) => r.class_name },
        { header: t('cls.teacher'), value: (r) => r.teacher_name },
        { header: t('cls.students'), value: (r) => r.students, numeric: true, align: 'right', sumKey: 'students', sumMoney: false, render: (r) => r.students },
        { header: t('cls.charged'), value: (r) => r.charged, numeric: true, align: 'right', sumKey: 'charged', sumMoney: true, render: (r) => M(r.charged) },
        { header: t('cls.collected'), value: (r) => r.collected, numeric: true, align: 'right', sumKey: 'collected', sumMoney: true, render: (r) => M(r.collected) },
        { header: t('cls.remaining'), value: (r) => r.remaining, numeric: true, align: 'right', sumKey: 'remaining', sumMoney: true, render: (r) => <Money value={r.remaining} colored /> },
        { header: t('cls.rate'), value: (r) => r.collection_rate, numeric: true, align: 'right', render: (r) => <Rate value={Number(r.collection_rate)} /> },
        { header: t('cls.totalDebt'), value: (r) => r.debt, numeric: true, align: 'right', sumKey: 'debt', sumMoney: true, render: (r) => M(r.debt) },
      ],
    },
    pnl: {
      filename: 'moliyaviy-natija',
      title: t('rep.pnl'),
      columns: [
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('rep.charged'), value: (r) => r.charged, numeric: true, align: 'right', sumKey: 'charged', sumMoney: true, render: (r) => M(r.charged) },
        { header: t('rep.collected'), value: (r) => r.collected, numeric: true, align: 'right', sumKey: 'collected', sumMoney: true, render: (r) => M(r.collected) },
        { header: t('rep.expenses'), value: (r) => r.expenses, numeric: true, align: 'right', sumKey: 'expenses', sumMoney: true, render: (r) => M(r.expenses) },
        { header: t('rep.profit'), value: (r) => r.profit, numeric: true, align: 'right', sumKey: 'profit', sumMoney: true, render: (r) => M(r.profit) },
      ],
    },
    revenue: {
      filename: 'tushum-tarkibi',
      title: t('rep.revenue'),
      columns: [
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('services.title'), value: (r) => r.service_name },
        { header: t('common.count'), value: (r) => r.quantity, numeric: true, align: 'right', sumKey: 'quantity', sumMoney: false, render: (r) => N(r.quantity) },
        { header: t('common.amount'), value: (r) => r.amount, numeric: true, align: 'right', sumKey: 'amount', sumMoney: true, render: (r) => M(r.amount) },
      ],
    },
    expenses: {
      filename: 'xarajatlar',
      title: t('rep.expenses'),
      columns: [
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('exp.category'), value: (r) => r.category_name },
        { header: t('common.count'), value: (r) => r.entries, numeric: true, align: 'right', sumKey: 'entries', sumMoney: false, render: (r) => r.entries },
        { header: t('common.amount'), value: (r) => r.amount, numeric: true, align: 'right', sumKey: 'amount', sumMoney: true, render: (r) => M(r.amount) },
      ],
    },
    enrollment: {
      filename: 'kontingent',
      title: t('rep.enrollment'),
      columns: [
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('rep.joined'), value: (r) => r.joined, numeric: true, align: 'right', sumKey: 'joined', sumMoney: false, render: (r) => r.joined },
        { header: t('rep.left'), value: (r) => r.left_school, numeric: true, align: 'right', sumKey: 'left_school', sumMoney: false, render: (r) => r.left_school },
        { header: t('rep.activeNow'), value: (r) => r.active_now, numeric: true, align: 'right', sumKey: 'active_now', sumMoney: false, render: (r) => r.active_now },
        { header: t('rep.onLeave'), value: (r) => r.academic_leave, numeric: true, align: 'right', sumKey: 'academic_leave', sumMoney: false, render: (r) => r.academic_leave },
      ],
    },
    cash: {
      filename: 'kassa',
      title: t('rep.cash'),
      columns: [
        { header: t('common.date'), value: (r) => r.day, render: (r) => date(r.day, lang) },
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('rep.cashIn'), value: (r) => r.cash_in, numeric: true, align: 'right', sumKey: 'cash_in', sumMoney: true, render: (r) => M(r.cash_in) },
        { header: t('rep.cashOut'), value: (r) => r.cash_out, numeric: true, align: 'right', sumKey: 'cash_out', sumMoney: true, render: (r) => M(r.cash_out) },
        { header: t('common.total'), value: (r) => r.net, numeric: true, align: 'right', sumKey: 'net', sumMoney: true, render: (r) => M(r.net) },
        { header: t('rep.receipts'), value: (r) => r.receipts, numeric: true, align: 'right', sumKey: 'receipts', sumMoney: false, render: (r) => r.receipts },
      ],
    },
    sources: {
      filename: 'manbalar',
      title: t('rep.sources'),
      columns: [
        {
          header: t('src.source'),
          value: (r) => r.source ?? t('src.direct'),
          render: (r) => (
            r.is_direct
              ? <span className="text-[var(--text-muted)]">{t('src.direct')}</span>
              : <span className="font-medium">{r.source}</span>
          ),
        },
        { header: t('src.leads'), value: (r) => r.leads, numeric: true,
          align: 'right', sumKey: 'leads', sumMoney: false,
          render: (r) => (r.is_direct ? '—' : r.leads) },
        { header: t('src.accepted'), value: (r) => r.accepted, numeric: true,
          align: 'right', sumKey: 'accepted', sumMoney: false,
          render: (r) => (r.is_direct ? '—' : r.accepted) },
        { header: t('src.open'), value: (r) => r.open_count, numeric: true,
          align: 'right',
          render: (r) => (r.is_direct ? '—' : r.open_count) },
        { header: t('src.conversion'), value: (r) => r.conversion,
          numeric: true, align: 'right',
          render: (r) => (r.is_direct ? '—' : `${r.conversion}%`) },
        { header: t('src.activeStudents'), value: (r) => r.students_active,
          numeric: true, align: 'right', sumKey: 'students_active',
          sumMoney: false, render: (r) => r.students_active },
        { header: t('src.collected'), value: (r) => r.collected, numeric: true,
          align: 'right', sumKey: 'collected', sumMoney: true,
          render: (r) => M(r.collected) },
      ],
    },
    methods: {
      filename: 'tolov-usullari',
      title: t('payMethod.breakdown'),
      columns: [
        { header: t('payMethod.label'), value: (r) => r.method_name,
          render: (r) => `${r.is_cash ? '💵' : '💳'} ${r.method_name}` },
        { header: t('pay.count'), value: (r) => r.payments, numeric: true,
          align: 'right', sumKey: 'payments', sumMoney: false,
          render: (r) => r.payments },
        { header: t('common.amount'), value: (r) => r.amount, numeric: true,
          align: 'right', sumKey: 'amount', sumMoney: true,
          render: (r) => M(r.amount) },
        { header: '%', value: (r) => r.share, numeric: true, align: 'right',
          render: (r) => `${r.share}%` },
      ],
    },
    usage: {
      filename: 'xizmatlar',
      title: t('rep.usage'),
      columns: [
        { header: t('common.branch'), value: (r) => r.branch_name },
        { header: t('services.title'), value: (r) => r.service_name },
        { header: t('services.billingType'), value: (r) => t(`services.type.${r.billing_type}`) },
        { header: t('rep.subscribers'), value: (r) => r.subscribers, numeric: true, align: 'right', sumKey: 'subscribers', sumMoney: false, render: (r) => r.subscribers },
        { header: t('rep.absenceDays'), value: (r) => r.absence_days, numeric: true, align: 'right', sumKey: 'absence_days', sumMoney: false, render: (r) => r.absence_days },
        { header: t('rep.billedDays'), value: (r) => r.billed_days, numeric: true, align: 'right', sumKey: 'billed_days', sumMoney: false, render: (r) => N(r.billed_days) },
        { header: t('common.amount'), value: (r) => r.amount, numeric: true, align: 'right', sumKey: 'amount', sumMoney: true, render: (r) => M(r.amount) },
      ],
    },
    payroll: {
      filename: 'oylik',
      title: t('rep.payroll'),
      columns: [
        { header: t('common.fullName'), value: (r) => r.teacher_name },
        { header: t('lessons.hours'), value: (r) => r.hours, numeric: true, align: 'right', sumKey: 'hours', sumMoney: false, render: (r) => N(r.hours) },
        { header: t('payroll.gross'), value: (r) => r.gross_total, numeric: true, align: 'right', sumKey: 'gross_total', sumMoney: true, render: (r) => M(r.gross_total) },
        { header: t('payroll.deductions'), value: (r) => r.deductions, numeric: true, align: 'right', sumKey: 'deductions', sumMoney: true, render: (r) => M(r.deductions) },
        { header: t('payroll.net'), value: (r) => r.net_total, numeric: true, align: 'right', sumKey: 'net_total', sumMoney: true, render: (r) => M(r.net_total) },
      ],
    },
  };

  const spec = SPECS[id];

  // Jami — sumKey belgilangan ustunlar bo'yicha (TZ 4.12.4).
  const sums: Record<string, number> = {};
  for (const c of spec.columns) {
    if (c.sumKey) {
      sums[c.sumKey] = rows.reduce((s, r) => s + Number(r[c.sumKey!] ?? 0), 0);
    }
  }
  const hasTotals = spec.columns.some((c) => c.sumKey);

  return (
    <>
      {id === 'sources' && (
        <div className="mb-3 space-y-2">
          <Notice tone="neutral">{t('src.hint')}</Notice>
          {rows.some((r) => (r as { is_direct?: boolean }).is_direct) && (
            <Notice tone="warn">{t('src.directHint')}</Notice>
          )}
        </div>
      )}

      {id === 'payroll' && (
        <div className="mb-3">
          <Notice tone="neutral">
            {t('rep.payrollPeriodNote', {
              period: periodLabel(currentPeriod(), lang),
            })}
          </Notice>
        </div>
      )}

      <Card
        title={spec.title}
        action={
          <Button
            size="sm"
            onClick={() => exportTable(
              spec.filename,
              spec.columns.map((c) => ({
                header: c.header, value: c.value, numeric: c.numeric,
              })),
              rows,
              [spec.title, `${date(from, lang)} — ${date(to, lang)}`],
            )}
          >
            {t('common.export')}
          </Button>
        }
        padded={false}
      >
        <Table>
          <thead>
            <tr>
              {spec.columns.map((c, i) => (
                <Th key={i} align={c.align ?? 'left'}>{c.header}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Tr
                key={i}
                onClick={id === 'expenses' && r.category_id
                  ? () => setDrill({ id: r.category_id, name: r.category_name })
                  : undefined}
              >
                {spec.columns.map((c, j) => (
                  <Td key={j} align={c.align ?? 'left'} mono={!!c.numeric}>
                    {c.render ? c.render(r) : String(c.value(r) ?? '—')}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>

          {hasTotals && (
            <tfoot>
              <tr className="bg-[var(--bg-subtle)] font-semibold">
                {spec.columns.map((c, j) => {
                  if (j === 0) return <Td key={j}>{t('common.total')}</Td>;
                  if (!c.sumKey) return <Td key={j} />;
                  return (
                    <Td key={j} align="right" mono>
                      {c.sumMoney
                        ? money(sums[c.sumKey], lang)
                        : num(sums[c.sumKey], lang, 1)}
                    </Td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      {drill && (
        <ExpenseDrilldown
          category={drill}
          from={from}
          to={to}
          branchId={branchId}
          onClose={() => setDrill(null)}
        />
      )}
    </>
  );
}

// =====================================================================
//  MOLIYAVIY JAMLANMA
//
//  Direktorning asosiy savoli: "qancha kutilgan, qancha yig'ilgan,
//  YANA QANCHA KERAK va oxirida qo'lda nima qoladi".
//
//  Xodimlar oyligi ALOHIDA ko'rsatiladi — u odatda xarajatning
//  yarmidan ko'pi va boshqa xarajat bilan aralashsa manzara buziladi.
// =====================================================================

// deno-lint-ignore no-explicit-any
function FinancialSummary({ row, from, to }: {
  // deno-lint-ignore no-explicit-any
  row: any;
  from: string;
  to: string;
}) {
  const t = useT();
  const { lang } = useI18n();

  if (!row) return <Card><EmptyState /></Card>;

  const M = (v: unknown) => money(v as number, lang);
  const rate = Number(row.collection_rate ?? 0);
  const net = Number(row.profit_net ?? 0);
  const cash = Number(row.cash_position ?? 0);

  return (
    <div className="space-y-4">
      {/* --- TUSHUM ------------------------------------------- */}
      <Section title={t('fin.income')}>
        <Stat label={t('fin.expected')} value={M(row.charged)}
              hint={t('fin.expectedHint')} />
        <Stat label={t('fin.collected')} value={M(row.collected)} tone="ok" />
        <Stat label={t('fin.remaining')} value={M(row.remaining)} tone="danger"
              hint={t('fin.remainingHint')} />
        <Stat label={t('cls.rate')} value={`${rate}%`} bar={rate}
              tone={rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger'} />
      </Section>

      {/* --- XARAJAT ------------------------------------------ */}
      <Section title={t('fin.expenses')}>
        <Stat label={t('fin.payroll')} value={M(row.payroll)} tone="warn"
              hint={t('fin.payrollHint')} />
        <Stat label={t('fin.otherExpenses')} value={M(row.other_expenses)} />
        <Stat label={t('fin.totalExpenses')} value={M(row.total_expenses)}
              tone="danger" />
        <Stat
          label={t('fin.payrollShare')}
          value={Number(row.total_expenses) > 0
            ? `${Math.round(100 * Number(row.payroll) / Number(row.total_expenses))}%`
            : '—'}
          hint={t('fin.payrollShareHint')}
        />
      </Section>

      {/* --- FOYDA -------------------------------------------- */}
      <Section title={t('fin.profit')}>
        <Stat label={t('fin.beforeExpenses')} value={M(row.profit_before_expenses)}
              hint={t('fin.beforeExpensesHint')} />
        <Stat label={t('fin.beforePayroll')} value={M(row.profit_before_payroll)}
              tone={Number(row.profit_before_payroll) >= 0 ? 'ok' : 'danger'} />
        <Stat label={t('fin.netProfit')} value={M(row.profit_net)}
              tone={net >= 0 ? 'ok' : 'danger'} hint={t('fin.netProfitHint')} />
        <Stat label={t('fin.cashPosition')} value={M(row.cash_position)}
              tone={cash >= 0 ? 'ok' : 'danger'} hint={t('fin.cashPositionHint')} />
      </Section>

      {/* --- QARZDORLIK VA KONTINGENT ------------------------- */}
      <Section title={t('fin.debtAndStudents')}>
        <Stat label={t('cls.totalDebt')} value={M(row.total_debt)} tone="danger"
              hint={t('cls.totalDebtHint')} />
        <Stat label={t('debt.advances')} value={M(row.advances)} tone="ok" />
        <Stat label={t('dashboard.students')} value={String(row.students ?? 0)} />
        <Stat
          label={t('students.settled')}
          value={`${row.paid_students ?? 0} / ${row.students ?? 0}`}
          tone="ok"
          bar={Number(row.students) > 0
            ? 100 * Number(row.paid_students) / Number(row.students)
            : 0}
        />
      </Section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-[var(--text-muted)]">
            {t('fin.periodNote', { from: date(from, lang), to: date(to, lang) })}
          </p>
          <Button
            size="sm"
            onClick={() => exportTable(
              'moliyaviy-jamlanma',
              [
                { header: t('fin.expected'), value: (r) => r.charged, numeric: true },
                { header: t('fin.collected'), value: (r) => r.collected, numeric: true },
                { header: t('fin.remaining'), value: (r) => r.remaining, numeric: true },
                { header: t('cls.rate'), value: (r) => r.collection_rate, numeric: true },
                { header: t('fin.payroll'), value: (r) => r.payroll, numeric: true },
                { header: t('fin.otherExpenses'), value: (r) => r.other_expenses, numeric: true },
                { header: t('fin.totalExpenses'), value: (r) => r.total_expenses, numeric: true },
                { header: t('fin.beforePayroll'), value: (r) => r.profit_before_payroll, numeric: true },
                { header: t('fin.netProfit'), value: (r) => r.profit_net, numeric: true },
                { header: t('fin.cashPosition'), value: (r) => r.cash_position, numeric: true },
                { header: t('cls.totalDebt'), value: (r) => r.total_debt, numeric: true },
              ],
              [row],
              [t('rep.summary'), `${from} — ${to}`],
            )}
          >
            {t('common.export')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider
        text-[var(--text-muted)]">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </div>
  );
}

function Stat({ label, value, hint, tone = 'neutral', bar }: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
  bar?: number;
}) {
  const color = {
    neutral: 'text-[var(--text)]',
    ok: 'text-[var(--ok)]',
    warn: 'text-[var(--warn)]',
    danger: 'text-[var(--danger)]',
  }[tone];
  const barColor = {
    neutral: 'bg-brand-600',
    ok: 'bg-[var(--ok)]',
    warn: 'bg-[var(--warn)]',
    danger: 'bg-[var(--danger)]',
  }[tone];

  return (
    <div className="rounded-lg border bg-[var(--bg)] p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide
        text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`num mt-1 text-lg font-semibold ${color}`}>{value}</div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-inset)]">
          <div className={`h-full rounded-full ${barColor}`}
               style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} />
        </div>
      )}
      {hint && (
        <div className="mt-1 text-[11px] text-[var(--text-faint)]">{hint}</div>
      )}
    </div>
  );
}

/** Yig'ish foizi nishoni — 80% dan yuqori yashil, 50% dan past qizil. */
function Rate({ value }: { value: number }) {
  return (
    <Badge tone={value >= 80 ? 'ok' : value >= 50 ? 'warn' : 'danger'}>
      {value}%
    </Badge>
  );
}

// =====================================================================
//  XARAJAT KATEGORIYASI ICHIGA KIRISH (TZ 4.12.6)
// =====================================================================

function ExpenseDrilldown({
  category, from, to, branchId, onClose,
}: {
  category: { id: string; name: string };
  from: string;
  to: string;
  branchId: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();

  const q = useQuery({
    queryKey: ['expense-detail', category.id, from, to, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_expense_detail', {
        p_from: from,
        p_to: to,
        p_category_id: category.id,
        p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = q.data ?? [];
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);

  return (
    <Modal
      open
      title={`${t('exp.title')} — ${category.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button
            disabled={rows.length === 0}
            onClick={() => exportTable(
              `xarajat-${category.name}`,
              [
                { header: t('common.date'), value: (r) => r.spent_on },
                { header: t('common.branch'), value: (r) => r.branch_name },
                { header: t('common.note'), value: (r) => r.note },
                { header: t('exp.paymentMethod'), value: (r) => r.payment_method },
                { header: t('common.amount'), value: (r) => r.amount, numeric: true },
              ],
              rows,
              [`${t('exp.title')} — ${category.name}`, `${from} — ${to}`],
            )}
          >
            {t('common.export')}
          </Button>
        </>
      }
    >
      {q.isLoading
        ? <Loading />
        : rows.length === 0
        ? <EmptyState />
        : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('common.branch')}</Th>
                <Th>{t('common.note')}</Th>
                <Th>{t('common.user')}</Th>
                <Th align="right">{t('common.amount')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td mono className="whitespace-nowrap">{date(r.spent_on, lang)}</Td>
                  <Td className="text-[var(--text-muted)]">{r.branch_name}</Td>
                  <Td>
                    {r.note ?? '—'}
                    {r.is_payroll && (
                      <Badge tone="warn" >{t('exp.auto')}</Badge>
                    )}
                  </Td>
                  <Td className="text-[var(--text-muted)]">{r.created_by ?? '—'}</Td>
                  <Td align="right" mono>{money(r.amount, lang)}</Td>
                </Tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--bg-subtle)] font-semibold">
                <Td colSpan={4}>{t('common.total')}</Td>
                <Td align="right" mono>{money(total, lang)}</Td>
              </tr>
            </tfoot>
          </Table>
        )}
    </Modal>
  );
}
