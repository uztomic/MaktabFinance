// =====================================================================
//  Boshqaruv paneli — to'liq moliyaviy manzara.
//
//  TZ 1.2 dagi asosiy muammo: "Direktor moliyaviy natijani oy tugagandan
//  5–7 kun keyin biladi." Bu ekran shu savollarga BIR QARASHDA javob
//  beradi:
//
//    · qancha hisoblangan (kutilgan tushum)
//    · qancha yig'ilgan va YANA QANCHA YIG'ILISHI KERAK
//    · yig'ish foizi — reja qanchalik bajarilgan
//    · xarajat: XODIMLAR OYLIGI alohida, qolgani alohida
//    · foyda: xarajatsiz, oyliksiz va sof
//    · naqd holat — kassada haqiqatda qancha qoldi
//    · to'lov usuli — naqd, karta, Click… qaysi biridan qancha
//    · sinf kesimi — qaysi sinfdan qancha yig'ilgan
//    · 12 oylik dinamika — o'sish bormi
// =====================================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate, type Lang, money, periodLabel } from '@/lib/format';
import {
  Badge, Card, EmptyState, ErrorState, Loading, Money, Notice,
  PageHeader, Table, Td, Th, Tr,
} from '@/ui';
import { DateRangePicker, useDateRange } from '@/ui/DateRange';

export default function Dashboard() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, can, profile } = useAuth();
  const { range, setPreset, setCustom } = useDateRange();
  const { from, to } = range;

  const canSeeFinance = can('reports.view');
  const branch = branchId ?? undefined;

  // --- Umumiy moliyaviy jamlanma -----------------------------------
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

  // --- O'tgan oy (taqqoslash uchun) --------------------------------
  const prev = useQuery({
    queryKey: ['fin-summary-prev', from, branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      // Taqqoslash uchun — AYNAN SHUNCHA uzunlikdagi oldingi oraliq.
      // Oy bilan cheklanib bo'lmaydi: foydalanuvchi chorak yoki
      // o'quv yilini tanlagan bo'lishi mumkin, o'shanda "o'tgan oy"
      // bilan solishtirish ma'nosiz.
      const a = new Date(from);
      const b = new Date(to);
      const days = Math.max(1, Math.round((+b - +a) / 86400000) + 1);
      const prevTo = new Date(+a - 86400000);
      const prevFrom = new Date(+prevTo - (days - 1) * 86400000);

      const { data, error } = await supabase.rpc('report_financial_summary', {
        p_from: isoDate(prevFrom), p_to: isoDate(prevTo), p_branch_id: branch,
      });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  // --- Sinf kesimi --------------------------------------------------
  const classes = useQuery({
    queryKey: ['dash-classes', from, to, branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_by_class', {
        p_from: from, p_to: to, p_branch_id: branch,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- 12 oylik dinamika --------------------------------------------
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

  // --- Ogohlantirishlar ----------------------------------------------
  // --- To'lov usullari kesimi --------------------------------------
  //  "Bankdagi pul kassadagidan qancha ko'p" degan savol oyning har
  //  kunida chiqadi. Ilgari javob yo'q edi: barcha to'lov bir xil
  //  ko'rinardi va faqat kanal (kassa/bank/chek) saqlanardi.
  const methods = useQuery({
    queryKey: ['pay-methods-report', from, to, branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_payment_methods', {
        p_from: from, p_to: to, p_branch_id: branch,
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

  /**
   *  Jim ishlamay turgan joylar.
   *
   *  Tizimning eng yomon xatosi — xato bermaydigani. Ota-onasi
   *  kiritilmagan maktabda Telegram xabarlari hech kimga bormaydi,
   *  lekin hech qayerda qizil yozuv chiqmaydi: navbatga qo'yilgan
   *  xabar soni shunchaki nol bo'ladi. Maktab esa tizim ishlayapti
   *  deb o'ylab yuraveradi.
   */
  const setup = useQuery({
    queryKey: ['setup-issues', branchId],
    enabled: canSeeFinance,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('school_setup_issues', {
        p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        code: string; severity: string; count: number;
      }>;
    },
  });

  /**
   *  Bugungi davomat — butun maktab bo'yicha.
   *
   *  Direktorning ertalabki savoli: nechta bola keldi, qaysi sinf
   *  davomatni olmagan. Ilgari bu faqat alohida sahifada edi va
   *  odatda ochilmasdi.
   */
  const attendance = useQuery({
    queryKey: ['dash-attendance', branchId],
    enabled: canSeeFinance || can('absences.mark'),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_attendance_today', {
        p_day: isoDate(), p_branch_id: branch,
      });
      if (error) throw error;
      return data ?? [];
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

  const students = useQuery({
    queryKey: ['students-count', branchId],
    enabled: can('students.view') || canSeeFinance,
    queryFn: async () => {
      let q = supabase.from('students')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active').is('deleted_at', null);
      if (branchId) q = q.eq('branch_id', branchId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  if (summary.isLoading && students.isLoading) return <Loading />;
  if (summary.error) {
    return <ErrorState message={(summary.error as Error).message}
                       onRetry={() => summary.refetch()} />;
  }

  const s = summary.data;
  const p = prev.data;
  const N = (v: unknown) => Number(v ?? 0);

  /** O'tgan oyga nisbatan o'zgarish foizi. */
  const delta = (cur: unknown, old: unknown) => {
    const c = N(cur), o = N(old);
    if (!o) return null;
    return Math.round(((c - o) / Math.abs(o)) * 100);
  };

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={`${profile?.school_name} · ${date(from, lang)} — ${date(to, lang)}`}
      />

      {/* Butun panel shu oraliq bo'yicha. Tanlov saqlanadi va boshqa
          sahifalarga ham o'tadi — buxgalter uni bir marta qo'yadi. */}
      <Card className="mb-4">
        <DateRangePicker range={range} onPreset={setPreset} onCustom={setCustom}
                         compact />
      </Card>

      {/* --- Bugungi davomat --------------------------------------- */}
      {(attendance.data?.length ?? 0) > 0 && (
        <TodayAttendance rows={attendance.data!} />
      )}

      {/* --- Ogohlantirishlar ------------------------------------- */}
      <div className="mb-4 space-y-2">
        {(setup.data?.length ?? 0) > 0 && (
          <SetupIssues rows={setup.data!} />
        )}
        {(gaps.data?.length ?? 0) > 0 && (
          <Notice tone="warn">
            <strong>{t('dashboard.absenceWarning')}: </strong>
            {t('dashboard.absenceWarningHint', { count: gaps.data!.length })}{' '}
            <Link to="/yoqlik" className="font-medium underline">
              {t('nav.absences')}
            </Link>
          </Notice>
        )}
        {(proofs.data ?? 0) > 0 && (
          <Notice tone="neutral">
            <strong>{t('dashboard.pendingProofs')}: </strong>{proofs.data}{' '}
            <Link to="/tolovlar" className="font-medium underline">
              {t('nav.payments')}
            </Link>
          </Notice>
        )}
      </div>

      {!canSeeFinance
        ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('dashboard.students')} value={String(students.data ?? '—')} />
          </div>
        )
        : !s
        ? <EmptyState />
        : (
          <>
            {/* ============ TUSHUM ============ */}
            <section className="mb-4">
              <SectionTitle>{t('rep.charged')} / {t('rep.collected')}</SectionTitle>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label={t('cls.charged')}
                  value={money(s.charged, lang)}
                  hint={t('dashboard.thisMonth')}
                  delta={delta(s.charged, p?.charged)}
                />
                <Stat
                  label={t('cls.collected')}
                  value={money(s.collected, lang)}
                  tone="ok"
                  delta={delta(s.collected, p?.collected)}
                />
                <Stat
                  label={t('cls.debt')}
                  value={money(s.remaining, lang)}
                  tone="danger"
                  hint={`${t('debt.title')}: ${money(s.total_debt, lang)}`}
                />
                <ProgressStat
                  label={t('cls.avg')}
                  rate={N(s.collection_rate)}
                  paid={N(s.paid_students)}
                  total={N(s.students)}
                />
              </div>
            </section>

            {/* ============ XARAJAT ============ */}
            <section className="mb-4">
              <SectionTitle>{t('rep.expenses')}</SectionTitle>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label={t('nav.payroll')}
                  value={money(s.payroll, lang)}
                  hint={t('exp.auto')}
                  delta={delta(s.payroll, p?.payroll)}
                  invertDelta
                />
                <Stat
                  label={t('exp.title')}
                  value={money(s.other_expenses, lang)}
                  delta={delta(s.other_expenses, p?.other_expenses)}
                  invertDelta
                />
                <Stat
                  label={t('common.total')}
                  value={money(s.total_expenses, lang)}
                  tone="danger"
                />
                <Stat
                  label={t('dashboard.students')}
                  value={String(s.students)}
                  hint={`${s.paid_students} — ${t('students.settled').toLowerCase()}`}
                />
              </div>
            </section>

            {/* ============ FOYDA ============ */}
            <section className="mb-4">
              <SectionTitle>{t('fin.netProfit')}</SectionTitle>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label={`${t('rep.profit')} — ${t('exp.title').toLowerCase()}siz`}
                  value={money(s.profit_before_expenses, lang)}
                  tone="ok"
                />
                <Stat
                  label={`${t('rep.profit')} — ${t('nav.payroll').toLowerCase()}siz`}
                  value={money(s.profit_before_payroll, lang)}
                  tone={N(s.profit_before_payroll) >= 0 ? 'ok' : 'danger'}
                />
                <Stat
                  label={t('fin.netProfit')}
                  value={money(s.profit_net, lang)}
                  tone={N(s.profit_net) >= 0 ? 'ok' : 'danger'}
                  big
                  delta={delta(s.profit_net, p?.profit_net)}
                />
                <Stat
                  label={t('rep.cash')}
                  value={money(s.cash_position, lang)}
                  tone={N(s.cash_position) >= 0 ? 'ok' : 'danger'}
                  hint={`${t('cls.collected')} − ${t('rep.expenses').toLowerCase()}`}
                />
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-2">
              {/* --- Sinf kesimi --------------------------------- */}
              <Card
                title={t('fin.topClasses')}
                action={
                  <Link to="/sinflar"
                        className="text-[13px] text-brand-600 hover:underline">
                    {t('cls.title')}
                  </Link>
                }
                padded={false}
              >
                {(classes.data?.length ?? 0) === 0 ? <EmptyState hint="" /> : (
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t('students.class')}</Th>
                        <Th align="right">{t('cls.charged')}</Th>
                        <Th align="right">{t('cls.collected')}</Th>
                        <Th align="right">{t('cls.debt')}</Th>
                        <Th align="right">%</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {classes.data!.map((c) => (
                        <Tr key={c.class_id}>
                          <Td>
                            <Link to={`/sinflar/${c.class_id}`}
                                  className="font-medium hover:underline">
                              {c.class_name}
                            </Link>
                            <span className="ml-1.5 text-[11px]
                              text-[var(--text-faint)]">
                              {c.students}
                            </span>
                          </Td>
                          <Td align="right" mono>{money(c.charged, lang)}</Td>
                          <Td align="right" mono className="text-[var(--ok)]">
                            {money(c.collected, lang)}
                          </Td>
                          <Td align="right" mono>
                            <Money value={c.remaining} colored />
                          </Td>
                          <Td align="right">
                            <Badge tone={N(c.collection_rate) >= 80 ? 'ok'
                              : N(c.collection_rate) >= 50 ? 'warn' : 'danger'}>
                              {c.collection_rate}%
                            </Badge>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>

              {/* --- 12 oylik dinamika --------------------------- */}
              <Card title={t('fin.trend')} padded={false}>
                <TrendChart rows={trend.data ?? []} />
              </Card>

              {/* --- To'lov usullari ----------------------------- */}
              <Card title={t('payMethod.breakdown')} padded={false}>
                {(methods.data?.length ?? 0) === 0
                  ? <EmptyState hint="" />
                  : <MethodBreakdown rows={methods.data!} lang={lang} t={t} />}
              </Card>
            </div>
          </>
        )}
    </>
  );
}

// ---------------------------------------------------------------------

/**
 *  To'lov usullari kesimi.
 *
 *  Diagramma emas, ULUSH CHIZIG'I bilan jadval: raqam ham, nisbat ham
 *  bir vaqtda ko'rinadi va bosib chiqarishda ham qoladi.
 */
function MethodBreakdown({ rows, lang, t }: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
  lang: Lang;
  t: (k: string) => string;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{t('payMethod.label')}</Th>
          <Th align="right">{t('pay.count')}</Th>
          <Th align="right">{t('common.amount')}</Th>
          <Th align="right">%</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <Tr key={m.method_id}>
            <Td>
              <span className="mr-1.5">{m.is_cash ? '💵' : '💳'}</span>
              {m.method_name}
            </Td>
            <Td align="right" mono>{m.payments}</Td>
            <Td align="right" mono>{money(m.amount, lang)}</Td>
            <Td align="right">
              <div className="flex items-center justify-end gap-1.5">
                <span className="h-1.5 w-16 overflow-hidden rounded-full
                  bg-[var(--bg-inset)]">
                  <span
                    className="block h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.min(100, Number(m.share))}%` }}
                  />
                </span>
                <span className="num w-10 text-right text-[13px]">
                  {m.share}%
                </span>
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider
      text-[var(--text-faint)]">
      {children}
    </h2>
  );
}

function Stat({
  label, value, tone = 'neutral', hint, delta, invertDelta, big,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'ok' | 'danger';
  hint?: string;
  /** O'tgan oyga nisbatan foiz. null — taqqoslash yo'q. */
  delta?: number | null;
  /** Xarajat uchun: o'sish YOMON, shuning uchun rang teskari. */
  invertDelta?: boolean;
  big?: boolean;
}) {
  const color = tone === 'ok'
    ? 'text-[var(--ok)]'
    : tone === 'danger'
    ? 'text-[var(--danger)]'
    : 'text-[var(--text)]';

  const good = delta === null || delta === undefined
    ? null
    : invertDelta ? delta <= 0 : delta >= 0;

  return (
    <div className={`rounded-lg border bg-[var(--bg)] px-4 py-3
      ${big ? 'ring-1 ring-brand-200' : ''}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide
        text-[var(--text-muted)]">
        {label}
      </div>
      <div className={`num mt-1 font-semibold tracking-tight
        ${big ? 'text-2xl' : 'text-xl'} ${color}`}>
        {value}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        {delta !== null && delta !== undefined && (
          <span className={`num text-[11px] font-medium
            ${good ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : ''} {Math.abs(delta)}%
          </span>
        )}
        {hint && (
          <span className="text-[11px] text-[var(--text-faint)]">{hint}</span>
        )}
      </div>
    </div>
  );
}

/** Yig'ish foizi — chiziq bilan, chunki foiz raqamdan ko'ra ko'rinishli. */
function ProgressStat({
  label, rate, paid, total,
}: {
  label: string;
  rate: number;
  paid: number;
  total: number;
}) {
  const t = useT();
  const tone = rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger';
  const bar = tone === 'ok'
    ? 'bg-[var(--ok)]'
    : tone === 'warn'
    ? 'bg-[var(--warn)]'
    : 'bg-[var(--danger)]';

  return (
    <div className="rounded-lg border bg-[var(--bg)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide
        text-[var(--text-muted)]">
        {t('cls.collected')} %
      </div>
      <div className="num mt-1 text-xl font-semibold tracking-tight">
        {rate}%
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full
        bg-[var(--bg-inset)]">
        <div className={`h-full ${bar}`}
             style={{ width: `${Math.min(100, Math.max(0, rate))}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-[var(--text-faint)]">
        {paid}/{total} — {label.toLowerCase()}
      </div>
    </div>
  );
}

/**
 * 12 oylik dinamika — ustunli diagramma.
 * Kutubxonasiz: har bir oy ikkita ustun (hisoblangan / xarajat) va
 * sof foyda chizig'i rangda ko'rsatiladi.
 */
function TrendChart({
  // deno-lint-ignore no-explicit-any
  rows,
}: {
  // deno-lint-ignore no-explicit-any
  rows: any[];
}) {
  const t = useT();
  const { lang } = useI18n();

  const data = useMemo(() =>
    rows.map((r) => {
      const charged = Number(r.charged ?? 0);
      const expenses = Number(r.payroll ?? 0) + Number(r.other_expenses ?? 0);
      return {
        period: String(r.period),
        charged,
        collected: Number(r.collected ?? 0),
        expenses,
        profit: charged - expenses,
      };
    }), [rows]);

  const max = Math.max(1, ...data.map((d) => Math.max(d.charged, d.expenses)));

  if (data.length === 0) return <EmptyState hint="" />;

  return (
    <div className="p-4">
      <p className="mb-3 text-[12px] text-[var(--text-muted)]">
        {t('fin.trendHint')}
      </p>

      <div className="flex items-end gap-1.5" style={{ height: 140 }}>
        {data.map((d) => (
          <div key={d.period} className="group relative flex flex-1 flex-col
            items-center justify-end gap-0.5" style={{ height: '100%' }}>
            {/* Tushum */}
            <div
              className="w-full rounded-t bg-brand-500"
              style={{ height: `${(d.charged / max) * 100}%`, minHeight: 2 }}
            />
            {/* Xarajat — ustidan yupqa qatlam */}
            <div
              className="w-full rounded-t bg-[var(--danger)] opacity-70"
              style={{ height: `${(d.expenses / max) * 100}%`, minHeight: 2 }}
            />

            {/* Sichqoncha ustiga kelganda tafsilot */}
            <div className="pointer-events-none absolute bottom-full z-10 mb-1
              hidden w-40 rounded-md border bg-[var(--bg)] p-2 text-[11px]
              shadow-lg group-hover:block">
              <div className="font-medium">{periodLabel(d.period, lang)}</div>
              <Row label={t('cls.charged')} value={money(d.charged, lang)} />
              <Row label={t('cls.collected')} value={money(d.collected, lang)} />
              <Row label={t('rep.expenses')} value={money(d.expenses, lang)} />
              <div className="mt-1 flex justify-between border-t pt-1 font-medium">
                <span>{t('fin.netProfit')}</span>
                <span className={`num ${d.profit >= 0
                  ? 'text-[var(--ok)]' : 'text-[var(--danger)]'}`}>
                  {money(d.profit, lang)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[10px]
        text-[var(--text-faint)]">
        <span>{periodLabel(data[0].period, lang)}</span>
        <span>{periodLabel(data[data.length - 1].period, lang)}</span>
      </div>

      <div className="mt-3 flex gap-4 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-brand-500" />
          {t('cls.charged')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[var(--danger)] opacity-70" />
          {t('rep.expenses')}
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

/**
 *  Sozlamadagi jim kamchiliklar.
 *
 *  Har biri uchun javob boshqacha, shuning uchun ular bitta xabarga
 *  qo'shilmaydi: og'irligi bo'yicha guruhlanadi va har biriga
 *  tuzatiladigan sahifaga havola beriladi.
 */
function SetupIssues({ rows }: {
  rows: Array<{ code: string; severity: string; count: number }>;
}) {
  const t = useT();

  const LINK: Record<string, string> = {
    no_parent: '/oquvchilar',
    parent_no_telegram: '/oquvchilar',
    no_contract: '/oquvchilar',
    no_class: '/oquvchilar',
    teacher_no_branch: '/oqituvchilar',
    teacher_no_login: '/oqituvchilar',
    class_no_teacher: '/sinflar',
  };

  //  Eng og'iri tepada — kassir birinchi shuni ko'rsin.
  const order = { danger: 0, warn: 1, info: 2 } as Record<string, number>;
  const sorted = [...rows].sort(
    (a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9),
  );

  const worst = sorted[0]?.severity === 'danger' ? 'danger' : 'warn';

  return (
    <Notice tone={worst}>
      <div className="space-y-1">
        <strong>{t('setup.title')}</strong>
        {sorted.map((r) => (
          <p key={r.code}>
            {t(`setup.${r.code}`, { count: r.count })}{' '}
            <Link to={LINK[r.code] ?? '/'} className="font-medium underline">
              {t('setup.fix')}
            </Link>
          </p>
        ))}
      </div>
    </Notice>
  );
}


/**
 *  Bugungi davomat — sinflar kesimida.
 *
 *  Eng muhim ustun "olinmagan": davomat olinmasa, kunlik xizmat
 *  noto'g'ri hisoblanadi va ota-onaga xabar ketmaydi. Shuning uchun
 *  olinmagan sinflar TEPADA turadi.
 */
function TodayAttendance({ rows }: {
  rows: Array<{
    class_id: string; class_name: string; teacher_name: string | null;
    total: number; present: number; absent: number;
    checked: boolean; marked_at: string | null;
  }>;
}) {
  const t = useT();
  const { lang } = useI18n();

  const working = rows.filter((r) => r.total > 0);
  if (working.length === 0) return null;

  const sorted = [...working].sort((a, b) =>
    Number(a.checked) - Number(b.checked));

  const total   = working.reduce((s, r) => s + r.total, 0);
  const marked  = working.filter((r) => r.checked);
  const present = marked.reduce((s, r) => s + r.present, 0);
  const absent  = marked.reduce((s, r) => s + r.absent, 0);
  const pending = working.length - marked.length;

  return (
    <Card
      title={`${t('att.todayTitle')} · ${date(isoDate(), lang)}`}
      className="mb-4"
      padded={false}
    >
      <div className="grid gap-3 p-3 sm:grid-cols-4">
        <Mini label={t('nav.students')} value={String(total)} />
        <Mini label={t('att.present')} value={String(present)} tone="ok" />
        <Mini label={t('att.absent')} value={String(absent)}
              tone={absent > 0 ? 'danger' : undefined} />
        <Mini label={t('att.notMarked')} value={String(pending)}
              tone={pending > 0 ? 'warn' : 'ok'} />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>{t('students.class')}</Th>
            <Th>{t('cls.teacher')}</Th>
            <Th align="right">{t('att.expected')}</Th>
            <Th align="right">{t('att.present')}</Th>
            <Th align="right">{t('att.absent')}</Th>
            <Th>{t('common.status')}</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <Tr key={r.class_id} className={r.checked ? '' : 'bg-[var(--warn-bg)]'}>
              <Td>
                <Link to={`/sinflar/${r.class_id}`}
                      className="font-medium hover:underline">
                  {r.class_name}
                </Link>
              </Td>
              <Td className="text-[var(--text-muted)]">
                {r.teacher_name ?? '—'}
              </Td>
              <Td align="right" mono>{r.total}</Td>
              <Td align="right" mono>{r.checked ? r.present : '—'}</Td>
              <Td align="right" mono
                  className={r.absent > 0 ? 'text-[var(--danger)]' : ''}>
                {r.checked ? r.absent : '—'}
              </Td>
              <Td>
                {r.checked
                  ? <Badge tone="ok">{t('att.marked')}</Badge>
                  : <Badge tone="warn">{t('att.notMarked')}</Badge>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Mini({ label, value, tone }: {
  label: string; value: string; tone?: 'ok' | 'warn' | 'danger';
}) {
  const color = tone === 'ok' ? 'text-[var(--ok)]'
    : tone === 'warn' ? 'text-[var(--warn)]'
    : tone === 'danger' ? 'text-[var(--danger)]' : '';
  return (
    <div className="rounded-md bg-[var(--bg-subtle)] px-3 py-2">
      <div className="text-[11px] uppercase text-[var(--text-muted)]">{label}</div>
      <div className={`num text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
