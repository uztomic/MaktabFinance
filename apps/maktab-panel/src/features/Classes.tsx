// =====================================================================
//  Sinflar (yangi bo'lim).
//
//  Hozirgacha sinf faqat o'quvchi yozuvidagi matn edi. Endi:
//    · sinflar ro'yxati moliyaviy jamlanma bilan
//    · sinf rahbari — oylikdagi ustama shu bog'lanishga tayanadi
//    · sinfga ommaviy xizmat biriktirish
//    · yillik ko'chirish 5-A → 6-A
//
//  Asosiy savol shu ekranda javob topadi: "qaysi sinfdan qancha
//  yig'ilgan va yana qancha yig'ilishi kerak".
// =====================================================================

import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { isoDate, money } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, Money, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useConfirm, useSort, useToast } from '@/ui/Feedback';

function monthRange(d = new Date()) {
  return {
    from: isoDate(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

type SortKey =
  | 'class_name' | 'students' | 'charged' | 'collected'
  | 'remaining' | 'collection_rate' | 'debt';

export default function Classes() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { branchId, branches, can, mayWrite, profile } = useAuth();

  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [assigning, setAssigning] =
    useState<{ id: string; name: string; branch_id: string } | null>(null);
  const [promoting, setPromoting] = useState(false);

  const { from, to } = monthRange();
  const sort = useSort<SortKey>('class_name');

  const rows = useQuery({
    queryKey: ['classes-report', from, to, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_by_class', {
        p_from: from, p_to: to, p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Sig'im va o'quv yili hisobotda yo'q — alohida olamiz.
  const meta = useQuery({
    queryKey: ['classes-meta', branchId],
    queryFn: async () => {
      let q = supabase
        .from('classes')
        .select('id, capacity, academic_year, is_active, teacher_id, note')
        .is('deleted_at', null);
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return new Map((data ?? []).map((c) => [c.id, c] as const));
    },
  });

  const teachers = useQuery({
    queryKey: ['teachers-for-class'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, full_name')
        .eq('is_active', true).is('deleted_at', null)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (f: any) => {
      const payload = {
        name: f.name.trim(),
        grade_level: f.grade_level ? Number(f.grade_level) : null,
        teacher_id: f.teacher_id || null,
        capacity: f.capacity ? Number(f.capacity) : null,
        academic_year: f.academic_year.trim(),
        note: f.note?.trim() || null,
      };
      if (f.id) {
        const { error } = await supabase.from('classes')
          .update(payload).eq('id', f.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('classes').insert({
          school_id: profile!.school_id,
          branch_id: f.branch_id,
          ...payload,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      qc.invalidateQueries({ queryKey: ['classes-meta'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const assign = useMutation({
    mutationFn: async (f: { class_id: string; service_id: string; starts_on: string }) => {
      const { data, error } = await supabase.rpc('assign_service_to_class', {
        p_class_id: f.class_id,
        p_service_id: f.service_id,
        p_starts_on: f.starts_on,
      });
      if (error) throw error;
      return data as { added: number; skipped: number };
    },
    onSuccess: (d) => {
      toast.ok(t('cls.assignResult', { added: d.added, skipped: d.skipped }));
      setAssigning(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const promote = useMutation({
    mutationFn: async (f: {
      from_year: string; to_year: string; final_grade: string;
    }) => {
      const { data, error } = await supabase.rpc('promote_classes', {
        p_from_year: f.from_year,
        p_to_year: f.to_year,
        p_branch_id: branchId ?? undefined,
        p_final_grade: Number(f.final_grade) || 11,
      });
      if (error) throw error;
      return data as Record<string, number>;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['classes-report'] });
      qc.invalidateQueries({ queryKey: ['classes-meta'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.ok(t('cls.promoteResult', {
        classes: d.classes_created,
        students: d.students_moved,
        graduating: d.graduating,
      }));
      setPromoting(false);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const list = useMemo(() => {
    const data = rows.data ?? [];
    // deno-lint-ignore no-explicit-any
    return sort.apply(data, (r: any, k) => r[k]);
  }, [rows.data, sort.apply]);

  const totals = useMemo(() =>
    (rows.data ?? []).reduce((a, r) => ({
      students: a.students + Number(r.students ?? 0),
      charged: a.charged + Number(r.charged ?? 0),
      collected: a.collected + Number(r.collected ?? 0),
      remaining: a.remaining + Number(r.remaining ?? 0),
      debt: a.debt + Number(r.debt ?? 0),
    }), { students: 0, charged: 0, collected: 0, remaining: 0, debt: 0 }),
    [rows.data]);

  const canEdit = mayWrite('students.manage');

  if (!can('students.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (rows.isLoading) return <Loading />;
  if (rows.error) {
    return <ErrorState message={(rows.error as Error).message}
                       onRetry={() => rows.refetch()} />;
  }

  const rate = totals.charged > 0
    ? Math.round(1000 * totals.collected / totals.charged) / 10
    : 0;

  const SortTh = ({ k, children, align }: {
    k: SortKey; children: ReactNode; align?: 'right';
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
        title={t('cls.title')}
        subtitle={t('common.showing', { count: list.length })}
        actions={
          <>
            <Button
              disabled={list.length === 0}
              onClick={() => exportTable(
                'sinflar',
                [
                  { header: t('cls.name'), value: (r) => r.class_name },
                  { header: t('cls.grade'), value: (r) => r.grade_level, numeric: true },
                  { header: t('cls.teacher'), value: (r) => r.teacher_name },
                  { header: t('cls.students'), value: (r) => r.students, numeric: true },
                  { header: t('cls.charged'), value: (r) => r.charged, numeric: true },
                  { header: t('cls.collected'), value: (r) => r.collected, numeric: true },
                  { header: t('cls.debt'), value: (r) => r.remaining, numeric: true },
                  { header: '%', value: (r) => r.collection_rate, numeric: true },
                ],
                list,
                [t('cls.title'), `${from} — ${to}`],
              )}
            >
              {t('common.export')}
            </Button>
            {canEdit && (
              <>
                <Button onClick={() => setPromoting(true)}>
                  {t('cls.promote')}
                </Button>
                <Button variant="primary" onClick={() => setAdding(true)}>
                  {t('cls.add')}
                </Button>
              </>
            )}
          </>
        }
      />

      <Card padded={false}>
        {list.length === 0
          ? (
            <EmptyState
              title={t('cls.none')}
              hint={t('cls.noneHint')}
              action={canEdit && (
                <Button variant="primary" onClick={() => setAdding(true)}>
                  {t('cls.add')}
                </Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <SortTh k="class_name">{t('cls.name')}</SortTh>
                  <Th>{t('cls.teacher')}</Th>
                  <SortTh k="students" align="right">{t('cls.students')}</SortTh>
                  <SortTh k="charged" align="right">{t('cls.charged')}</SortTh>
                  <SortTh k="collected" align="right">{t('cls.collected')}</SortTh>
                  <SortTh k="remaining" align="right">{t('cls.debt')}</SortTh>
                  <SortTh k="collection_rate" align="right">%</SortTh>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const m = meta.data?.get(c.class_id!);
                  const cap = m?.capacity;
                  const full = cap ? Number(c.students) >= cap : false;
                  const r = Number(c.collection_rate ?? 0);
                  return (
                    <Tr key={c.class_id}>
                      <Td>
                        <Link to={`/sinflar/${c.class_id}`}
                              className="font-medium hover:underline">
                          {c.class_name}
                        </Link>
                        {m?.academic_year && (
                          <span className="ml-1.5 text-[11px]
                            text-[var(--text-faint)]">
                            {m.academic_year}
                          </span>
                        )}
                      </Td>
                      <Td className="text-[var(--text-muted)]">
                        {c.teacher_name ?? '—'}
                      </Td>
                      <Td align="right" mono>
                        {c.students}
                        {cap && (
                          <span className={`ml-1 text-[11px] ${
                            full ? 'text-[var(--danger)]'
                                 : 'text-[var(--text-faint)]'}`}>
                            /{cap}
                          </span>
                        )}
                      </Td>
                      <Td align="right" mono>{money(c.charged, lang)}</Td>
                      <Td align="right" mono className="text-[var(--ok)]">
                        {money(c.collected, lang)}
                      </Td>
                      <Td align="right" mono>
                        <Money value={c.remaining} colored />
                      </Td>
                      <Td align="right">
                        <Badge tone={r >= 80 ? 'ok' : r >= 50 ? 'warn' : 'danger'}>
                          {r}%
                        </Badge>
                      </Td>
                      <Td align="right">
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" variant="ghost"
                                    onClick={() => setAssigning({
                                      id: c.class_id,
                                      name: c.class_name,
                                      branch_id: c.branch_id,
                                    })}>
                              + {t('nav.services')}
                            </Button>
                            <Button size="sm" onClick={() => setEditing({
                              id: c.class_id,
                              name: c.class_name,
                              grade_level: c.grade_level,
                              teacher_id: m?.teacher_id ?? '',
                              capacity: m?.capacity ?? '',
                              academic_year: m?.academic_year ?? '',
                              note: m?.note ?? '',
                              branch_id: c.branch_id,
                            })}>
                              {t('common.edit')}
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--bg-subtle)] font-semibold">
                  <Td>{t('common.total')}</Td>
                  <Td />
                  <Td align="right" mono>{totals.students}</Td>
                  <Td align="right" mono>{money(totals.charged, lang)}</Td>
                  <Td align="right" mono className="text-[var(--ok)]">
                    {money(totals.collected, lang)}
                  </Td>
                  <Td align="right" mono className="text-[var(--danger)]">
                    {money(totals.remaining, lang)}
                  </Td>
                  <Td align="right">
                    <Badge tone={rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger'}>
                      {rate}%
                    </Badge>
                  </Td>
                  <Td />
                </tr>
              </tfoot>
            </Table>
          )}
      </Card>

      {(adding || editing) && (
        <ClassModal
          key={editing?.id ?? 'new'}
          existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          branches={branches}
          defaultBranch={branchId ?? branches[0]?.id ?? ''}
          teachers={teachers.data ?? []}
          onSubmit={(f) => save.mutate(f)}
          busy={save.isPending}
        />
      )}

      {assigning && (
        <AssignServiceModal
          key={assigning.id}
          target={assigning}
          onClose={() => setAssigning(null)}
          branchId={assigning.branch_id}
          onSubmit={(service_id, starts_on) =>
            assign.mutate({ class_id: assigning.id, service_id, starts_on })}
          busy={assign.isPending}
        />
      )}

      {promoting && (
        <PromoteModal
          onClose={() => setPromoting(false)}
          years={[...new Set((meta.data ? [...meta.data.values()] : [])
            .map((m) => m.academic_year))]}
          onSubmit={async (f) => {
            const ok = await confirm({
              title: t('cls.promote'),
              message: t('cls.promoteConfirm', { from: f.from_year, to: f.to_year }),
              warning: t('cls.promoteWarning'),
              danger: true,
              confirmLabel: t('cls.promote'),
            });
            if (ok) promote.mutate(f);
          }}
          busy={promote.isPending}
        />
      )}

    </>
  );
}

// ---------------------------------------------------------------------

function ClassModal({
  existing, onClose, branches, defaultBranch, teachers, onSubmit, busy,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  defaultBranch: string;
  teachers: Array<{ id: string; full_name: string }>;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
}) {
  const t = useT();

  const thisYear = new Date().getFullYear();
  const [f, setF] = useState({
    id: existing?.id ?? null,
    name: existing?.name ?? '',
    grade_level: String(existing?.grade_level ?? ''),
    teacher_id: existing?.teacher_id ?? '',
    capacity: String(existing?.capacity ?? ''),
    academic_year: existing?.academic_year ?? `${thisYear}/${thisYear + 1}`,
    note: existing?.note ?? '',
    branch_id: existing?.branch_id ?? defaultBranch,
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open
      title={existing ? t('cls.edit') : t('cls.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="class-form" type="submit"
                  disabled={busy || !f.name}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="class-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('cls.name')} required>
            <Input value={f.name} onChange={(e) => set('name', e.target.value)}
                   placeholder="5-A" autoFocus required />
          </Field>
          <Field label={t('cls.grade')} hint="Yillik ko'chirish uchun kerak">
            <Input type="number" min={0} max={12} value={f.grade_level}
                   onChange={(e) => set('grade_level', e.target.value)} />
          </Field>
        </div>

        <Field label={t('cls.teacher')} hint={t('cls.teacherHint')}>
          <Select value={f.teacher_id}
                  onChange={(e) => set('teacher_id', e.target.value)}>
            <option value="">—</option>
            {teachers.map((te) => (
              <option key={te.id} value={te.id}>{te.full_name}</option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('cls.capacity')} hint={t('cls.capacityHint')}>
            <Input type="number" min={1} value={f.capacity}
                   onChange={(e) => set('capacity', e.target.value)} />
          </Field>
          <Field label={t('cls.year')} required>
            <Input value={f.academic_year}
                   onChange={(e) => set('academic_year', e.target.value)}
                   placeholder="2026/2027" required />
          </Field>
        </div>

        {branches.length > 1 && !existing && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

function AssignServiceModal({
  target, onClose, branchId, onSubmit, busy,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  branchId: string;
  onSubmit: (serviceId: string, startsOn: string) => void;
  busy: boolean;
}) {
  const t = useT();
  const [serviceId, setServiceId] = useState('');
  const [startsOn, setStartsOn] = useState(isoDate());

  const services = useQuery({
    queryKey: ['services-for-class', branchId],
    enabled: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('id, name, billing_type')
        .eq('branch_id', branchId)
        .eq('is_active', true).is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Modal
      open
      title={`${t('cls.assignService')} — ${target.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={busy || !serviceId}
                  onClick={() => onSubmit(serviceId, startsOn)}>
            {busy ? t('common.saving') : t('common.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('services.title')} required>
          <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}
                  autoFocus>
            <option value="">—</option>
            {(services.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t(`services.type.${s.billing_type}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('services.validFrom')} required>
          <Input type="date" value={startsOn}
                 onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Notice tone="neutral">{t('cls.assignServiceHint')}</Notice>
      </div>
    </Modal>
  );
}

function PromoteModal({
  onClose, years, onSubmit, busy,
}: {
  onClose: () => void;
  years: string[];
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
}) {
  const t = useT();
  const y = new Date().getFullYear();
  const [f, setF] = useState({
    from_year: years[0] ?? `${y - 1}/${y}`,
    to_year: `${y}/${y + 1}`,
    final_grade: '11',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open title={t('cls.promote')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" disabled={busy || !f.from_year || !f.to_year}
                  onClick={() => onSubmit(f)}>
            {busy ? t('common.saving') : t('cls.promote')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Notice tone="warn">{t('cls.promoteHint')}</Notice>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('cls.promoteFrom')} required>
            <Input value={f.from_year}
                   onChange={(e) => set('from_year', e.target.value)}
                   list="years" placeholder="2025/2026" />
          </Field>
          <Field label={t('cls.promoteTo')} required>
            <Input value={f.to_year}
                   onChange={(e) => set('to_year', e.target.value)}
                   placeholder="2026/2027" />
          </Field>
        </div>

        <datalist id="years">
          {years.map((yr) => <option key={yr} value={yr} />)}
        </datalist>

        <Field label={t('cls.finalGrade')} hint={t('cls.finalGradeHint')}>
          <Input type="number" min={1} max={12} value={f.final_grade}
                 onChange={(e) => set('final_grade', e.target.value)} />
        </Field>

        <Notice tone="danger">{t('cls.promoteWarning')}</Notice>
      </div>
    </Modal>
  );
}
