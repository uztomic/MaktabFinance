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
  Modal, Notice, PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import {
  type NewLogin, TeacherCredentials, TeacherModal, useSaveTeacher,
} from './teacher/TeacherForm';

export default function Teachers() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branches, mayWrite, can, profile } = useAuth();

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
        .select('id, full_name, phone, category, rate_factor, base_salary, weekly_hours, is_active, user_id, teacher_branches(branch_id, load_share, branches(name)), classes(id, name, is_active)')
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
        //  Bekor qilingan dars sanalmaydi — oylik ham unga tayanmaydi.
        .is('deleted_at', null)
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

  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);

  const save = useSaveTeacher(
    () => { setAdding(false); setEditing(null); },
    setNewLogin,
  );

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

      {/*  Parol serverda yaratiladi va hech qayerda saqlanmaydi —
           faqat shu javobda bir marta keladi. Shuning uchun uni
           darhol ko'rsatamiz. */}
      {newLogin && (
        <TeacherCredentials data={newLogin} onClose={() => setNewLogin(null)} />
      )}

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
