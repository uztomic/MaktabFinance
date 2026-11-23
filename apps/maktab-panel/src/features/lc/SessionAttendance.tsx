// =====================================================================
//  Dars davomati — o'qituvchi telefonda bir qo'l bilan to'ldiradi.
//
//  Standart: hamma "keldi". O'qituvchi faqat kelmaganlarni bosadi —
//  20 kishilik guruhda 20 marta emas, 2–3 marta bosiladi. Baho va
//  izoh ixtiyoriy. Qarzi bor o'quvchi belgisi — o'qituvchi ham ko'rsin.
// =====================================================================

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { date, money } from '@/lib/format';
import type { MarkStatus } from '@/lib/lc';
import { hhmm } from '@/lib/lc';
import { Badge, Button, Input, Loading, Modal, Notice } from '@/ui';
import { useToast } from '@/ui/Feedback';

export interface SessionLite {
  id: string;
  day: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  topic?: string | null;
  homework?: string | null;
  group_name?: string;
}

const MARKS: MarkStatus[] = ['present', 'late', 'absent', 'excused'];

const MARK_STYLE: Record<MarkStatus, string> = {
  present: 'border-[var(--ok)] bg-[var(--ok-bg)] text-[var(--ok)]',
  late: 'border-[var(--warn)] bg-[var(--warn-bg)] text-[var(--warn)]',
  absent: 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger)]',
  excused: 'border-[var(--border)] bg-[var(--bg-inset)] text-[var(--text-muted)]',
};

export function SessionAttendance({ session, onClose }: {
  session: SessionLite | null;
  onClose: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();

  const roster = useQuery({
    queryKey: ['lc-roster', session?.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('session_roster', { p_session_id: session!.id });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [marks, setMarks] = useState<Record<string, { status: MarkStatus; grade: string; comment: string }>>({});
  const [topic, setTopic] = useState('');
  const [homework, setHomework] = useState('');
  const [details, setDetails] = useState(false);

  useEffect(() => {
    if (!roster.data) return;
    const m: typeof marks = {};
    for (const r of roster.data) {
      m[r.student_id] = {
        status: (r.status as MarkStatus) ?? 'present',
        grade: r.grade != null ? String(r.grade) : '',
        comment: r.comment ?? '',
      };
    }
    setMarks(m);
  }, [roster.data]);

  useEffect(() => {
    setTopic(session?.topic ?? '');
    setHomework(session?.homework ?? '');
    setDetails(false);
  }, [session]);

  const save = useMutation({
    mutationFn: async () => {
      const records = Object.entries(marks).map(([student_id, v]) => ({
        student_id, status: v.status, grade: v.grade, comment: v.comment,
      }));
      const { error } = await supabase.rpc('mark_session_attendance', {
        p_session_id: session!.id,
        p_records: records,
        p_topic: topic.trim() || undefined,
        p_homework: homework.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.ok(t('lc.att.saved'));
      qc.invalidateQueries({ queryKey: ['lc-sessions'] });
      qc.invalidateQueries({ queryKey: ['lc-roster', session?.id] });
      qc.invalidateQueries({ queryKey: ['lc-day'] });
      qc.invalidateQueries({ queryKey: ['lc-journal'] });
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const counts = Object.values(marks).reduce(
    (a, m) => ({ ...a, [m.status]: (a[m.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const future = !!session && session.day > new Date().toISOString().slice(0, 10);

  const setAll = (s: MarkStatus) =>
    setMarks((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, status: s }])));

  return (
    <Modal
      open={!!session}
      wide
      onClose={onClose}
      title={session
        ? `${session.group_name ?? ''} · ${date(session.day, lang)} ${hhmm(session.start_time)}`
        : ''}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={save.isPending || future || !roster.data?.length}
                  onClick={() => save.mutate()}>
            {save.isPending ? t('common.saving') : t('lc.att.save')}
          </Button>
        </>
      }
    >
      {future && <div className="mb-3"><Notice tone="warn">{t('lc.att.future')}</Notice></div>}
      {roster.isLoading ? <Loading /> : roster.error ? (
        <Notice tone="danger">{(roster.error as Error).message}</Notice>
      ) : (roster.data ?? []).length === 0 ? (
        <Notice tone="neutral">{t('lc.att.empty')}</Notice>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
            {MARKS.map((m) => (
              <span key={m} className={`rounded-full border px-2 py-0.5 ${MARK_STYLE[m]}`}>
                {t(`lc.mark.${m}`)}: <b className="num">{counts[m] ?? 0}</b>
              </span>
            ))}
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setAll('present')}>{t('lc.att.allPresent')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setDetails((v) => !v)}>
                {details ? t('lc.att.hideGrades') : t('lc.att.showGrades')}
              </Button>
            </span>
          </div>

          <ul className="divide-y rounded-lg border">
            {roster.data!.map((r) => {
              const m = marks[r.student_id];
              if (!m) return null;
              return (
                <li key={r.student_id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-medium">{r.full_name}</div>
                      <div className="flex gap-1.5">
                        {r.member_status === 'trial' && <Badge tone="warn">{t('lc.mstatus.trial')}</Badge>}
                        {r.member_status === 'frozen' && <Badge>{t('lc.mstatus.frozen')}</Badge>}
                        {Number(r.balance) > 0 && (
                          <Badge tone="danger">{t('lc.att.debt', { sum: money(r.balance, lang) })}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1" role="radiogroup" aria-label={r.full_name}>
                      {MARKS.map((s) => (
                        <button key={s} type="button" role="radio" aria-checked={m.status === s}
                          onClick={() => setMarks((p) => ({ ...p, [r.student_id]: { ...m, status: s } }))}
                          className={`h-9 min-w-9 rounded-lg border px-2 text-[12px] font-semibold transition-colors
                            ${m.status === s ? MARK_STYLE[s] : 'text-[var(--text-faint)] hover:bg-[var(--bg-inset)]'}`}
                          title={t(`lc.mark.${s}`)}>
                          {t(`lc.markShort.${s}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {details && (
                    <div className="mt-2 grid grid-cols-[6rem_1fr] gap-2">
                      <Input type="number" min={0} max={100} placeholder={t('lc.att.grade')}
                             value={m.grade}
                             onChange={(e) => setMarks((p) => ({ ...p, [r.student_id]: { ...m, grade: e.target.value } }))} />
                      <Input placeholder={t('lc.att.comment')} value={m.comment}
                             onChange={(e) => setMarks((p) => ({ ...p, [r.student_id]: { ...m, comment: e.target.value } }))} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input placeholder={t('lc.att.topic')} value={topic} onChange={(e) => setTopic(e.target.value)} />
            <Input placeholder={t('lc.att.homework')} value={homework} onChange={(e) => setHomework(e.target.value)} />
          </div>
        </>
      )}
    </Modal>
  );
}
