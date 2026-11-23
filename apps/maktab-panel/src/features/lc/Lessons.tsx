// =====================================================================
//  Bugungi darslar.
//
//  Administrator uchun: bugun qaysi darslar bor, qaysilari belgilangan,
//  qaysi o'qituvchi davomatni unutgan (oxirgi 7 kun).
//  O'qituvchi uchun: faqat o'z darslari — bitta bosishda davomat.
// =====================================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import { addDays, colorFor, hhmm } from '@/lib/lc';
import { Badge, Button, Card, EmptyState, Input, Loading, PageHeader } from '@/ui';
import { SessionAttendance, type SessionLite } from './SessionAttendance';

interface Row {
  id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  topic: string | null;
  homework: string | null;
  group_id: string;
  group_name: string;
  course_id: string | null;
  color: string | null;
  teacher: string | null;
  room: string | null;
  students: number;
  marked: number;
}

export default function Lessons() {
  const t = useT();
  const { lang } = useI18n();
  const { profile, branchId } = useAuth();
  const isTeacher = profile?.role === 'teacher';
  const [day, setDay] = useState(isoDate());
  const [open, setOpen] = useState<SessionLite | null>(null);

  const rows = useQuery({
    queryKey: ['lc-day', day, branchId, isTeacher],
    queryFn: async (): Promise<Row[]> => {
      if (isTeacher) {
        const { data, error } = await supabase.rpc('my_group_sessions', { p_day: day });
        if (error) throw error;
        return (data ?? []).map((s) => ({
          id: s.session_id, day: s.day, start_time: s.start_time, end_time: s.end_time,
          status: s.status, topic: null, homework: null, group_id: s.group_id,
          group_name: s.group_name, course_id: null, color: null, teacher: null,
          room: s.room_name, students: s.students, marked: s.marked,
        }));
      }
      let q = supabase.from('group_sessions')
        .select('id, day, start_time, end_time, status, topic, homework, group_id, ' +
          'study_groups!inner(name, course_id, deleted_at, courses(color), teachers(full_name)), rooms(name)')
        .eq('day', day).is('study_groups.deleted_at', null).order('start_time');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      const list = (data ?? []) as any[];
      const ids = list.map((s) => s.id);
      const att = ids.length
        ? (await supabase.from('session_attendance').select('session_id').in('session_id', ids)).data ?? []
        : [];
      const groupIds = [...new Set(list.map((s) => s.group_id))];
      const mem = groupIds.length
        ? (await supabase.from('group_members').select('group_id').in('group_id', groupIds)
          .in('status', ['active', 'trial'])).data ?? []
        : [];
      return list.map((s) => ({
        id: s.id, day: s.day, start_time: s.start_time, end_time: s.end_time, status: s.status,
        topic: s.topic, homework: s.homework, group_id: s.group_id,
        group_name: s.study_groups?.name ?? '', course_id: s.study_groups?.course_id ?? null,
        color: s.study_groups?.courses?.color ?? null, teacher: s.study_groups?.teachers?.full_name ?? null,
        room: s.rooms?.name ?? null,
        students: mem.filter((m) => m.group_id === s.group_id).length,
        marked: att.filter((a) => a.session_id === s.id).length,
      }));
    },
  });

  //  Unutilgan davomat — oxirgi 7 kun (faqat administratorga).
  const overdue = useQuery({
    queryKey: ['lc-overdue', branchId],
    enabled: !isTeacher,
    queryFn: async () => {
      let q = supabase.from('group_sessions')
        .select('id, day, start_time, end_time, status, topic, homework, study_groups!inner(name, deleted_at, teachers(full_name))')
        .eq('status', 'planned').lt('day', isoDate()).gte('day', addDays(isoDate(), -7))
        .is('study_groups.deleted_at', null).order('day', { ascending: false });
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      // deno-lint-ignore no-explicit-any
      return (data ?? []) as any[];
    },
  });

  const today = isoDate();
  const list = rows.data ?? [];

  return (
    <>
      <PageHeader
        title={isTeacher ? t('lc.myLessons') : t('lc.todayLessons')}
        subtitle={date(day, lang)}
        actions={
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, -1))}>‹</Button>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value || today)} className="w-auto" />
            <Button size="sm" variant="ghost" onClick={() => setDay(addDays(day, 1))}>›</Button>
            {day !== today && <Button size="sm" onClick={() => setDay(today)}>{t('lc.today')}</Button>}
          </div>
        }
      />

      {rows.isLoading ? <Loading /> : list.length === 0 ? (
        <EmptyState title={t('lc.noLessonsDay')} hint={t('lc.noLessonsHint')} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => {
            const can = s.status !== 'cancelled' && s.day <= today;
            const late = s.status === 'planned' && s.day < today;
            return (
              <button key={s.id} type="button" disabled={!can}
                onClick={() => setOpen({ ...s, group_name: s.group_name })}
                className="relative overflow-hidden rounded-xl border bg-[var(--bg)] p-3 text-left
                  shadow-[var(--shadow-card)] transition-shadow enabled:hover:shadow-md disabled:opacity-70">
                <span className="absolute inset-y-0 left-0 w-1" style={{ background: colorFor(s.course_id ?? s.group_id, s.color) }} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="num text-[13px] text-[var(--text-muted)]">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                    <div className="truncate text-[15px] font-semibold">{s.group_name}</div>
                    <div className="truncate text-[12px] text-[var(--text-muted)]">
                      {[s.teacher, s.room].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {s.status === 'held' && <Badge tone="ok">{t('lc.sstatus.held')}</Badge>}
                  {s.status === 'cancelled' && <Badge>{t('lc.sstatus.cancelled')}</Badge>}
                  {s.status === 'planned' && (late
                    ? <Badge tone="warn">{t('lc.sstatus.unmarked')}</Badge>
                    : <Badge tone="brand">{t('lc.sstatus.planned')}</Badge>)}
                </div>
                <div className="mt-2 text-[12px] text-[var(--text-muted)]">
                  {s.status === 'held'
                    ? t('lc.l.markedOf', { m: s.marked, n: s.students })
                    : can ? <span className="font-medium text-brand-600 dark:text-accent-400">{t('lc.l.tapToMark')}</span>
                      : t('lc.l.studentsN', { n: s.students })}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!isTeacher && (overdue.data?.length ?? 0) > 0 && (
        <Card title={t('lc.l.overdueTitle', { n: overdue.data!.length })} className="mt-4" padded={false}>
          <ul className="divide-y">
            {overdue.data!.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-[13px] hover:bg-[var(--bg-subtle)]"
                  onClick={() => setOpen({ ...s, group_name: s.study_groups?.name })}>
                  <span>
                    <span className="font-medium">{s.study_groups?.name}</span>
                    <span className="ml-2 text-[var(--text-muted)]">{s.study_groups?.teachers?.full_name}</span>
                  </span>
                  <span className="num text-[var(--text-muted)]">{date(s.day, lang)} {hhmm(s.start_time)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SessionAttendance session={open} onClose={() => setOpen(null)} />
    </>
  );
}
