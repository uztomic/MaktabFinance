// =====================================================================
//  Qarzdorlik — OY bo'yicha, SINF kesimida (TZ 4.8).
//
//  Ilgari sahifada uchta mavhum raqam turardi ("Jami qarzdorlik",
//  "Muddati o'tgan", "Ortiqcha to'lov") va uzun o'quvchilar jadvali.
//  Buxgalterning haqiqiy savoliga — "shu oy kim to'ladi, kim yo'q?" —
//  javob yo'q edi.
//
//  Endi:
//    · yuqorida oy tanlanadi — istalgan oyni ko'rish mumkin;
//    · har sinf bitta qator: nechta o'quvchi, nechtasi to'lagan,
//      qisman, to'lamagan, qancha qoldi;
//    · sinf ochilsa — har o'quvchi holati va QAYSI OYLAR uchun
//      qarzdorligi (FIFO, lib/monthlyDebts.ts).
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, money, periodLabel } from '@/lib/format';
import { exportTable } from '@/lib/export';
import { openQuickPay } from '@/lib/quickPayBus';
import {
  type ClassMonth, loadMonthlyDebts, type PayState, type StudentMonth,
} from '@/lib/monthlyDebts';
import { DebtReminderModal, type DebtTarget } from './DebtReminder';
import {
  Badge, Button, EmptyState, ErrorState, Input, Loading, Notice,
  PageHeader, Progress, Segmented, Stat,
} from '@/ui';
import { MonthPicker } from '@/ui/MonthPicker';
import { MonthClose } from './MonthClose';

type Filter = 'all' | 'unpaid' | 'partial' | 'paid';

const TONE: Record<PayState, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  paid: 'ok', partial: 'warn', unpaid: 'danger', none: 'neutral',
};

export default function Debts() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can } = useAuth();
  const [period, setPeriod] = useState(currentPeriod);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [remind, setRemind] = useState<DebtTarget | null>(null);
  //  "Oylar" — ota-onaga eslatma va oyni yopish (Hisobotlar o'rniga).
  const [tab, setTab] = useState<'classes' | 'months'>('classes');

  const q = useQuery({
    queryKey: ['debts-monthly', period, branchId],
    queryFn: () => loadMonthlyDebts(period, branchId),
    enabled: can('reports.view'),
  });

  //  Qidiruv va filtr o'quvchi darajasida; sinf faqat ichida mos
  //  o'quvchi qolsa ko'rinadi. Qidiruvda sinflar avtomatik ochiladi.
  const view = useMemo(() => {
    const n = search.trim().toLowerCase();
    return (q.data ?? []).map((c) => ({
      ...c,
      shown: c.students.filter((s) =>
        (filter === 'all' || s.state === filter) &&
        (!n || s.full_name.toLowerCase().includes(n) ||
          (s.payment_code ?? '').toLowerCase().includes(n))),
    })).filter((c) => c.shown.length > 0);
  }, [q.data, filter, search]);

  const totals = useMemo(() => {
    const all = q.data ?? [];
    const sum = (f: (c: ClassMonth) => number) => all.reduce((a, c) => a + f(c), 0);
    return {
      charged: sum((c) => c.charged),
      paid: sum((c) => c.paid),
      remaining: sum((c) => c.remaining),
      students: sum((c) => c.students.length),
      count: {
        paid: sum((c) => c.count.paid),
        partial: sum((c) => c.count.partial),
        unpaid: sum((c) => c.count.unpaid),
      },
    };
  }, [q.data]);

  if (!can('reports.view')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  const month = periodLabel(period, lang);
  const rate = totals.charged > 0 ? Math.round((totals.paid / totals.charged) * 100) : 0;
  const searching = search.trim() !== '';

  const toggle = (key: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const doExport = () => exportTable(
    `qarzdorlik-${period.slice(0, 7)}`,
    [
      { header: t('students.class'), value: (s: StudentMonth) => s.class_name },
      { header: t('common.fullName'), value: (s: StudentMonth) => s.full_name },
      { header: t('students.paymentCode'), value: (s: StudentMonth) => s.payment_code },
      { header: t('dm.charged'), value: (s: StudentMonth) => s.charged, numeric: true },
      { header: t('dm.paid'), value: (s: StudentMonth) => s.paid, numeric: true },
      { header: t('dm.remaining'), value: (s: StudentMonth) => s.remaining, numeric: true },
      { header: t('dm.status'), value: (s: StudentMonth) => t(`dm.state.${s.state}`) },
      { header: t('dm.totalDebt'), value: (s: StudentMonth) => s.totalDebt, numeric: true },
      {
        header: t('dm.debtMonths'),
        value: (s: StudentMonth) => s.unpaidPeriods.map((p) => periodLabel(p, lang)).join(', '),
      },
    ],
    view.flatMap((c) => c.shown),
    [t('debt.title'), month],
  );

  return (
    <>
      <PageHeader
        title={t('debt.title')}
        subtitle={t('dm.subtitle', { month, count: totals.students })}
        actions={
          <>
            <Segmented<'classes' | 'months'>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'classes', label: t('dm.tab.classes') },
                { value: 'months', label: t('mc.tab') },
              ]}
            />
            {tab === 'classes' && <>
              <MonthPicker value={period} onChange={(p) => { setPeriod(p); setOpen(new Set()); }} />
              <Button onClick={doExport} disabled={view.length === 0}>{t('common.export')}</Button>
            </>}
          </>
        }
      />

      {tab === 'months' ? <MonthClose /> : <>

      {q.isLoading ? <Loading /> : q.error ? (
        <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} />
      ) : totals.charged <= 0 && totals.students === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* --- Oy natijasi: 3 raqam, ortiqcha yo'q ------------------ */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={t('dm.charged')} value={money(totals.charged, lang)}
                  hint={t('dm.studentsCount', { count: totals.students })} />
            <Stat label={t('dm.paid')} value={money(totals.paid, lang)} tone="ok"
                  hint={t('dm.rate', { rate })}>
              <div className="mt-3"><Progress value={rate} /></div>
            </Stat>
            <div className="col-span-2 lg:col-span-1">
              <Stat label={t('dm.remaining')} value={money(totals.remaining, lang)}
                    tone={totals.remaining > 0 ? 'danger' : 'neutral'}
                    hint={t('dm.counts', {
                      unpaid: totals.count.unpaid, partial: totals.count.partial,
                    })} />
            </div>
          </div>

          {totals.charged <= 0 && (
            <div className="mb-4">
              <Notice tone="neutral">
                <strong>{t('dm.noInvoices')}</strong> {t('dm.noInvoicesHint')}
              </Notice>
            </div>
          )}

          {/* --- Filtr ----------------------------------------------- */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('dm.all') },
                { value: 'unpaid', label: <>{t('dm.state.unpaid')} <Count n={totals.count.unpaid} /></> },
                { value: 'partial', label: <>{t('dm.state.partial')} <Count n={totals.count.partial} /></> },
                { value: 'paid', label: <>{t('dm.state.paid')} <Count n={totals.count.paid} /></> },
              ]}
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('dm.search')}
              className="w-full sm:ml-auto sm:w-64"
            />
          </div>

          {/* --- Sinflar --------------------------------------------- */}
          {view.length === 0 ? (
            <div className="rounded-2xl border bg-[var(--bg)]">
              <EmptyState title={t('debt.noDebt')} hint="" />
            </div>
          ) : (
            <div className="space-y-2">
              {view.map((c) => (
                <ClassRow
                  key={c.key}
                  c={c}
                  rows={c.shown}
                  open={searching || open.has(c.key)}
                  onToggle={() => toggle(c.key)}
                  onRemind={setRemind}
                />
              ))}
            </div>
          )}
        </>
      )}

      </>}
      {remind && <DebtReminderModal target={remind} onClose={() => setRemind(null)} />}
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="num text-[11.5px] text-[var(--text-faint)]">{n}</span>;
}

// ---------------------------------------------------------------------

function ClassRow({
  c, rows, open, onToggle, onRemind,
}: {
  c: ClassMonth;
  rows: StudentMonth[];
  open: boolean;
  onToggle: () => void;
  onRemind: (t: DebtTarget) => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, branches } = useAuth();
  const multi = !branchId && branches.length > 1;
  const rate = c.charged > 0 ? Math.round((c.paid / c.charged) * 100) : 0;

  return (
    <section className="overflow-hidden rounded-2xl border bg-[var(--bg)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-subtle)] md:gap-5 md:px-5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>

        <div className="min-w-0 flex-1 md:flex-none md:basis-48">
          <div className="truncate text-[15px] font-semibold tracking-tight">{c.name}</div>
          <div className="truncate text-[12px] text-[var(--text-faint)]">
            {c.branch && multi ? `${c.branch} · ` : ''}{t('dm.studentsCount', { count: c.students.length })}
          </div>
        </div>

        <div className="hidden flex-1 items-center gap-2 md:flex">
          <Pill tone="ok" n={c.count.paid} label={t('dm.state.paid')} />
          <Pill tone="warn" n={c.count.partial} label={t('dm.state.partial')} />
          <Pill tone="danger" n={c.count.unpaid} label={t('dm.state.unpaid')} />
        </div>

        <div className="hidden w-40 lg:block">
          <Progress value={rate} />
          <div className="num mt-1 text-[11.5px] text-[var(--text-faint)]">
            {t('dm.rate', { rate })}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className={`num text-[15px] font-semibold ${c.remaining > 0 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>
            {c.remaining > 0 ? money(c.remaining, lang) : '✓'}
          </div>
          <div className="text-[11.5px] text-[var(--text-faint)] md:hidden">
            <span className="text-[var(--ok)]">{c.count.paid}</span>
            {' · '}<span className="text-[var(--warn)]">{c.count.partial}</span>
            {' · '}<span className="text-[var(--danger)]">{c.count.unpaid}</span>
          </div>
          <div className="hidden text-[11.5px] text-[var(--text-faint)] md:block">
            {t('dm.totalDebt')}: <span className="num">{money(c.totalDebt, lang)}</span>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--border-soft)]">
          {rows.map((s) => <StudentRow key={s.student_id} s={s} onRemind={onRemind} />)}
        </div>
      )}
    </section>
  );
}

function Pill({ tone, n, label }: { tone: 'ok' | 'warn' | 'danger'; n: number; label: string }) {
  if (n === 0) return null;
  return <Badge tone={tone}><span className="num mr-1 font-semibold">{n}</span>{label}</Badge>;
}

function StudentRow({ s, onRemind }: { s: StudentMonth; onRemind: (t: DebtTarget) => void }) {
  const t = useT();
  const { lang } = useI18n();
  const { mayWrite } = useAuth();
  const owes = s.totalDebt > 0.009;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--border-soft)]
      px-4 py-3 last:border-b-0 md:flex-nowrap md:px-5 md:pl-12">
      {/* Ism va holat */}
      <div className="min-w-0 flex-1 md:basis-56 md:flex-none">
        <Link to={`/oquvchilar/${s.student_id}`} className="block truncate text-[14px] font-medium hover:underline">
          {s.full_name}
        </Link>
        <div className="mt-0.5 flex items-center gap-2">
          <Badge tone={TONE[s.state]}>{t(`dm.state.${s.state}`)}</Badge>
          {s.payment_code && (
            <span className="num text-[11.5px] text-[var(--text-faint)]">{s.payment_code}</span>
          )}
        </div>
      </div>

      {/* Shu oy qarzi (to'langan / hisoblangan) */}
      <div className="w-[46%] md:w-40">
        <div className="text-[11.5px] text-[var(--text-faint)]">{t('dm.thisMonthDebt')}</div>
        {s.charged > 0 ? (
          <>
            <div className={`num text-[14px] font-semibold ${s.remaining > 0.009 ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>
              {s.remaining > 0.009 ? money(s.remaining, lang) : '✓'}
            </div>
            <div className="num text-[11.5px] text-[var(--text-faint)]">
              {money(s.paid, lang)} / {money(s.charged, lang)}
            </div>
          </>
        ) : <div className="text-[13px] text-[var(--text-faint)]">—</div>}
      </div>

      {/* Har bir qarz oyi va summasi */}
      <div className="min-w-0 flex-1">
        <div className="text-[11.5px] text-[var(--text-faint)]">{t('dm.debtMonths')}</div>
        {s.unpaidMonths.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {s.unpaidMonths.map((m) => (
              <span key={m.period} className="rounded-md bg-[var(--danger-bg)] px-1.5 py-0.5 text-[11.5px] text-[var(--danger)]">
                {periodLabel(m.period, lang)} · <span className="num font-medium">{money(m.owed, lang)}</span>
              </span>
            ))}
          </div>
        ) : <div className="text-[13px] text-[var(--text-faint)]">—</div>}
      </div>

      {/* Jami qarz */}
      <div className="w-[46%] text-right md:w-36">
        <div className="text-[11.5px] text-[var(--text-faint)]">
          {s.totalDebt < -0.009 ? t('dm.advance') : t('dm.totalDebt')}
        </div>
        <div className={`num text-[15px] font-semibold ${owes ? 'text-[var(--danger)]' : 'text-[var(--ok)]'}`}>
          {owes ? money(s.totalDebt, lang) : s.totalDebt < -0.009 ? money(-s.totalDebt, lang) : '✓'}
        </div>
      </div>

      {/* Amallar */}
      {owes && (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onRemind({
            student_id: s.student_id, full_name: s.full_name,
            class_name: s.class_name, payment_code: s.payment_code,
            balance: s.totalDebt, oldest_due: s.unpaidPeriods[0] ?? null,
          })}>
            {t('remind.button')}
          </Button>
          {mayWrite('payments.create') && (
            <Button size="sm" variant="primary" onClick={() => openQuickPay({
              student_id: s.student_id, full_name: s.full_name,
              class_name: s.class_name, payment_code: s.payment_code,
              balance: s.totalDebt,
            })}>
              {t('quickpay.payButton')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
