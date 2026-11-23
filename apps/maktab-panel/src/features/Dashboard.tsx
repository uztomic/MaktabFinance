// =====================================================================
//  Bosh sahifa — bir qarashda oy natijasi.
//
//  Ilgari 12 ta karta turardi va ular bir-birini takrorlardi:
//  "Oylik", "Xarajatlar", "Jami xarajat"; "Xarajatsiz foyda",
//  "Oyliksiz foyda", "Sof foyda", "Naqd holat"; "Faol o'quvchilar"
//  ikki joyda. Direktor qaysi raqamga qarashni bilmasdi.
//
//  Endi faqat 4 ta raqam — har biri bitta savolga javob:
//    Tushum     — shu oy qancha pul keldi (rejaga nisbatan %)
//    Qarzdorlik — hozir ota-onalar qancha qarz
//    Xarajat    — qancha ketdi (oylik shu ichida, izohda)
//    Sof foyda  — nima qoldi
//  Pastda: sinflar (bosilsa qarzdorlikka) va 12 oylik dinamika.
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, money, periodLabel, shiftPeriod } from '@/lib/format';
import {
  Card, EmptyState, ErrorState, Loading, PageHeader, Progress, Stat,
} from '@/ui';
import { MonthPicker, periodEnd } from '@/ui/MonthPicker';
import { type ClassMonth, loadMonthlyDebts } from '@/lib/monthlyDebts';
import { QuickPayButton } from './QuickPay';
import { AttendanceSummary } from '@/features/AttendanceToday';
import { TodayActivity } from '@/features/TodayActivity';
import { LcOverview } from '@/features/lc/LcOverview';
import { usesGroups } from '@/lib/org';

export default function Dashboard() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can, profile } = useAuth();
  const [period, setPeriod] = useState(currentPeriod);
  const from = period;
  const to = periodEnd(period);
  const prevP = shiftPeriod(period, -1);

  const canSeeFinance = can('reports.view');
  const branch = branchId ?? undefined;
  const isLC = usesGroups(profile?.org_type);

  const summary = useQuery({
    queryKey: ['fin-summary', from, to, branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_financial_summary', {
        p_from: from, p_to: to, p_branch_id: branch,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const prev = useQuery({
    queryKey: ['fin-summary', prevP, periodEnd(prevP), branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_financial_summary', {
        p_from: prevP, p_to: periodEnd(prevP), p_branch_id: branch,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  //  Qarzdorlik sahifasi bilan bir xil kalit — kesh bo'lishiladi.
  const monthly = useQuery({
    queryKey: ['debts-monthly', period, branchId],
    enabled: canSeeFinance,
    queryFn: () => loadMonthlyDebts(period, branchId),
  });

  const trend = useQuery({
    queryKey: ['trend', branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_monthly_trend', {
        p_months: 12, p_branch_id: branch,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const gaps = useQuery({
    queryKey: ['absence-gaps', branchId],
    enabled: can('absences.mark') || canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('pending_absence_warnings', {
        p_branch_id: branch, p_days_back: 14,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  //  Sozlamadagi jim kamchiliklar: ota-onasi yo'q, Telegram ulanmagan…
  //  Bular xato bermaydi — shuning uchun bosh sahifada eslatiladi.
  const setup = useQuery({
    queryKey: ['setup-issues', branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('school_setup_issues', {
        p_branch_id: branch,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ code: string; severity: string; count: number }>;
    },
  });

  const proofs = useQuery({
    queryKey: ['pending-proofs', branchId],
    enabled: can('payments.create'),
    queryFn: async () => {
      let q = supabase.from('payment_proofs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (branchId) q = q.eq('branch_id', branchId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (canSeeFinance && summary.isLoading) return <Loading />;
  if (summary.error) {
    return <ErrorState message={(summary.error as Error).message}
                       onRetry={() => summary.refetch()} />;
  }

  const s = summary.data;
  const p = prev.data;
  const N = (v: unknown) => Number(v ?? 0);
  const delta = (cur: unknown, old: unknown) => {
    const c = N(cur), o = N(old);
    if (!o) return null;
    const d = Math.round(((c - o) / Math.abs(o)) * 100);
    return d === 0 ? null : d;
  };
  const rate = N(s?.collection_rate);

  //  Tanlangan OY qarzi — qarzdorlik sahifasi bilan bir xil hisob (FIFO).
  //  Ilgari bu yerda barcha oylar qarzi turardi va oy tanlovi unga
  //  ta'sir qilmasdi.
  const classesM = monthly.data ?? [];
  const mSum = (f: (c: ClassMonth) => number) => classesM.reduce((a, c) => a + f(c), 0);
  const month = {
    remaining: mSum((c) => c.remaining),
    unpaid: mSum((c) => c.count.unpaid),
    partial: mSum((c) => c.count.partial),
    paid: mSum((c) => c.count.paid),
  };

  return (
    <>
      <PageHeader
        title={t('home.title')}
        subtitle={s ? `${profile?.school_name} · ${t('dm.studentsCount', { count: N(s.students) })}`
          : profile?.school_name}
        actions={
          <>
            {canSeeFinance && <MonthPicker value={period} onChange={setPeriod} />}
            <QuickPayButton />
          </>
        }
      />

      <Alerts setup={setup.data ?? []} gaps={gaps.data?.length ?? 0} proofs={proofs.data ?? 0} />

      {isLC && <div className="mb-5"><LcOverview /></div>}

      {canSeeFinance && (s ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label={t('home.collected')}
              value={money(s.collected, lang)}
              tone="ok"
              delta={delta(s.collected, p?.collected)}
              hint={t('home.collectedHint', { charged: money(s.charged, lang) })}
            >
              <div className="mt-3 flex items-center gap-2">
                <Progress value={rate} />
                <span className="num shrink-0 text-[11.5px] text-[var(--text-muted)]">{rate}%</span>
              </div>
            </Stat>
            <Link to="/qarzdorlik" className="block rounded-2xl transition-transform hover:-translate-y-px">
              <Stat
                label={t('home.debtMonth')}
                value={monthly.isLoading ? '…' : money(month.remaining, lang)}
                tone={month.remaining > 0 ? 'danger' : 'neutral'}
                hint={t('dm.counts', { unpaid: month.unpaid, partial: month.partial })}
              >
                <div className="mt-1 truncate text-[12px] text-[var(--text-faint)]">
                  {t('home.debtAll')}: <span className="num">{money(s.total_debt, lang)}</span>
                </div>
              </Stat>
            </Link>
            <Stat
              label={t('home.expenses')}
              value={money(s.total_expenses, lang)}
              delta={delta(s.total_expenses, p?.total_expenses)}
              invertDelta
              hint={t('home.expensesHint', { amount: money(s.payroll, lang) })}
            />
            <Stat
              label={t('home.profit')}
              value={money(s.cash_position, lang)}
              tone={N(s.cash_position) > 0 ? 'ok' : N(s.cash_position) < 0 ? 'danger' : 'neutral'}
              delta={delta(s.cash_position, p?.cash_position)}
              hint={t('home.profitHint')}
            />
          </div>

          <div className="mb-5 grid gap-4 lg:grid-cols-5">
            {!isLC && (
              <Card
                className="lg:col-span-3"
                title={t('home.classes')}
                padded={false}
                action={<Link to="/qarzdorlik" className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]">
                  {t('home.byMonth')} →
                </Link>}
              >
                <ClassList rows={classesM} loading={monthly.isLoading} />
              </Card>
            )}
            <Card className={isLC ? 'lg:col-span-5' : 'lg:col-span-2'} title={t('home.trend')}>
              <TrendChart rows={trend.data ?? []} selected={period} onPick={setPeriod} />
            </Card>
          </div>
        </>
      ) : <Card><EmptyState /></Card>)}

      <div className="grid gap-4 lg:grid-cols-2">
        {(can('absences.mark') || canSeeFinance) && !isLC && <AttendanceSummary />}
        <TodayActivity />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------

/** Ogohlantirishlar — bitta ixcham blokda, faqat bor bo'lsa. */
function Alerts({ setup, gaps, proofs }: {
  setup: Array<{ code: string; severity: string; count: number }>;
  gaps: number;
  proofs: number;
}) {
  const t = useT();
  const LINK: Record<string, string> = {
    no_parent: '/oquvchilar', parent_no_telegram: '/oquvchilar',
    no_contract: '/oquvchilar', no_class: '/oquvchilar',
    teacher_no_branch: '/oqituvchilar', teacher_no_login: '/oqituvchilar',
    class_no_teacher: '/sinflar',
  };
  const items: Array<{ key: string; text: string; to: string; danger?: boolean }> = [];
  for (const r of setup) {
    items.push({ key: r.code, text: t(`setup.${r.code}`, { count: r.count }),
      to: LINK[r.code] ?? '/', danger: r.severity === 'danger' });
  }
  if (gaps > 0) items.push({ key: 'gaps', text: t('dashboard.absenceWarningHint', { count: gaps }), to: '/davomat' });
  if (proofs > 0) items.push({ key: 'proofs', text: `${t('dashboard.pendingProofs')}: ${proofs}`, to: '/tolovlar' });
  if (items.length === 0) return null;

  return (
    <div className="mb-5 rounded-2xl border bg-[var(--bg)] px-4 py-1">
      {items.map((i) => (
        <Link key={i.key} to={i.to}
          className="flex items-center gap-3 border-b border-[var(--border-soft)] py-2.5 text-[13px] last:border-b-0 hover:opacity-80">
          <span className={`h-2 w-2 shrink-0 rounded-full ${i.danger ? 'bg-[var(--danger)]' : 'bg-[var(--warn)]'}`} />
          <span className="min-w-0 flex-1 text-[var(--text-muted)]">{i.text}</span>
          <span className="shrink-0 text-[var(--text-faint)]">→</span>
        </Link>
      ))}
    </div>
  );
}

/** Sinflar — tanlangan oy: to'langan / hisoblangan, holatlar, qoldiq. */
function ClassList({ rows, loading }: { rows: ClassMonth[]; loading: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  if (loading) return <Loading />;
  const list = rows.filter((c) => c.charged > 0 || c.students.length > 0);
  if (list.length === 0) return <EmptyState hint="" />;
  return (
    <div className="max-h-[440px] overflow-y-auto">
      {list.map((c) => {
        const r = c.charged > 0 ? Math.round((c.paid / c.charged) * 100) : 0;
        const inner = (
          <>
            <div className="w-36 min-w-0 shrink-0">
              <div className="truncate text-[14px] font-medium" title={c.name}>{c.name}</div>
              <div className="text-[11.5px] text-[var(--text-faint)]">
                {t('dm.studentsCount', { count: c.students.length })}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Progress value={r} />
              <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-[var(--text-faint)]">
                <span className="num">{money(c.paid, lang)} / {money(c.charged, lang)}</span>
                {c.count.unpaid > 0 && (
                  <span className="text-[var(--danger)]">{c.count.unpaid} {t('dm.state.unpaid').toLowerCase()}</span>
                )}
              </div>
            </div>
            <div className={`num w-28 shrink-0 text-right text-[13px] font-medium
              ${c.remaining > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>
              {c.charged <= 0 ? '—' : c.remaining > 0 ? `−${money(c.remaining, lang)}` : '✓'}
            </div>
          </>
        );
        const cls = 'flex items-center gap-4 border-b border-[var(--border-soft)] px-5 py-3 ' +
          'last:border-b-0 hover:bg-[var(--bg-subtle)]';
        return c.class_id
          ? <Link key={c.key} to={`/sinflar/${c.class_id}`} className={cls}>{inner}</Link>
          : <div key={c.key} className={cls}>{inner}</div>;
      })}
    </div>
  );
}

/**
 *  12 oylik dinamika. Har oy bitta ustun: kulrang — hisoblangan (reja),
 *  ichidagi yashil — yig'ilgan. Shunda "rejaning qanchasi yig'ildi"
 *  bir qarashda ko'rinadi. Ustunni bossa — o'sha oy tanlanadi.
 */
function TrendChart({
  rows, selected, onPick,
}: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
  selected: string;
  onPick: (period: string) => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const data = useMemo(() => rows.map((r) => ({
    period: String(r.period).slice(0, 10),
    charged: Number(r.charged ?? 0),
    collected: Number(r.collected ?? 0),
    expenses: Number(r.payroll ?? 0) + Number(r.other_expenses ?? 0),
  })), [rows]);
  const max = Math.max(1, ...data.map((d) => Math.max(d.charged, d.collected)));
  if (data.length === 0) return <EmptyState hint="" />;
  const short = (p: string) => periodLabel(p, lang).slice(0, 3);

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: 200 }}>
        {data.map((d) => {
          const active = d.period === selected;
          return (
            <button
              type="button"
              key={d.period}
              onClick={() => onPick(d.period)}
              className="group relative flex h-full flex-1 flex-col items-center justify-end"
            >
              <div className={`relative w-full max-w-7 overflow-hidden rounded-md
                ${active ? 'bg-[var(--text-faint)]' : 'bg-[var(--bg-inset)]'}`}
                   style={{ height: `${(Math.max(d.charged, d.collected) / max) * 100}%`, minHeight: 3 }}>
                <div className="absolute inset-x-0 bottom-0 rounded-md bg-accent-500"
                     style={{ height: `${Math.max(d.charged, d.collected) > 0
                       ? (d.collected / Math.max(d.charged, d.collected)) * 100 : 0}%` }} />
              </div>
              <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden w-48 rounded-xl border
                bg-[var(--bg)] p-2.5 text-left text-[12px] shadow-[var(--shadow-pop)] group-hover:block">
                <div className="mb-1 font-medium">{periodLabel(d.period, lang)}</div>
                <Row label={t('dm.charged')} value={money(d.charged, lang)} />
                <Row label={t('home.collected')} value={money(d.collected, lang)} />
                <Row label={t('home.expenses')} value={money(d.expenses, lang)} />
                <div className="mt-1 border-t pt-1">
                  <Row label={t('home.profit')} value={money(d.collected - d.expenses, lang)} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d) => (
          <span key={d.period} className={`flex-1 text-center text-[10.5px]
            ${d.period === selected ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>
            {short(d.period)}
          </span>
        ))}
      </div>
      <div className="mt-4 flex gap-4 text-[12px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-500" />{t('home.collected')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--bg-inset)] ring-1 ring-[var(--border)]" />{t('dm.charged')}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

