// =====================================================================
//  O'quvchi kartochkasidagi "Guruhlar" bloki (o'quv markazi).
//
//  Bir o'quvchi bir nechta guruhda o'qishi mumkin (ingliz tili +
//  matematika). Har birining holati, davomati va narxi shu yerda.
// =====================================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import { colorFor, hhmm, useGroups } from '@/lib/lc';
import { Badge, Button, Card, Field, Input, Modal, Select } from '@/ui';
import { useToast } from '@/ui/Feedback';
import { daysLabel } from './Groups';

export function StudentGroups({ studentId }: { studentId: string }) {
  const t = useT();
  const { lang } = useI18n();
  const { mayWrite, branchId } = useAuth();
  const [adding, setAdding] = useState(false);

  const rows = useQuery({
    queryKey: ['lc-student-groups', studentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('group_members')
        .select('id, group_id, status, joined_on, left_on, study_groups(name, days, start_time, end_time, course_id, courses(name, color), teachers(full_name))')
        .eq('student_id', studentId).order('joined_on', { ascending: false });
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []) as any[];
    },
  });

  const att = useQuery({
    queryKey: ['lc-student-att', studentId],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const { data, error } = await supabase.from('session_attendance')
        .select('status, created_at').eq('student_id', studentId).gte('created_at', since.toISOString());
      if (error) throw error;
      const n = (data ?? []).length;
      const p = (data ?? []).filter((x) => x.status === 'present' || x.status === 'late').length;
      return n ? Math.round((100 * p) / n) : null;
    },
  });

  const open = (rows.data ?? []).filter((m) => m.status !== 'left');
  const past = (rows.data ?? []).filter((m) => m.status === 'left');

  return (
    <Card
      title={`${t('lc.groups')} · ${open.length}`}
      className="mb-4"
      action={
        <span className="flex items-center gap-2">
          {att.data != null && (
            <span className={`text-[12px] ${att.data < 70 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
              {t('lc.sg.attendance30', { p: att.data })}
            </span>
          )}
          {mayWrite('students.manage') && (
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>{t('lc.sg.add')}</Button>
          )}
        </span>
      }
    >
      {open.length === 0 ? (
        <p className="text-[13px] text-[var(--text-muted)]">{t('lc.sg.none')}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {open.map((m) => {
            const g = m.study_groups;
            return (
              <li key={m.id}>
                <Link to={`/guruhlar/${m.group_id}`}
                  className="flex gap-3 rounded-lg border p-2.5 hover:bg-[var(--bg-subtle)]">
                  <span className="w-1 shrink-0 rounded-full" style={{ background: colorFor(g?.course_id ?? m.group_id, g?.courses?.color) }} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{g?.name}</span>
                      <Badge tone={m.status === 'active' ? 'ok' : m.status === 'trial' ? 'warn' : 'brand'}>
                        {t(`lc.mstatus.${m.status}`)}
                      </Badge>
                    </span>
                    <span className="block truncate text-[12px] text-[var(--text-muted)]">
                      {[g?.teachers?.full_name, `${daysLabel(g?.days, t)} ${hhmm(g?.start_time)}`].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-[11px] text-[var(--text-faint)]">{t('lc.sg.since', { d: date(m.joined_on, lang) })}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {past.length > 0 && (
        <p className="mt-2 text-[12px] text-[var(--text-faint)]">
          {t('lc.sg.past')}: {past.map((m) => m.study_groups?.name).join(', ')}
        </p>
      )}
      <EnrollFromStudent open={adding} studentId={studentId} branchId={branchId}
        exclude={open.map((m) => m.group_id)} onClose={() => setAdding(false)} />
    </Card>
  );
}

function EnrollFromStudent({ open, studentId, branchId, exclude, onClose }: {
  open: boolean; studentId: string; branchId: string | null; exclude: string[]; onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const groups = useGroups(branchId);
  const [groupId, setGroupId] = useState('');
  const [from, setFrom] = useState(isoDate());
  const [trial, setTrial] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('enroll_to_group', {
        p_group_id: groupId, p_student_id: studentId, p_from: from, p_trial: trial,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.ok(trial ? t('lc.m.addedTrial') : t('lc.m.added'));
      qc.invalidateQueries({ queryKey: ['lc-student-groups', studentId] });
      qc.invalidateQueries({ queryKey: ['lc-member-counts'] });
      setGroupId(''); setTrial(false);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal open={open} onClose={onClose} title={t('lc.sg.add')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" disabled={!groupId || save.isPending} onClick={() => save.mutate()}>
          {trial ? t('lc.m.addTrial') : t('lc.m.addActive')}
        </Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t('lc.group.one')} required>
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">—</option>
            {(groups.data ?? []).filter((g) => g.status !== 'finished' && !exclude.includes(g.id)).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} — {daysLabel(g.days, t)} {hhmm(g.start_time)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={trial ? t('lc.m.trialDate') : t('lc.m.fromDate')} hint={trial ? undefined : t('lc.m.fromHint')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <label className="flex items-start gap-2 rounded-lg border p-3 text-[13px]">
          <input type="checkbox" className="mt-0.5" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
          <span>
            <span className="font-medium">{t('lc.m.trial')}</span>
            <span className="block text-[12px] text-[var(--text-muted)]">{t('lc.m.trialHint')}</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
