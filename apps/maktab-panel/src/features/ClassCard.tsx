// =====================================================================
//  Sinf kartochkasi — bitta sinfning to'liq manzarasi.
//
//  Uch savolga bir ekranda javob beradi:
//    1. Bu sinfdan qancha yig'ilgan va YANA QANCHA KERAK
//    2. Qaysi o'quvchida qarz bor
//    3. Kim davomat qilmayapti
//
//  Sinf rahbari shu yerda ko'rinadi — oylikdagi `class_teacher`
//  ustamasi aynan shu bog'lanishga tayanadi (TZ 12.1.6).
// =====================================================================

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { useAuth } from '@/auth/AuthProvider';
import { date, money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading, Money,
  Notice, PageHeader, Table, Td, Th, Tr,
} from '@/ui';
import { formatPhone } from '@/ui/PhoneInput';
import { useSort } from '@/ui/Feedback';
import { DateRangePicker, useDateRange } from '@/ui/DateRange';

type SortKey = 'full_name' | 'payment_code' | 'charged' | 'paid' | 'balance';

export default function ClassCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const { can } = useAuth();

  const { range, setPreset, setCustom } = useDateRange();
  const [search, setSearch] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const sort = useSort<SortKey>('full_name');

  const { from, to } = range;

  // --- sinf va rahbari ----------------------------------------------
  const cls = useQuery({
    queryKey: ['class', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('classes')
        // MUHIM: `select` bitta harfiy satr bo'lishi shart — supabase-js
        // ustun turlarini aynan shu satrdan chiqaradi. Ulangan satr
        // `GenericStringError` beradi.
        .select('id, name, grade_level, capacity, academic_year, is_active, note, branch_id, teacher_id, branches(name), teachers(id, full_name, phone)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // --- moliyaviy jamlanma (sinf kesimidagi hisobotdan) --------------
  const fin = useQuery({
    queryKey: ['class-fin', id, from, to],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_by_class', {
        p_from: from, p_to: to,
      });
      if (error) throw error;
      return (data ?? []).find((r) => r.class_id === id) ?? null;
    },
  });

  // --- o'quvchilar ---------------------------------------------------
  const students = useQuery({
    queryKey: ['class-students', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, payment_code, status, birth_date, enrolled_on')
        .eq('class_id', id!)
        .is('deleted_at', null)
        .order('full_name');
      if (error) throw error;
      const list = data ?? [];
      if (list.length === 0) return [];

      const { data: bal, error: be } = await supabase
        .from('v_student_balances')
        .select('student_id, charged, paid, balance, overdue_charged, oldest_unpaid_due')
        .in('student_id', list.map((s) => s.id));
      if (be) throw be;

      const byId = new Map((bal ?? []).map((b) => [b.student_id, b] as const));
      return list.map((s) => ({
        ...s,
        charged: Number(byId.get(s.id)?.charged ?? 0),
        paid: Number(byId.get(s.id)?.paid ?? 0),
        balance: Number(byId.get(s.id)?.balance ?? 0),
        overdue: Number(byId.get(s.id)?.overdue_charged ?? 0),
        oldest_due: byId.get(s.id)?.oldest_unpaid_due ?? null,
      }));
    },
  });

  // --- shu oydagi yo'qlik --------------------------------------------
  const absences = useQuery({
    queryKey: ['class-absences', id, from, to],
    enabled: !!id && can('absences.mark'),
    queryFn: async () => {
      const ids = (students.data ?? []).map((s) => s.id);
      if (ids.length === 0) return new Map<string, number>();
      const { data, error } = await supabase
        .from('absences')
        .select('student_id')
        .in('student_id', ids)
        .gte('day', from)
        .lte('day', to);
      if (error) throw error;
      const m = new Map<string, number>();
      for (const a of data ?? []) {
        m.set(a.student_id, (m.get(a.student_id) ?? 0) + 1);
      }
      return m;
    },
  });

  const list = useMemo(() => {
    let rows = students.data ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.payment_code.toLowerCase().includes(q));
    }
    if (onlyDebt) rows = rows.filter((s) => s.balance > 0);
    // deno-lint-ignore no-explicit-any
    return sort.apply(rows, (r: any, k) => r[k]);
  }, [students.data, search, onlyDebt, sort.apply]);

  if (!can('students.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (cls.isLoading) return <Loading />;
  if (cls.error) {
    return <ErrorState message={(cls.error as Error).message}
                       onRetry={() => cls.refetch()} />;
  }
  if (!cls.data) return <Notice tone="danger">{t('cls.notFound')}</Notice>;

  const c = cls.data;
  // deno-lint-ignore no-explicit-any
  const teacher = c.teachers as any;
  // deno-lint-ignore no-explicit-any
  const branch = c.branches as any;

  const f = fin.data;
  const rate = Number(f?.collection_rate ?? 0);
  const active = (students.data ?? []).filter((s) => s.status === 'active').length;
  const debtors = (students.data ?? []).filter((s) => s.balance > 0).length;
  const overfull = c.capacity ? active > c.capacity : false;

  const SortTh = ({ k, children, align }: {
    k: SortKey; children: string; align?: 'right';
  }) => (
    <Th align={align}>
      <button type="button" onClick={() => sort.toggle(k)}
              className="font-semibold uppercase hover:text-[var(--text)]">
        {children}{sort.indicator(k)}
      </button>
    </Th>
  );

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={[
          branch?.name,
          c.academic_year,
          c.grade_level ? t('cls.gradeN', { n: c.grade_level }) : null,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <Link to="/sinflar">
              <Button>← {t('cls.title')}</Button>
            </Link>
            <Button
              disabled={list.length === 0}
              onClick={() => exportTable(
                `sinf-${c.name}`,
                [
                  { header: t('common.fullName'), value: (s) => s.full_name },
                  { header: t('students.paymentCode'), value: (s) => s.payment_code },
                  { header: t('rep.charged'), value: (s) => s.charged, numeric: true },
                  { header: t('rep.collected'), value: (s) => s.paid, numeric: true },
                  { header: t('debt.title'), value: (s) => s.balance, numeric: true },
                ],
                list,
                [`${c.name} — ${branch?.name ?? ''}`, `${from} — ${to}`],
              )}
            >
              {t('common.export')}
            </Button>
          </>
        }
      />

      {!c.is_active && (
        <div className="mb-3">
          <Notice tone="warn">{t('cls.inactive')}</Notice>
        </div>
      )}
      {overfull && (
        <div className="mb-3">
          <Notice tone="danger">
            {t('cls.overCapacity', { count: active, capacity: c.capacity! })}
          </Notice>
        </div>
      )}

      {/* --- Davr tanlash ----------------------------------------
          Moliyaviy ko'rsatkichlar va yo'qlik shu oraliq bo'yicha.
          O'quvchilar ro'yxati esa bugungi holat — u sanaga bog'liq
          emas, chunki sinf tarkibi tarixi saqlanmaydi. --- */}
      <Card className="mb-3">
        <DateRangePicker range={range} onPreset={setPreset} onCustom={setCustom}
                         compact />
      </Card>

      {/* --- Moliyaviy jamlanma ---------------------------------- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('cls.charged')} value={money(f?.charged, lang)}
              hint={t('cls.chargedHint')} />
        <Stat label={t('cls.collected')} value={money(f?.collected, lang)}
              tone="ok" />
        <Stat label={t('cls.remaining')} value={money(f?.remaining, lang)}
              tone="danger" hint={t('cls.remainingHint')} />
        <Stat
          label={t('cls.rate')}
          value={`${rate}%`}
          tone={rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger'}
          bar={rate}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('cls.students')} value={String(active)}
              hint={c.capacity ? t('cls.ofCapacity', { capacity: c.capacity }) : undefined} />
        <Stat label={t('cls.debtors')} value={String(debtors)}
              tone={debtors > 0 ? 'warn' : 'ok'} />
        <Stat label={t('cls.totalDebt')} value={money(f?.debt, lang)}
              tone="danger" hint={t('cls.totalDebtHint')} />
        <Stat label={t('cls.avgPerStudent')}
              value={money(f?.avg_per_student, lang)} />
      </div>

      {/* --- Sinf rahbari ---------------------------------------- */}
      <div className="mb-4">
        <Card title={t('cls.teacher')}>
          {teacher
            ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link to={`/oqituvchilar/${teacher.id}`}
                        className="text-sm font-medium hover:underline">
                    {teacher.full_name}
                  </Link>
                  {teacher.phone && (
                    <div className="text-[13px] text-[var(--text-muted)]">
                      {formatPhone(teacher.phone)}
                    </div>
                  )}
                </div>
                <Badge tone="brand">{t('cls.teacherBadge')}</Badge>
              </div>
            )
            : (
              <p className="text-[13px] text-[var(--text-muted)]">
                {t('cls.noTeacher')}
              </p>
            )}
        </Card>
      </div>

      {c.note && (
        <div className="mb-4">
          <Card title={t('common.note')}>
            <p className="whitespace-pre-line text-[13px]">{c.note}</p>
          </Card>
        </div>
      )}

      {/* --- O'quvchilar ----------------------------------------- */}
      <Card
        title={`${t('cls.studentList')} · ${list.length}`}
        action={
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('common.search')}
              className="h-7 w-40 text-[13px]"
            />
            <label className="flex items-center gap-1.5 text-[13px]
              text-[var(--text-muted)]">
              <input type="checkbox" checked={onlyDebt}
                     onChange={(e) => setOnlyDebt(e.target.checked)} />
              {t('debt.onlyDebt')}
            </label>
          </div>
        }
        padded={false}
      >
        {students.isLoading
          ? <Loading />
          : list.length === 0
          ? <EmptyState title={t('cls.noStudents')} hint={t('cls.noStudentsHint')} />
          : (
            <Table>
              <thead>
                <tr>
                  <SortTh k="full_name">{t('common.fullName')}</SortTh>
                  <SortTh k="payment_code">{t('students.paymentCode')}</SortTh>
                  <SortTh k="charged" align="right">{t('rep.charged')}</SortTh>
                  <SortTh k="paid" align="right">{t('rep.collected')}</SortTh>
                  <SortTh k="balance" align="right">{t('debt.title')}</SortTh>
                  {can('absences.mark') && (
                    <Th align="right">{t('cls.absences')}</Th>
                  )}
                  <Th>{t('common.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link to={`/oquvchilar/${s.id}`}
                            className="font-medium hover:underline">
                        {s.full_name}
                      </Link>
                    </Td>
                    <Td mono className="text-[var(--text-muted)]">
                      {s.payment_code}
                    </Td>
                    <Td align="right" mono>{money(s.charged, lang)}</Td>
                    <Td align="right" mono className="text-[var(--ok)]">
                      {money(s.paid, lang)}
                    </Td>
                    <Td align="right" mono>
                      <Money value={s.balance} colored bold={s.overdue > 0} />
                      {s.overdue > 0 && (
                        <div className="text-[11px] text-[var(--danger)]">
                          {t('debt.overdueSince', { date: date(s.oldest_due, lang) })}
                        </div>
                      )}
                    </Td>
                    {can('absences.mark') && (
                      <Td align="right" mono>
                        {absences.data?.get(s.id) ?? 0}
                      </Td>
                    )}
                    <Td>
                      <Badge tone={s.status === 'active' ? 'ok' : 'neutral'}>
                        {t(`students.status.${s.status}`)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------

function Stat({
  label, value, hint, tone = 'neutral', bar,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'danger';
  /** 0–100 — foiz chizig'i. */
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
