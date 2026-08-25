// =====================================================================
//  O'qituvchilar va ularning yuklamasi (TZ 4.11.1, 4.11.2).
//
//  TZ 2.2 — kadrlar hujjatlari yuritilmaydi. Shuning uchun bu yerda
//  faqat OYLIK HISOBI uchun kerakli maydonlar: stavka, yuklama,
//  toifa, filiallar va ustamalar.
// =====================================================================

import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { currentPeriod, isoDate, money, num, periodLabel, shiftPeriod } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Modal, MoneyInput, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';
import { CatalogSelect } from '@/ui/CatalogSelect';

export default function Teachers() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branches, mayWrite, can, profile } = useAuth();

  const toast = useToast();
  const [adding, setAdding] = useState(false);
  // deno-lint-ignore no-explicit-any
  const [editing, setEditing] = useState<any>(null);
  const [lessonFor, setLessonFor] = useState<{ id: string; name: string } | null>(null);
  const [period, setPeriod] = useState(currentPeriod());

  const canEdit = mayWrite('teachers.manage');

  const list = useQuery({
    queryKey: ['teachers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, full_name, phone, category, rate_factor, base_salary, weekly_hours, is_active, user_id, teacher_branches(branch_id, load_share, branches(name))')
        .is('deleted_at', null)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // Davrdagi soatlar — yuklamani ko'rsatish uchun (TZ 4.11.2).
  const hours = useQuery({
    queryKey: ['teacher-hours', period],
    queryFn: async () => {
      const from = period;
      const d = new Date(period);
      const to = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));

      const { data, error } = await supabase
        .from('lessons')
        .select('teacher_id, hours, kind')
        .gte('day', from)
        .lte('day', to);
      if (error) throw error;

      const map = new Map<string, { held: number; subst: number; unheld: number }>();
      for (const l of data ?? []) {
        const cur = map.get(l.teacher_id) ?? { held: 0, subst: 0, unheld: 0 };
        const h = Number(l.hours);
        if (l.kind === 'held') cur.held += h;
        else if (l.kind === 'substituted') cur.subst += h;
        else cur.unheld += h;
        map.set(l.teacher_id, cur);
      }
      return map;
    },
  });

  const save = useMutation({
    // deno-lint-ignore no-explicit-any
    mutationFn: async (f: any) => {
      // --- TAHRIRLASH ------------------------------------------
      // Filial ulushi (`teacher_branches.load_share`) bu yerda emas,
      // o'qituvchi kartochkasida boshqariladi: u yerda bir nechta
      // filial va ularning ulushi ko'rinadi (TZ 4.11.4).
      if (f.id) {
        const { error } = await supabase.from('teachers').update({
          full_name: f.full_name.trim(),
          phone: f.phone.trim() || null,
          category: f.category.trim() || null,
          rate_factor: Number(f.rate_factor || 1),
          base_salary: Number(f.base_salary || 0),
          weekly_hours: Number(f.weekly_hours || 0),
          is_active: f.is_active,
        }).eq('id', f.id);
        if (error) throw error;
        return { id: f.id };
      }

      const { data: te, error } = await supabase.from('teachers').insert({
        school_id: profile!.school_id,
        full_name: f.full_name.trim(),
        phone: f.phone.trim() || null,
        category: f.category.trim() || null,
        rate_factor: Number(f.rate_factor || 1),
        base_salary: Number(f.base_salary || 0),
        weekly_hours: Number(f.weekly_hours || 0),
        hired_on: isoDate(),
      }).select('id').single();
      if (error) throw error;

      // TZ 4.11.4 — filial biriktirilmagan xodim uchun oylik xarajati
      // taqsimlanmaydi, shuning uchun kamida bitta filial majburiy.
      const { error: bErr } = await supabase.from('teacher_branches').insert({
        teacher_id: te.id,
        branch_id: f.branch_id,
        load_share: 1.0,
      });
      if (bErr) throw bErr;
      return te;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      toast.ok(t('ux.saved'));
      setAdding(false);
      setEditing(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const addLesson = useMutation({
    mutationFn: async (f: {
      teacher_id: string; branch_id: string; day: string;
      hours: string; kind: string; subject: string; reason: string;
    }) => {
      const { error } = await supabase.from('lessons').insert({
        school_id: profile!.school_id,
        branch_id: f.branch_id,
        teacher_id: f.teacher_id,
        day: f.day,
        hours: Number(f.hours),
        kind: f.kind as 'held' | 'substituted' | 'not_held',
        subject: f.subject.trim() || null,
        reason: f.reason.trim() || null,
        created_by: profile!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher-hours'] });
      setLessonFor(null);
    },
  });

  if (!can('teachers.manage')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (list.isLoading) return <Loading />;
  if (list.error) {
    return <ErrorState message={(list.error as Error).message}
                       onRetry={() => list.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title={t('teachers.title')}
        subtitle={`${periodLabel(period, lang)} · ${t('common.showing', { count: list.data?.length ?? 0 })}`}
        actions={
          <>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, -1))}>←</Button>
            <Button size="sm" onClick={() => setPeriod(shiftPeriod(period, 1))}>→</Button>
            {canEdit && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                {t('teachers.add')}
              </Button>
            )}
          </>
        }
      />

      <Card padded={false}>
        {(list.data?.length ?? 0) === 0
          ? (
            <EmptyState
              action={canEdit && (
                <Button onClick={() => setAdding(true)}>{t('teachers.add')}</Button>
              )}
            />
          )
          : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.fullName')}</Th>
                  <Th>{t('teachers.category')}</Th>
                  <Th align="right">{t('teachers.rateFactor')}</Th>
                  <Th align="right">{t('teachers.baseSalary')}</Th>
                  <Th align="right">{t('lessons.kind.held')}</Th>
                  <Th align="right">{t('lessons.kind.substituted')}</Th>
                  <Th align="right">{t('lessons.kind.not_held')}</Th>
                  <Th>{t('teachers.branches')}</Th>
                  <Th align="right">{t('common.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {list.data!.map((te) => {
                  const h = hours.data?.get(te.id);
                  // deno-lint-ignore no-explicit-any
                  const tb = (te as any).teacher_branches ?? [];
                  return (
                    <Tr key={te.id} className={te.is_active ? '' : 'opacity-60'}>
                      <Td>
                        <Link to={`/oqituvchilar/${te.id}`}
                              className="font-medium hover:underline">
                          {te.full_name}
                        </Link>
                        {!te.is_active && (
                          <span className="ml-1.5">
                            <Badge tone="neutral">{t('common.inactive')}</Badge>
                          </span>
                        )}
                        {!te.user_id && (
                          <span className="ml-1.5 text-[11px] text-[var(--text-faint)]">
                            {t('teachers.notLinked')}
                          </span>
                        )}
                      </Td>
                      <Td className="text-[var(--text-muted)]">{te.category ?? '—'}</Td>
                      <Td align="right" mono>{num(te.rate_factor, lang, 2)}</Td>
                      <Td align="right" mono>{money(te.base_salary, lang)}</Td>
                      <Td align="right" mono>{h ? num(h.held, lang, 1) : '—'}</Td>
                      <Td align="right" mono className="text-[var(--ok)]">
                        {h?.subst ? num(h.subst, lang, 1) : '—'}
                      </Td>
                      <Td align="right" mono className="text-[var(--danger)]">
                        {h?.unheld ? num(h.unheld, lang, 1) : '—'}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {/* deno-lint-ignore no-explicit-any */}
                          {tb.map((b: any) => (
                            <Badge key={b.branch_id}>{b.branches?.name}</Badge>
                          ))}
                          {tb.length === 0 && (
                            <Badge tone="danger">{t('common.empty')}</Badge>
                          )}
                        </div>
                      </Td>
                      <Td align="right">
                        {canEdit && (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => setLessonFor({
                                id: te.id, name: te.full_name,
                              })}
                            >
                              {t('lessons.add')}
                            </Button>
                            <Button size="sm" onClick={() => setEditing(te)}>
                              {t('common.edit')}
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
      </Card>

      {(adding || editing) && (
        <TeacherModal
          key={editing?.id ?? 'new'}
          existing={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          branches={branches}
          onSubmit={(f) => save.mutate(f)}
          busy={save.isPending}
          error={save.error ? (save.error as Error).message : null}
        />
      )}

      <AddLessonModal
        target={lessonFor}
        onClose={() => setLessonFor(null)}
        branches={branches}
        onSubmit={(f) => addLesson.mutate({ ...f, teacher_id: lessonFor!.id })}
        busy={addLesson.isPending}
        error={addLesson.error ? (addLesson.error as Error).message : null}
      />
    </>
  );
}

// ---------------------------------------------------------------------

function TeacherModal({
  existing, onClose, branches, onSubmit, busy, error,
}: {
  // deno-lint-ignore no-explicit-any
  existing: any;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    id: existing?.id as string | undefined,
    full_name: existing?.full_name ?? '',
    phone: existing?.phone ?? '',
    category: existing?.category ?? '',
    rate_factor: String(existing?.rate_factor ?? '1'),
    base_salary: existing ? String(existing.base_salary ?? '') : '',
    weekly_hours: existing ? String(existing.weekly_hours ?? '') : '',
    branch_id: branches[0]?.id ?? '',
    is_active: existing?.is_active ?? true,
  });

  const set = (k: string, v: string | boolean) =>
    setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open title={existing ? t('teachers.edit') : t('teachers.add')} onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="teacher-form" type="submit"
                  disabled={busy || !f.full_name}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="teacher-form"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <Field label={t('common.fullName')} required>
          <Input value={f.full_name} onChange={(e) => set('full_name', e.target.value)}
                 autoFocus required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.phone')}>
            <Input value={f.phone} onChange={(e) => set('phone', e.target.value)}
                   inputMode="tel" placeholder="998901234567" />
          </Field>
          <CatalogSelect
            kind="teacher_category"
            label={t('teachers.category')}
            hint={t('teachers.categoryHint')}
            value={f.category}
            onChange={(v) => set('category', v)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('teachers.rateFactor')} hint={t('teachers.rateFactorHint')}>
            <Input type="number" step="0.05" min="0.05" max="3"
                   value={f.rate_factor}
                   onChange={(e) => set('rate_factor', e.target.value)} />
          </Field>
          <Field label={t('teachers.weeklyHours')}>
            <Input type="number" step="0.5" min="0" value={f.weekly_hours}
                   onChange={(e) => set('weekly_hours', e.target.value)} />
          </Field>
        </div>

        <Field label={t('teachers.baseSalary')}
               hint={t('teachers.baseSalaryHint')}>
          <MoneyInput value={f.base_salary}
                      onChange={(e) => set('base_salary', e.target.value)} />
        </Field>

        {!existing && (
          <Field label={t('common.branch')} required
                 hint={t('teachers.branchHint')}>
            <Select value={f.branch_id}
                    onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {existing && (
          <>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={f.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
                className="h-4 w-4"
              />
              {t('common.active')}
            </label>
            {!f.is_active && (
              <Notice tone="warn">{t('teachers.deactivateHint')}</Notice>
            )}
            <Notice tone="neutral">{t('teachers.branchesInCard')}</Notice>
          </>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}

function AddLessonModal({
  target, onClose, branches, onSubmit, busy, error,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
  branches: Array<{ id: string; name: string }>;
  // deno-lint-ignore no-explicit-any
  onSubmit: (f: any) => void;
  busy: boolean;
  error: string | null;
}) {
  const t = useT();
  const [f, setF] = useState({
    branch_id: branches[0]?.id ?? '',
    day: isoDate(), hours: '1', kind: 'held', subject: '', reason: '',
  });
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open={!!target}
      title={`${t('lessons.add')} — ${target?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" form="add-lesson" type="submit" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="add-lesson"
        onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(f); }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('common.date')} required>
            <Input type="date" value={f.day} onChange={(e) => set('day', e.target.value)}
                   required />
          </Field>
          <Field label={t('lessons.hours')} required>
            <Input type="number" step="0.5" min="0.5" value={f.hours}
                   onChange={(e) => set('hours', e.target.value)} required />
          </Field>
        </div>

        <Field label={t('lessons.kind')} required>
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="held">{t('lessons.kind.held')}</option>
            <option value="substituted">{t('lessons.kind.substituted')}</option>
            <option value="not_held">{t('lessons.kind.not_held')}</option>
          </Select>
        </Field>

        {f.kind === 'not_held' && (
          <Field
            label={t('lessons.reason')}
            required
            hint={t('lessons.reasonHint')}
          >
            <Input value={f.reason} onChange={(e) => set('reason', e.target.value)}
                   placeholder="holiday / quarantine / teacher_absent" required />
          </Field>
        )}

        <Field label={t('lessons.subject')}>
          <Input value={f.subject} onChange={(e) => set('subject', e.target.value)} />
        </Field>

        {branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
        )}

        {error && <Notice tone="danger">{error}</Notice>}
      </form>
    </Modal>
  );
}
