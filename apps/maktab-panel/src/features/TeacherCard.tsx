// =====================================================================
//  O'qituvchi kartochkasi.
//
//  Ikkita bo'shliqni yopadi:
//
//  · TZ 12.1.6 — ustamalar KATALOGI oylik formulasida, lekin KIM
//    qaysi ustamani olishi shu yerda belgilanadi. Busiz katalog
//    ishlamaydi: `calc_payroll` teacher_allowances jadvalidan o'qiydi.
//
//  · TZ 4.11.6 — avans. Oylik hisobida manfiy qator bo'lib ushlanadi.
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, date, isoDate, money, num, periodLabel } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import {
  createTeacherLogin, type NewLogin, TeacherCredentials, TeacherModal,
  useSaveTeacher,
} from './teacher/TeacherForm';
import { useToast } from '@/ui/Feedback';

interface CatalogRow {
  code: string;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
}

export default function TeacherCard() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { branches, mayWrite, profile } = useAuth();

  const [editOpen, setEditOpen] = useState(false);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const saveTeacher = useSaveTeacher(() => setEditOpen(false), setNewLogin);

  /**
   *  Mavjud o'qituvchiga hisob yaratish.
   *
   *  Ilgari buni faqat qo'shish paytida qilish mumkin edi. O'sha payt
   *  tarmoq xatosi bo'lsa yoki belgi qo'yilmagan bo'lsa, o'qituvchi
   *  hisobsiz qolib ketardi va tuzatishning yagona yo'li uni
   *  o'chirib qayta yaratish edi — ya'ni ma'lumot yo'qotish.
   */
  const makeLogin = useMutation({
    mutationFn: async () => {
      // deno-lint-ignore no-explicit-any
      const t2 = teacher.data as any;
      const branchId = t2?.teacher_branches?.[0]?.branch_id;
      if (!branchId) throw new Error(t('setup.teacher_no_branch', { count: 1 }));
      return createTeacherLogin(t2.id, t2.full_name, t2.phone, branchId);
    },
    onSuccess: (cred) => {
      qc.invalidateQueries({ queryKey: ['teacher', id] });
      qc.invalidateQueries({ queryKey: ['teachers'] });
      setNewLogin(cred);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  /**
   *  Darsni tahrirlash va bekor qilish.
   *
   *  Oylik aynan shu soatlarga tayanadi: xato kiritilgan dars
   *  tuzatilmasa, o'qituvchiga noto'g'ri pul beriladi. Yozuv
   *  o'chirilmaydi — `deleted_at` qo'yiladi, chunki oylik qayta
   *  hisoblanganda nima o'zgargani ko'rinib turishi kerak.
   */
  const [editLesson, setEditLesson] = useState<any>(null);

  const saveLesson = useMutation({
    mutationFn: async (f: {
      id: string; day: string; hours: string; kind: string;
      subject: string; reason: string;
    }) => {
      const { error } = await supabase.from('lessons').update({
        day: f.day,
        hours: Number(f.hours),
        kind: f.kind as 'held' | 'substituted' | 'not_held',
        subject: f.subject.trim() || null,
        reason: f.reason.trim() || null,
      }).eq('id', f.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-lessons', id] });
      qc.invalidateQueries({ queryKey: ['teacher-hours'] });
      toast.ok(t('ux.saved'));
      setEditLesson(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const dropLesson = useMutation({
    mutationFn: async (lessonId: string) => {
      const { error } = await supabase.from('lessons').update({
        deleted_at: new Date().toISOString(),
        deleted_reason: 'Xato kiritilgan',
      }).eq('id', lessonId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-lessons', id] });
      qc.invalidateQueries({ queryKey: ['teacher-hours'] });
      toast.ok(t('lessons.removed'));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  /**
   *  Ishdan bo'shatish va o'chirish — IKKI XIL narsa.
   *
   *  Ishlagan odam ro'yxatdan yo'qolmaydi: uning oyligi va darslari
   *  hisobotlarda qoladi. Xato kiritilgan yozuv esa umuman
   *  ko'rinmasligi kerak. Server ikkalasini ajratadi va moliyaviy
   *  izi bor odamni o'chirishga yo'l qo'ymaydi.
   */
  const [leaving, setLeaving] = useState<'dismiss' | 'delete' | null>(null);

  const dismiss = useMutation({
    mutationFn: async (v: {
      mode: 'dismiss' | 'delete'; reason: string; day: string; force: boolean;
    }) => {
      const { error } = v.mode === 'dismiss'
        ? await supabase.rpc('dismiss_teacher', {
            p_teacher_id: id!, p_reason: v.reason, p_left_on: v.day,
          })
        : await supabase.rpc('delete_teacher', {
            p_teacher_id: id!, p_reason: v.reason, p_force: v.force,
          });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      qc.invalidateQueries({ queryKey: ['teacher', id] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      toast.ok(t('ux.saved'));
      setLeaving(null);
      //  O'chirilgan yozuvning kartochkasida qolib bo'lmaydi.
      if (v.mode === 'delete') nav('/oqituvchilar');
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);

  const teacher = useQuery({
    queryKey: ['teacher', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers')
        .select('*, teacher_branches(branch_id, load_share, branches(name)), classes(id, name, is_active)')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Ustamalar katalogi — oylik formulasidan.
  const catalog = useQuery({
    queryKey: ['allowance-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payroll_settings')
        .select('value')
        .eq('key', 'allowances')
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const raw = data?.value;
      return Array.isArray(raw) ? (raw as unknown as CatalogRow[]) : [];
    },
  });

  const allowances = useQuery({
    queryKey: ['teacher-allowances', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_allowances')
        .select('id, code, value_override, starts_on, ends_on, note')
        .eq('teacher_id', id!)
        .order('starts_on', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const advances = useQuery({
    queryKey: ['teacher-advances', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teacher_advances')
        .select('id, period, amount, paid_on, note, branches(name)')
        .eq('teacher_id', id!)
        .order('period', { ascending: false })
        .limit(24);
      if (error) throw error;
      return data ?? [];
    },
  });

  const payrolls = useQuery({
    queryKey: ['teacher-payrolls', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_payroll_totals')
        .select('payroll_run_id, period, status, gross_total, deductions_total, net_total')
        .eq('teacher_id', id!)
        .order('period', { ascending: false })
        .limit(12);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lessons = useQuery({
    queryKey: ['teacher-lessons', id],
    enabled: !!id,
    queryFn: async () => {
      const from = currentPeriod();
      const { data, error } = await supabase
        .from('lessons')
        .select('id, day, hours, kind, subject, class_name, reason, branch_id')
        .eq('teacher_id', id!)
        .is('deleted_at', null)
        .gte('day', from)
        .order('day', { ascending: false })
        .limit(60);
      if (error) throw error;
      return data ?? [];
    },
  });

  const addAllowance = useMutation({
    mutationFn: async (f: { code: string; override: string; starts_on: string }) => {
      const { error } = await supabase.from('teacher_allowances').insert({
        school_id: profile!.school_id,
        teacher_id: id!,
        code: f.code,
        value_override: f.override ? Number(f.override) : null,
        starts_on: f.starts_on,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-allowances', id] });
      setAllowanceOpen(false);
    },
  });

  // TZ 4.4.3 uslubi: yozuv o'chirilmaydi, tugash sanasi qo'yiladi.
  const endAllowance = useMutation({
    mutationFn: async (rowId: string) => {
      const { error } = await supabase
        .from('teacher_allowances')
        .update({ ends_on: isoDate() })
        .eq('id', rowId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-allowances', id] }),
  });

  const addAdvance = useMutation({
    mutationFn: async (f: {
      period: string; amount: string; paid_on: string;
      branch_id: string; note: string;
    }) => {
      const { error } = await supabase.from('teacher_advances').insert({
        school_id: profile!.school_id,
        branch_id: f.branch_id,
        teacher_id: id!,
        period: f.period,
        amount: Number(f.amount),
        paid_on: f.paid_on,
        note: f.note.trim() || null,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-advances', id] });
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setAdvanceOpen(false);
    },
  });

  const activeAllowances = useMemo(() =>
    (allowances.data ?? []).filter((a) => !a.ends_on || a.ends_on >= isoDate()),
    [allowances.data]);

  if (teacher.isLoading) return <Loading />;
  if (teacher.error) {
    return <ErrorState message={(teacher.error as Error).message} />;
  }
  if (!teacher.data) return <EmptyState />;

  const te = teacher.data;
  // deno-lint-ignore no-explicit-any
  const tb = (te as any).teacher_branches ?? [];
  const canEdit = mayWrite('teachers.manage');
  const canPayroll = mayWrite('payroll.manage');

  const catalogMap = new Map(
    (catalog.data ?? []).map((c) => [c.code, c]));

  return (
    <>
      <div className="mb-2">
        <Link to="/oqituvchilar"
              className="text-[13px] text-[var(--text-muted)] hover:underline">
          ← {t('teachers.title')}
        </Link>
      </div>

      <PageHeader
        title={te.full_name}
        subtitle={[
          te.category,
          `${t('teachers.rateFactor')}: ${num(te.rate_factor, lang, 2)}`,
          te.phone,
        ].filter(Boolean).join(' · ')}
        actions={
          <>
            <Badge tone={te.is_active ? 'ok' : 'neutral'}>
              {te.is_active ? t('common.active') : t('common.inactive')}
            </Badge>
            {/*  Ilgari tahrirlash FAQAT ro'yxat sahifasida edi:
                 kartochkaga kirgan odam orqaga qaytib, ro'yxatdan
                 qidirib, o'sha qatordagi tugmani bosishi kerak bo'lardi. */}
            {mayWrite('teachers.manage') && (
              <>
                <Button onClick={() => setEditOpen(true)}>
                  {t('common.edit')}
                </Button>
                {te.is_active && (
                  <Button variant="ghost" onClick={() => setLeaving('dismiss')}>
                    {t('teachers.dismiss')}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setLeaving('delete')}>
                  {t('common.delete')}
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Asosiy ma'lumot --------------------------------- */}
        <Card title={t('teacher.card')}>
          <dl className="space-y-1.5 text-[13px]">
            <Row label={t('teachers.baseSalary')}
                 value={money(te.base_salary, lang)} mono />
            <Row label={t('teachers.weeklyHours')}
                 value={num(te.weekly_hours, lang, 1)} mono />
            <Row label={t('teachers.hiredOn')} value={date(te.hired_on, lang)} />
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[var(--text-muted)]">
                {t('teachers.linkedUser')}
              </dt>
              <dd className="flex items-center gap-2">
                <span>{te.user_id ? '✓' : t('teachers.notLinked')}</span>
                {/*  Hisobsiz o'qituvchi davomat ololmaydi. Ilgari uni
                    faqat qo'shish paytida yaratish mumkin edi: o'sha
                    payt xato bo'lsa yoki belgi qo'yilmagan bo'lsa,
                    keyin tuzatishning yo'li yo'q edi. */}
                {!te.user_id && canEdit && te.phone && (
                  <Button size="sm" variant="ghost"
                          disabled={makeLogin.isPending}
                          onClick={() => makeLogin.mutate()}>
                    {makeLogin.isPending
                      ? t('common.saving')
                      : t('teachers.createLoginNow')}
                  </Button>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--text-muted)]">{t('teachers.branches')}</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {/* deno-lint-ignore no-explicit-any */}
                {tb.map((b: any) => (
                  <Badge key={b.branch_id}>
                    {b.branches?.name} · {num(b.load_share, lang, 2)}
                  </Badge>
                ))}
              </dd>
            </div>
          </dl>
        </Card>

        {/* --- Ustamalar (TZ 12.1.6) --------------------------- */}
        <Card
          title={t('teachers.allowances')}
          action={canEdit && (catalog.data?.length ?? 0) > 0 && (
            <Button size="sm" onClick={() => setAllowanceOpen(true)}>
              + {t('teacher.allowance.add')}
            </Button>
          )}
        >
          {(catalog.data?.length ?? 0) === 0
            ? <Notice tone="warn">{t('teacher.allowance.catalogEmpty')}</Notice>
            : activeAllowances.length === 0
            ? (
              <EmptyState
                title={t('teacher.allowance.none')}
                hint={t('teacher.allowance.hint')}
              />
            )
            : (
              <ul className="space-y-2">
                {activeAllowances.map((a) => {
                  const cat = catalogMap.get(a.code);
                  const value = a.value_override ?? cat?.value ?? 0;
                  return (
                    <li key={a.id}
                        className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium">
                          {cat?.name ?? a.code}
                        </div>
                        <div className="text-[12px] text-[var(--text-muted)]">
                          {cat?.type === 'percent'
                            ? `${value}%`
                            : money(value, lang)}
                          {a.value_override !== null && (
                            <span className="ml-1.5 text-[var(--warn)]">
                              ({t('teacher.allowance.override')})
                            </span>
                          )}
                          {' · '}{date(a.starts_on, lang)}
                        </div>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => endAllowance.mutate(a.id)}
                          title={t('common.delete')}
                          className="flex h-6 w-6 shrink-0 items-center justify-center
                            rounded text-[var(--text-faint)]
                            hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]"
                        >
                          ✕
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
        </Card>

        {/* --- Avanslar (TZ 4.11.6) --------------------------- */}
        <Card
          title={t('adv.title')}
          action={canPayroll && (
            <Button size="sm" onClick={() => setAdvanceOpen(true)}>
              + {t('adv.add')}
            </Button>
          )}
          padded={false}
        >
          {(advances.data?.length ?? 0) === 0
            ? <EmptyState title={t('adv.none')} hint={t('adv.hint')} />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t('common.period')}</Th>
                    <Th>{t('adv.paidOn')}</Th>
                    <Th align="right">{t('common.amount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {advances.data!.map((a) => (
                    <Tr key={a.id}>
                      <Td>{periodLabel(String(a.period), lang)}</Td>
                      <Td mono className="text-[var(--text-muted)]">
                        {date(a.paid_on, lang)}
                      </Td>
                      <Td align="right" mono>{money(a.amount, lang)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Card>

        {/* --- Oylik tarixi ----------------------------------- */}
        <Card title={t('payroll.title')} padded={false}>
          {(payrolls.data?.length ?? 0) === 0 ? <EmptyState hint="" /> : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.period')}</Th>
                  <Th>{t('common.status')}</Th>
                  <Th align="right">{t('payroll.net')}</Th>
                </tr>
              </thead>
              <tbody>
                {payrolls.data!.map((p) => (
                  <Tr key={p.payroll_run_id}>
                    <Td>
                      <Link to={`/oylik/${p.payroll_run_id}`}
                            className="font-medium hover:underline">
                        {periodLabel(String(p.period), lang)}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={p.status === 'approved' ? 'ok' : 'warn'}>
                        {p.status === 'approved'
                          ? t('payroll.approved') : t('payroll.draft')}
                      </Badge>
                    </Td>
                    <Td align="right" mono>{money(p.net_total, lang)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* --- Darslar --------------------------------------- */}
      <Card title={t('lessons.title')} className="mt-4" padded={false}>
        {(lessons.data?.length ?? 0) === 0 ? <EmptyState hint="" /> : (
          <Table>
            <thead>
              <tr>
                <Th>{t('common.date')}</Th>
                <Th>{t('lessons.subject')}</Th>
                <Th>{t('students.class')}</Th>
                <Th>{t('lessons.kind')}</Th>
                <Th align="right">{t('lessons.hours')}</Th>
                <Th align="right">{t('common.actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {lessons.data!.map((l) => (
                <Tr key={l.id}>
                  <Td mono className="text-[var(--text-muted)]">
                    {date(l.day, lang)}
                  </Td>
                  <Td>{l.subject ?? '—'}</Td>
                  <Td className="text-[var(--text-muted)]">{l.class_name ?? '—'}</Td>
                  <Td>
                    <Badge tone={l.kind === 'held' ? 'ok'
                      : l.kind === 'substituted' ? 'brand' : 'danger'}>
                      {t(`lessons.kind.${l.kind}`)}
                    </Badge>
                    {l.reason && (
                      <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                        {l.reason}
                      </span>
                    )}
                  </Td>
                  <Td align="right" mono>{num(l.hours, lang, 1)}</Td>
                  <Td align="right">
                    {mayWrite('teachers.manage') && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost"
                                onClick={() => setEditLesson(l)}>
                          {t('common.edit')}
                        </Button>
                        <Button size="sm" variant="ghost"
                                disabled={dropLesson.isPending}
                                onClick={() => dropLesson.mutate(l.id)}>
                          {t('common.remove')}
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {newLogin && (
        <TeacherCredentials data={newLogin} onClose={() => setNewLogin(null)} />
      )}

      {editLesson && (
        <EditLessonModal
          lesson={editLesson}
          onClose={() => setEditLesson(null)}
          onSubmit={(f) => saveLesson.mutate({ ...f, id: editLesson.id })}
          busy={saveLesson.isPending}
        />
      )}

      {leaving && (
        <DismissModal
          mode={leaving}
          name={te.full_name}
          onClose={() => setLeaving(null)}
          onSubmit={(reason, day, force) =>
            dismiss.mutate({ mode: leaving, reason, day, force })}
          busy={dismiss.isPending}
        />
      )}

      {editOpen && (
        <TeacherModal
          existing={te}
          branches={branches}
          onClose={() => setEditOpen(false)}
          onSubmit={(f) => saveTeacher.mutate(f)}
          busy={saveTeacher.isPending}
          error={saveTeacher.error ? (saveTeacher.error as Error).message : null}
        />
      )}

      <AllowanceModal
        open={allowanceOpen}
        onClose={() => setAllowanceOpen(false)}
        catalog={catalog.data ?? []}
        assigned={activeAllowances.map((a) => a.code)}
        onSubmit={(f) => addAllowance.mutate(f)}
        busy={addAllowance.isPending}
        error={addAllowance.error ? (addAllowance.error as Error).message : null}
      />

      <AdvanceModal
        open={advanceOpen}
        onClose={() => setAdvanceOpen(false)}
        branches={branches}
        defaultBranch={tb[0]?.branch_id ?? branches[0]?.id ?? ''}
        onSubmit={(f) => addAdvance.mutate(f)}
        busy={addAdvance.isPending}
        error={addAdvance.error ? (addAdvance.error as Error).message : null}
      />
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className={mono ? 'num font-medium' : 'font-medium'}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------

function AllowanceModal({
  open, onClose, catalog, assigned, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  catalog: CatalogRow[];
  assigned: string[];
  onSubmit: (f: { code: string; override: string; starts_on: string }) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [code, setCode] = useState('');
  const [override, setOverride] = useState('');
  const [startsOn, setStartsOn] = useState(currentPeriod());

  const chosen = catalog.find((c) => c.code === code);
  const already = assigned.includes(code);

  return (
    <Modal
      open={open}
      title={t('teacher.allowance.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-allow" type="submit"
                  disabled={busy || !code || already}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-allow"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit({ code, override, starts_on: startsOn });
        }}
        className="space-y-3"
      >
        <Field label={t('teachers.allowances')} required>
          <Select value={code} onChange={(e) => setCode(e.target.value)}
                  autoFocus required>
            <option value="">—</option>
            {catalog.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} — {c.type === 'percent' ? `${c.value}%` : c.value}
              </option>
            ))}
          </Select>
        </Field>

        {chosen && (
          <Field
            label={t('teacher.allowance.override')}
            hint={t('teacher.allowance.overrideHint')}
          >
            {chosen.type === 'percent'
              ? (
                <Input type="number" min={0} max={100} step={0.5}
                       value={override}
                       onChange={(e) => setOverride(e.target.value)}
                       placeholder={String(chosen.value)}
                       className="num text-right" />
              )
              : (
                <MoneyInput value={override}
                            onChange={(e) => setOverride(e.target.value)}
                            placeholder={String(chosen.value)} />
              )}
          </Field>
        )}

        <Field label={t('services.validFrom')} required
               hint={t('teachers.allowanceFromHint')}>
          <Input type="date" value={startsOn}
                 onChange={(e) => setStartsOn(e.target.value)} required />
        </Field>

        {already && (
          <Notice tone="warn">{t('services.alreadyAssigned')}</Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

function AdvanceModal({
  open, onClose, branches, defaultBranch, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    period: currentPeriod(),
    amount: '',
    paid_on: isoDate(),
    branch_id: defaultBranch,
    note: '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open={open} title={t('adv.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-adv" type="submit"
                  disabled={busy || !f.amount}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-adv"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <Field label={t('adv.period')} required
               hint={t('teachers.advanceHint')}>
          <Input type="month"
                 value={f.period.slice(0, 7)}
                 onChange={(e) => set('period', `${e.target.value}-01`)}
                 required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.amount')} required>
            <MoneyInput value={f.amount}
                        onChange={(e) => set('amount', e.target.value)}
                        autoFocus required />
          </Field>
          <Field label={t('adv.paidOn')} required>
            <Input type="date" value={f.paid_on}
                   onChange={(e) => set('paid_on', e.target.value)} required />
          </Field>
        </div>

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>

        {branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Notice tone="neutral">{t('adv.hint')}</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}


/** Xato kiritilgan darsni tuzatish. */
function EditLessonModal({ lesson, onClose, onSubmit, busy }: {
  // deno-lint-ignore no-explicit-any
  lesson: any;
  onClose: () => void;
  onSubmit: (f: {
    day: string; hours: string; kind: string; subject: string; reason: string;
  }) => void;
  busy: boolean;
}) {
  const t = useT();
  const [f, setF] = useState({
    day: lesson.day,
    hours: String(lesson.hours ?? ''),
    kind: lesson.kind,
    subject: lesson.subject ?? '',
    reason: lesson.reason ?? '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open
      title={t('lessons.edit')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => onSubmit(f)}
                  disabled={busy || Number(f.hours) <= 0}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="neutral">{t('lessons.editHint')}</Notice>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.date')} required>
            <Input type="date" value={f.day}
                   onChange={(e) => set('day', e.target.value)} />
          </Field>
          <Field label={t('lessons.hours')} required>
            <Input type="number" step="0.5" min="0.5" value={f.hours}
                   onChange={(e) => set('hours', e.target.value)} />
          </Field>
        </div>

        <Field label={t('lessons.kind')} required>
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="held">{t('lessons.kind.held')}</option>
            <option value="substituted">{t('lessons.kind.substituted')}</option>
            <option value="not_held">{t('lessons.kind.not_held')}</option>
          </Select>
        </Field>

        <Field label={t('lessons.subject')}>
          <Input value={f.subject} onChange={(e) => set('subject', e.target.value)} />
        </Field>

        {f.kind === 'not_held' && (
          <Field label={t('lessons.reason')} required
                 hint={t('lessons.reasonHint')}>
            <Input value={f.reason}
                   onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/**
 *  Ishdan bo'shatish yoki o'chirish.
 *
 *  Ikkalasi bitta oynada, lekin matni butunlay boshqacha: birinchisi
 *  odatiy voqea, ikkinchisi esa yozuvning o'zi xato ekanini
 *  bildiradi. Ularni chalkashtirib yuborish hisobotlarni buzadi.
 */
function DismissModal({ mode, name, onClose, onSubmit, busy }: {
  mode: 'dismiss' | 'delete';
  name: string;
  onClose: () => void;
  onSubmit: (reason: string, day: string, force: boolean) => void;
  busy: boolean;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(isoDate());
  //  Darslari va hisoblangan oyligi bilan birga o'chirish. Ataylab
  //  alohida belgi: tasodifan bosilib ketmasin.
  const [force, setForce] = useState(false);

  return (
    <Modal
      open
      title={`${mode === 'dismiss' ? t('teachers.dismiss') : t('common.delete')} — ${name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => onSubmit(reason, day, force)}
                  disabled={busy || reason.trim().length < 3}>
            {busy ? t('common.saving')
              : mode === 'dismiss' ? t('teachers.dismiss') : t('common.delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="warn">
          {mode === 'dismiss'
            ? t('teachers.dismissHint')
            : t('teachers.deleteHint')}
        </Notice>

        {mode === 'dismiss' && (
          <Field label={t('teachers.leftOn')} required>
            <Input type="date" value={day}
                   onChange={(e) => setDay(e.target.value)} />
          </Field>
        )}

        <Field label={t('pay.cancelReason')} required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)}
                 autoFocus />
        </Field>

        {mode === 'delete' && (
          <label className="flex items-start gap-2 rounded-md border
            bg-[var(--bg-subtle)] px-3 py-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-medium">{t('teachers.forceDelete')}</span>
              <span className="block text-[12px] text-[var(--text-muted)]">
                {t('teachers.forceDeleteHint')}
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
