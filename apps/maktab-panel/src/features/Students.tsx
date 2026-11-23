// =====================================================================
//  O'quvchilar ro'yxati (TZ 4.3).
//
//  Balans `v_student_balances` ko'rinishidan keladi — u hisoblanma va
//  TASDIQLANGAN to'lovlar farqi sifatida real vaqtda hisoblanadi
//  (TZ 4.8.1). Tasdiqlanmagan chek balansga ta'sir qilmaydi (TZ 4.7.3).
// =====================================================================

import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { ClassPicker } from '@/ui/ClassPicker';
import { useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { usesGroups } from '@/lib/org';
import { PhoneInput } from '@/ui/PhoneInput';
import {
  emptyTuition, resolveTuition, TuitionPicker, type TuitionValue,
  useDiscountTypes, useTuitionPlans,
} from '@/ui/TuitionPicker';

type Status = 'active' | 'academic_leave' | 'expelled';
type Issue = 'no_contract' | 'no_parent' | 'no_class' | 'parent_no_telegram';

/** 1000 talik bo'laklarda o'qib, o'quvchi id larini qaytaradi. */
async function loadIssue(issue: Issue): Promise<Set<string>> {
  const out = new Set<string>();
  if (issue === 'no_class') return out;
  for (let from = 0; ; from += 1000) {
    const res = issue === 'no_contract'
      ? await supabase.from('contracts').select('student_id').eq('is_active', true)
          .order('id').range(from, from + 999)
      : issue === 'no_parent'
      ? await supabase.from('student_parents').select('student_id')
          .order('student_id').range(from, from + 999)
      : await supabase.from('student_parents')
          .select('student_id, parents!inner(telegram_id, is_active, deleted_at)')
          .is('parents.telegram_id', null).eq('parents.is_active', true)
          .is('parents.deleted_at', null)
          .order('student_id').range(from, from + 999);
    if (res.error) throw res.error;
    for (const r of res.data ?? []) out.add((r as { student_id: string }).student_id);
    if ((res.data?.length ?? 0) < 1000) break;
  }
  return out;
}

const STATUS_TONE: Record<Status, 'ok' | 'warn' | 'neutral'> = {
  active: 'ok',
  academic_leave: 'warn',
  expelled: 'neutral',
};

export default function Students() {
  const t = useT();
  const qc = useQueryClient();
  const { branchId, branches, mayWrite, can, profile } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | ''>('active');
  const [adding, setAdding] = useState(false);

  //  Bosh sahifadagi ogohlantirishdan kelinganda (?muammo=no_contract)
  //  AYNAN shu o'quvchilar ko'rsatiladi — butun ro'yxat emas.
  const [params, setParams] = useSearchParams();
  const issue = params.get('muammo') as Issue | null;
  const issueIds = useQuery({
    queryKey: ['student-issue', issue, branchId],
    enabled: !!issue,
    queryFn: () => loadIssue(issue!),
  });

  const canEdit = mayWrite('students.manage');

  const list = useQuery({
    queryKey: ['students', branchId, status],
    queryFn: async () => {
      let q = supabase
        .from('v_student_balances')
        .select('student_id, branch_id, full_name, class_name, payment_code, status, charged, paid, balance')
        .order('class_name', { ascending: true, nullsFirst: false })
        .order('full_name');
      if (branchId) q = q.eq('branch_id', branchId);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  //  O'quv markazida sinf o'rniga guruhlar ko'rsatiladi.
  const isLC = usesGroups(profile?.org_type);
  const groupNames = useQuery({
    queryKey: ['students-groups', branchId],
    enabled: isLC,
    queryFn: async () => {
      let q = supabase.from('group_members')
        .select('student_id, status, study_groups(name)')
        .neq('status', 'left');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      const m = new Map<string, string[]>();
      // deno-lint-ignore no-explicit-any
      for (const r of (data ?? []) as any[]) {
        const name = r.study_groups?.name;
        if (!name) continue;
        m.set(r.student_id, [...(m.get(r.student_id) ?? []), r.status === 'trial' ? `${name} (${t('lc.trialShort')})` : name]);
      }
      return m;
    },
  });

  // Qidiruv mijoz tomonda — 1000 tagacha o'quvchi (TZ 5.7) uchun bu
  // serverga borishdan tezroq va buxgalter yozayotganda darhol javob beradi.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let base = list.data ?? [];
    if (issue === 'no_class') base = base.filter((s) => !s.class_name);
    else if (issue && issueIds.data) {
      const ids = issueIds.data;
      //  no_contract / no_parent — ro'yxatda YO'Qlari; parent_no_telegram — bor'lari.
      base = base.filter((s) => issue === 'parent_no_telegram'
        ? ids.has(s.student_id ?? '') : !ids.has(s.student_id ?? ''));
    }
    if (!needle) return base;
    return base.filter((s) =>
      s.full_name?.toLowerCase().includes(needle) ||
      s.class_name?.toLowerCase().includes(needle) ||
      (isLC && (groupNames.data?.get(s.student_id ?? '') ?? []).join(' ').toLowerCase().includes(needle)) ||
      s.payment_code?.toLowerCase().includes(needle)
    );
  }, [list.data, search, isLC, groupNames.data, issue, issueIds.data]);

  const totals = useMemo(() =>
    rows.reduce((acc, r) => {
      const b = Number(r.balance ?? 0);
      return {
        debt: acc.debt + (b > 0 ? b : 0),
        advance: acc.advance + (b < 0 ? -b : 0),
      };
    }, { debt: 0, advance: 0 }), [rows]);

  const create = useMutation({
    mutationFn: async (form: NewStudent) => {
      // `class_name` triggerdan keladi — bu yerda yozilmaydi.
      const { data, error } = await supabase.from('students').insert({
        school_id: profile!.school_id,
        branch_id: form.branch_id,
        full_name: form.full_name.trim(),
        class_id: form.class_id,
        grade_level: form.grade_level ? Number(form.grade_level) : null,
        birth_date: form.birth_date || null,
        enrolled_on: isoDate(),
        // payment_code ni baza triggeri o'zi beradi (TZ 4.3.1).
      }).select('id, payment_code').single();
      if (error) throw error;

      //  Shartnoma — tarif narxi bilan. Raqam to'lov kodidan: qo'lda
      //  o'ylab topish shart emas va har doim noyob.
      if (form.contract) {
        const { error: cErr } = await supabase.from('contracts').insert({
          school_id: profile!.school_id,
          student_id: data.id,
          number: `SH-${data.payment_code}`,
          signed_on: isoDate(),
          ...form.contract,
          is_active: true,
        });
        if (cErr) throw cErr;
      }

      //  Ota-ona: shu raqam bo'lsa yangisi yaratilmaydi (TZ 4.9.2).
      if (form.parent) {
        const { data: found } = await supabase.from('parents').select('id')
          .eq('phone', form.parent.phone).is('deleted_at', null).maybeSingle();
        let parentId = found?.id;
        if (!parentId) {
          const { data: np, error: pErr } = await supabase.from('parents').insert({
            school_id: profile!.school_id,
            full_name: form.parent.full_name,
            phone: form.parent.phone,
            lang: 'uz',
          }).select('id').single();
          if (pErr) throw pErr;
          parentId = np.id;
        }
        const { error: lErr } = await supabase.from('student_parents').insert({
          student_id: data.id, parent_id: parentId,
          relation: form.parent.relation, is_primary: true,
        });
        if (lErr) throw lErr;
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['debts-monthly'] });
      qc.invalidateQueries({ queryKey: ['setup-issues'] });
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      setAdding(false);
    },
  });

  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  if (!can('students.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }

  return (
    <>
      <PageHeader
        title={t('students.title')}
        subtitle={t('common.showing', { count: rows.length })}
        actions={canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            {t('students.add')}
          </Button>
        )}
      />

      {issue && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-[var(--warn-bg)] px-4 py-2.5 text-[13px] text-[var(--warn)]">
          <span className="flex-1">{t(`students.issue.${issue}`)} · <strong className="num">{rows.length}</strong></span>
          <button type="button" className="font-medium underline"
                  onClick={() => { params.delete('muammo'); setParams(params); }}>
            {t('students.issue.clear')}
          </button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('students.searchHint')}
          className="max-w-xs"
          type="search"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
          className="w-auto"
        >
          <option value="">{t('common.all')}</option>
          <option value="active">{t('students.status.active')}</option>
          <option value="academic_leave">{t('students.status.academic_leave')}</option>
          <option value="expelled">{t('students.status.expelled')}</option>
        </Select>
      </div>

      <Card padded={false}>
        {rows.length === 0
          ? (
            <EmptyState
              action={canEdit && (
                <Button onClick={() => setAdding(true)}>{t('students.add')}</Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.fullName')}</Th>
                  <Th>{isLC ? t('lc.groups') : t('students.class')}</Th>
                  <Th>{t('students.paymentCode')}</Th>
                  <Th align="right">{t('dashboard.charged')}</Th>
                  <Th align="right">{t('dashboard.collected')}</Th>
                  <Th align="right">{t('students.balance')}</Th>
                  <Th>{t('common.status')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.student_id} to={`/oquvchilar/${s.student_id}`}>
                    <Td>
                      <Link to={`/oquvchilar/${s.student_id}`}
                            className="font-medium hover:underline">
                        {s.full_name}
                      </Link>
                    </Td>
                    <Td className="text-[var(--text-muted)]">
                      {isLC
                        ? (groupNames.data?.get(s.student_id ?? '') ?? []).join(', ') || '—'
                        : s.class_name ?? '—'}
                    </Td>
                    <Td mono className="text-[var(--text-muted)]">{s.payment_code}</Td>
                    <Td align="right" mono><Money value={s.charged} /></Td>
                    <Td align="right" mono><Money value={s.paid} /></Td>
                    <Td align="right" mono><Money value={s.balance} colored bold /></Td>
                    <Td>
                      <Badge tone={STATUS_TONE[(s.status ?? 'active') as Status]}>
                        {t(`students.status.${s.status}`)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td className="text-[13px]">{t('common.total')}</Td>
                  <Td /><Td /><Td /><Td />
                  <Td align="right" mono>
                    <div className="text-[var(--danger)]">
                      <Money value={totals.debt} />
                    </div>
                    {totals.advance > 0 && (
                      <div className="text-[11px] font-normal text-[var(--ok)]">
                        {t('students.advance')}: <Money value={totals.advance} />
                      </div>
                    )}
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>

      <AddStudentModal
        open={adding}
        onClose={() => setAdding(false)}
        branches={branches}
        defaultBranch={branchId ?? branches[0]?.id ?? ''}
        onSubmit={(form) => create.mutate(form)}
        busy={create.isPending}
        error={create.error ? (create.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

export interface NewStudent {
  full_name: string; class_id: string | null; grade_level: string;
  branch_id: string; birth_date: string;
  contract: null | {
    starts_on: string; due_day: number; billing_months: number;
    tuition_amount: number; tuition_plan_id: string | null;
    discount_type_id: string | null; discount_kind: 'percent' | 'amount' | null;
    discount_value: number | null; discount_reason: string | null;
  };
  parent: null | { full_name: string; phone: string; relation: string };
}

/**
 *  O'quvchi qo'shish — BITTA OYNADA hammasi: o'quvchi, to'lov (tarif va
 *  chegirma) va ota-ona. Ilgari faqat ism va sinf so'ralardi, keyin
 *  kartochkaga kirib shartnoma va ota-onani alohida qo'shish kerak
 *  edi — 9 ta o'quvchi shartnomasiz, 230 tasi ota-onasiz qolgani
 *  shundan.
 */
function AddStudentModal({
  open, onClose, branches, defaultBranch, onSubmit, busy, error,
}: {
  open: boolean;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  onSubmit: (f: NewStudent) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const { profile, mayWrite } = useAuth();
  const isLC = usesGroups(profile?.org_type);
  const canContract = mayWrite('students.manage');
  const [fullName, setFullName] = useState('');
  const [classId, setClassId] = useState<string | null>(null);
  const [grade, setGrade] = useState('');
  const [branch, setBranch] = useState(defaultBranch);
  const [birth, setBirth] = useState('');

  const [tuition, setTuition] = useState<TuitionValue>(emptyTuition);
  const [startsOn, setStartsOn] = useState(isoDate());
  const [months, setMonths] = useState('12');
  const [dueDay, setDueDay] = useState('10');

  const [pName, setPName] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pRel, setPRel] = useState('mother');

  const plans = useTuitionPlans();
  const types = useDiscountTypes();
  const r = resolveTuition(tuition, plans.data ?? [],
    (types.data ?? []).map((d) => ({ id: d.id, kind: d.kind, value: Number(d.value) })));

  const phoneDigits = pPhone.replace(/\D/g, '');
  const parentPartial = (pName.trim() !== '') !== (phoneDigits.length >= 9);
  const blocked = !fullName.trim() || r.reasonMissing || r.paysTooHigh || parentPartial;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked) return;
    onSubmit({
      full_name: fullName,
      class_id: classId,
      grade_level: grade,
      branch_id: branch || defaultBranch,
      birth_date: birth,
      contract: r.base > 0 ? {
        starts_on: startsOn,
        due_day: Math.min(28, Math.max(1, Number(dueDay) || 10)),
        billing_months: Number(months) || 12,
        tuition_amount: r.base,
        tuition_plan_id: r.plan_id,
        discount_type_id: r.discount_type_id,
        discount_kind: r.discount_kind,
        discount_value: r.discount_value,
        discount_reason: r.discount_reason,
      } : null,
      parent: pName.trim() && phoneDigits.length >= 9
        ? { full_name: pName.trim(), phone: phoneDigits, relation: pRel }
        : null,
    });
  }

  const Section = ({ n, title }: { n: number; title: string }) => (
    <div className="flex items-center gap-2 pt-1">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--primary)]
        text-[11px] font-semibold text-[var(--on-primary)]">{n}</span>
      <span className="text-[14px] font-semibold">{title}</span>
    </div>
  );

  return (
    <Modal
      open={open}
      title={t('students.add')}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-student" type="submit" disabled={busy || blocked}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="add-student" onSubmit={submit} className="space-y-4">
        <Section n={1} title={t('ns.student')} />
        <Field label={t('common.fullName')} required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)}
                 autoFocus required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {!isLC && <ClassPicker
            value={classId}
            branchId={branch || defaultBranch}
            onChange={(c) => {
              setClassId(c.class_id);
              setGrade(c.grade_level !== null ? String(c.grade_level) : '');
            }}
          />}
          <Field label={t('students.birthDate')}>
            <Input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
          </Field>
        </div>
        {branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {canContract && (
          <>
            <Section n={2} title={t('ns.payment')} />
            <TuitionPicker value={tuition} onChange={setTuition}
                           grade={grade === '' ? null : Number(grade)} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('contracts.startsOn')}>
                <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
              </Field>
              <Field label={t('contracts.billingMonths')}>
                <Select value={months} onChange={(e) => setMonths(e.target.value)}>
                  <option value="12">{t('contracts.months12')}</option>
                  <option value="9">{t('contracts.months9')}</option>
                </Select>
              </Field>
              <Field label={t('contracts.dueDay')}>
                <Input type="number" min={1} max={28} value={dueDay}
                       onChange={(e) => setDueDay(e.target.value)} className="num" />
              </Field>
            </div>
          </>
        )}

        <Section n={canContract ? 3 : 2} title={t('ns.parent')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('common.fullName')}>
            <Input value={pName} onChange={(e) => setPName(e.target.value)} />
          </Field>
          <Field label={t('common.phone')}
                 error={parentPartial ? t('ns.parentBoth') : undefined}>
            <PhoneInput value={pPhone} onChange={setPPhone} />
          </Field>
          <Field label={t('parents.relation')}>
            <Select value={pRel} onChange={(e) => setPRel(e.target.value)}>
              <option value="mother">{t('parents.relation.mother')}</option>
              <option value="father">{t('parents.relation.father')}</option>
              <option value="guardian">{t('parents.relation.guardian')}</option>
            </Select>
          </Field>
        </div>

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
