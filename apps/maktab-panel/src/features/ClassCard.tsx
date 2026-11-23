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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { useAuth } from '@/auth/AuthProvider';
import { date, money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Input, Loading,
  Money, Notice, PageHeader, Progress, Stat, Table, Td, Th, Tr,
} from '@/ui';
import { formatPhone } from '@/ui/PhoneInput';
import { useSort, useToast } from '@/ui/Feedback';
import { DeleteConfirmModal } from './StudentCard';
import { MonthPicker, periodEnd } from '@/ui/MonthPicker';
import { loadMonthlyDebts } from '@/lib/monthlyDebts';
import { currentPeriod as curPeriod } from '@/lib/format';

type SortKey = 'full_name' | 'payment_code' | 'charged' | 'paid' | 'remaining' | 'balance';

export default function ClassCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const { can, mayWrite } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();

  /**
   *  Sinfni o'chirish.
   *
   *  O'quvchilar sinf bilan birga O'CHMAYDI — ular maktabda qoladi,
   *  faqat sinfsiz bo'ladi. Aks holda bitta noto'g'ri bosish butun
   *  sinfni yo'q qilardi.
   */
  const [deleting, setDeleting] = useState(false);

  const removeClass = useMutation({
    mutationFn: async (v: { reason: string; force: boolean }) => {
      const { error } = await supabase.rpc('delete_class', {
        p_class_id: id!, p_reason: v.reason, p_force: v.force,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.ok(t('ux.saved'));
      nav('/sinflar');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  //  Hammasi TANLANGAN OY bo'yicha; "Jami qarz" — barcha oylar.
  const [period, setPeriod] = useState(curPeriod);
  const [search, setSearch] = useState('');
  const [onlyDebt, setOnlyDebt] = useState(false);
  const sort = useSort<SortKey>('full_name');

  const from = period;
  const to = periodEnd(period);

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
  const monthly = useQuery({
    queryKey: ['debts-monthly', period, null],
    enabled: !!id,
    queryFn: () => loadMonthlyDebts(period, null),
  });
  const fin = monthly.data?.find((c) => c.class_id === id) ?? null;
  const mBy = new Map((fin?.students ?? []).map((s) => [s.student_id, s] as const));

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
        .select('student_id, balance, overdue_charged, oldest_unpaid_due')
        .in('student_id', list.map((s) => s.id));
      if (be) throw be;

      const byId = new Map((bal ?? []).map((b) => [b.student_id, b] as const));
      return list.map((s) => ({
        ...s,
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
    let rows = (students.data ?? []).map((s) => {
      const m = mBy.get(s.id);
      return { ...s, charged: m?.charged ?? 0, paid: m?.paid ?? 0, remaining: m?.remaining ?? 0 };
    });
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) =>
        s.full_name.toLowerCase().includes(q) ||
        s.payment_code.toLowerCase().includes(q));
    }
    if (onlyDebt) rows = rows.filter((s) => s.balance > 0);
    // deno-lint-ignore no-explicit-any
    return sort.apply(rows, (r: any, k) => r[k]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students.data, monthly.data, search, onlyDebt, sort.apply]);

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

  const f = fin;
  const rate = f && f.charged > 0 ? Math.round(1000 * f.paid / f.charged) / 10 : 0;
  const active = (students.data ?? []).filter((s) => s.status === 'active').length;
  //  "Qarzdor" — muddati O'TGANI. Ilgari bu `balance > 0` edi va
  //  1-sentabrda hisoblanma qurilishi bilan butun maktab qarzdor
  //  bo'lib ko'rinardi, holbuki to'lov muddati 10-sentabr.
  const debtors = (students.data ?? []).filter((s) => s.overdue > 0).length;
  const overfull = c.capacity ? active > c.capacity : false;

  const SortTh = ({ k, children, align }: {
    k: SortKey; children: string; align?: 'right';
  }) => (
    <Th align={align}>
      <button type="button" onClick={() => sort.toggle(k)}
              className="font-medium hover:text-[var(--text)]">
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
            {mayWrite('students.manage') && (
              <Button variant="ghost" onClick={() => setDeleting(true)}>
                {t('common.delete')}
              </Button>
            )}
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
      <div className="mb-4">
        <MonthPicker value={period} onChange={setPeriod} />
      </div>

      {/* --- Jamlanma: 3 raqam ----------------------------------
           Ilgari 8 ta karta edi ("To'lanmagan", "Qoldiq", "Muddati
           o'tgan" — bir narsaning uch xil nomi). Endi: kim bor, qancha
           yig'ildi, qancha qoldi. Tafsilot izohda. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label={t('cls.students')}
          value={c.capacity ? `${active} / ${c.capacity}` : String(active)}
          hint={debtors > 0 ? `${t('cls.debtors')}: ${debtors}` : undefined}
          tone={debtors > 0 ? 'neutral' : 'neutral'}
        />
        <Stat label={t('cls.collected')} value={money(f?.paid ?? 0, lang)} tone="ok"
              hint={`${t('cls.charged')}: ${money(f?.charged, lang)}`}>
          <div className="mt-3 flex items-center gap-2">
            <Progress value={rate} />
            <span className="num shrink-0 text-[11.5px] text-[var(--text-muted)]">{rate}%</span>
          </div>
        </Stat>
        <Stat label={t('dm.thisMonthDebt')} value={money(f?.remaining ?? 0, lang)}
              tone={(f?.remaining ?? 0) > 0 ? 'danger' : 'neutral'}
              hint={(f?.totalDebt ?? 0) > 0
                ? `${t('dm.totalDebt')}: ${money(f?.totalDebt, lang)}` : undefined} />
      </div>

      {/* --- Sinf rahbari — alohida karta emas, bitta qator ------- */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-[var(--text-muted)]">
        <span>{t('cls.teacher')}:</span>
        {teacher
          ? <>
              <Link to={`/oqituvchilar/${teacher.id}`}
                    className="font-medium text-[var(--text)] hover:underline">
                {teacher.full_name}
              </Link>
              {teacher.phone && <span>· {formatPhone(teacher.phone)}</span>}
            </>
          : <span>{t('cls.noTeacher')}</span>}
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
                  <SortTh k="remaining" align="right">{t('dm.thisMonthDebt')}</SortTh>
                  <SortTh k="balance" align="right">{t('dm.totalDebt')}</SortTh>
                  {can('absences.mark') && (
                    <Th align="right">{t('cls.absences')}</Th>
                  )}
                  <Th>{t('common.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <Tr key={s.id} to={`/oquvchilar/${s.id}`}>
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
                      <Money value={s.remaining} colored />
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
      {deleting && (
        <DeleteConfirmModal
          title={`${t('common.delete')} — ${c.name}`}
          warning={t('cls.deleteWarning')}
          forceLabel={t('cls.deleteForce')}
          forceHint={t('cls.deleteForceHint')}
          onClose={() => setDeleting(false)}
          onSubmit={(reason, force) => removeClass.mutate({ reason, force })}
          busy={removeClass.isPending}
        />
      )}
    </>
  );
}
