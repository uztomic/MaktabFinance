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
import { QuickPayButton } from './QuickPay';
import { AttendanceToday } from '@/features/AttendanceToday';
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

  const classes = useQuery({
    queryKey: ['dash-classes', from, to, branchId],
    enabled: canSeeFinance && !isLC,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_by_class', {
        p_from: from, p_to: to, p_branch_id: branch,
      });
      if (error) throw error;
      return data ?? [];
    },
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
    return Math.round(((c - o) / Math.abs(o)) * 100);
  };
  const rate = N(s?.collection_rate);

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
                label={t('home.debt')}
                value={money(s.total_debt, lang)}
                tone={N(s.total_debt) > 0 ? 'danger' : 'neutral'}
                hint={t('home.debtHint', { paid: N(s.paid_students), total: N(s.students) })}
              />
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
              value={money(s.profit_net, lang)}
              tone={N(s.profit_net) >= 0 ? 'ok' : 'danger'}
              delta={delta(s.profit_net, p?.profit_net)}
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
                <ClassList rows={classes.data ?? []} />
              </Card>
            )}
            <Card className={isLC ? 'lg:col-span-5' : 'lg:col-span-2'} title={t('home.trend')}>
              <TrendChart rows={trend.data ?? []} />
            </Card>
          </div>
        </>
      ) : <Card><EmptyState /></Card>)}

      <div className="grid gap-4 lg:grid-cols-2">
        {(can('absences.mark') || canSeeFinance) && !isLC && <AttendanceToday />}
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
  if (gaps > 0) items.push({ key: 'gaps', text: t('dashboard.absenceWarningHint', { count: gaps }), to: '/yoqlik' });
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

/** Sinflar — nom, yig'ish foizi chizig'i, qoldiq. Bosilsa sinf kartasi. */
function ClassList({ rows }: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
}) {
  const t = useT();
  const { lang } = useI18n();
  if (rows.length === 0) return <EmptyState hint="" />;
  return (
    <div className="max-h-[420px] overflow-y-auto">
      {rows.map((c) => {
        const r = Number(c.collection_rate ?? 0);
        const left = Number(c.remaining ?? 0);
        return (
          <Link key={c.class_id} to={`/sinflar/${c.class_id}`}
            className="flex items-center gap-4 border-b border-[var(--border-soft)] px-5 py-3 last:border-b-0 hover:bg-[var(--bg-subtle)]">
            <div className="w-24 min-w-0 shrink-0">
              <div className="truncate text-[14px] font-medium">{c.class_name}</div>
              <div className="text-[11.5px] text-[var(--text-faint)]">
                {t('dm.studentsCount', { count: c.students })}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Progress value={r} />
              <div className="num mt-1 text-[11.5px] text-[var(--text-faint)]">
                {money(c.collected, lang)} / {money(c.charged, lang)}
              </div>
            </div>
            <div className={`num w-28 shrink-0 text-right text-[13px] font-medium ${left > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>
              {left > 0 ? `−${money(left, lang)}` : `${r}%`}
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** 12 oylik dinamika: tushum va xarajat ustunlari, ustiga borsa tafsilot. */
function TrendChart({
  rows,
}: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
}) {
  const t = useT();
  const { lang } = useI18n();
  const data = useMemo(() => rows.map((r) => ({
    period: String(r.period),
    collected: Number(r.collected ?? 0),
    expenses: Number(r.payroll ?? 0) + Number(r.other_expenses ?? 0),
    profit: Number(r.net_profit ?? 0),
  })), [rows]);
  const max = Math.max(1, ...data.map((d) => Math.max(d.collected, d.expenses)));
  if (data.length === 0) return <EmptyState hint="" />;

  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 180 }}>
        {data.map((d) => (
          <div key={d.period} className="group relative flex h-full flex-1 items-end justify-center gap-[2px]">
            <div className="w-1/2 max-w-3 rounded-t-[3px] bg-accent-500"
                 style={{ height: `${(d.collected / max) * 100}%`, minHeight: 2 }} />
            <div className="w-1/2 max-w-3 rounded-t-[3px] bg-[var(--border)]"
                 style={{ height: `${(d.expenses / max) * 100}%`, minHeight: 2 }} />
            <div className="pointer-events-none absolute bottom-full z-10 mb-2 hidden w-44 rounded-xl border
              bg-[var(--bg)] p-2.5 text-[12px] shadow-[var(--shadow-pop)] group-hover:block">
              <div className="mb-1 font-medium">{periodLabel(d.period, lang)}</div>
              <Row label={t('home.collected')} value={money(d.collected, lang)} />
              <Row label={t('home.expenses')} value={money(d.expenses, lang)} />
              <div className="mt-1 border-t pt-1">
                <Row label={t('home.profit')} value={money(d.profit, lang)} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-[var(--text-faint)]">
        <span>{periodLabel(data[0].period, lang)}</span>
        <span>{periodLabel(data[data.length - 1].period, lang)}</span>
      </div>
      <div className="mt-3 flex gap-4 text-[12px] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-accent-500" />{t('home.collected')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[var(--border)]" />{t('home.expenses')}
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

