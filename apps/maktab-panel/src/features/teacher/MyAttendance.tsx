// =====================================================================
//  "Bugungi davomat" — sinf rahbari uchun (TZ 4.5.3).
//
//  Har kuni ertalab, bir marta. Shuning uchun sahifa BITTA ishga
//  moslangan: sinf ochiladi, kelmaganlar bosiladi, tasdiqlanadi.
//
//  TZ 4.5.3 — telefonda 30 soniyadan ko'p vaqt olmasligi kerak:
//    · sinf bitta bo'lsa u O'ZI ochiladi, tanlash shart emas;
//    · o'quvchi nomi butun kenglikdagi katta tugma — teginish oson;
//    · sabab ixtiyoriy, standart qiymat bilan;
//    · pastda bitta tugma — "Tasdiqlash".
//
//  KELGANLAR EMAS, KELMAGANLAR belgilanadi (TZ 4.5). 30 bolalik
//  sinfda odatda 2-3 tasi bosiladi.
//
//  Huquq brauzerda emas, bazada: `mark_class_attendance` chaqiruvchi
//  aynan shu sinfning rahbari ekanini tekshiradi.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n, useT } from '@/i18n';
import { date, dateTime, isoDate } from '@/lib/format';
import {
  Button, Card, EmptyState, ErrorState, Loading, Notice,
  PageHeader, Select,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

export default function MyAttendance() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();

  const [day, setDay] = useState(isoDate());
  const [classId, setClassId] = useState<string | null>(null);
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [reasonId, setReasonId] = useState('');
  const [touched, setTouched] = useState(false);

  // --- Mening sinflarim va bugungi holat ----------------------------
  const classes = useQuery({
    queryKey: ['my-classes', day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_classes', { p_day: day });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Sinf bitta bo'lsa tanlash bosqichi tashlab yuboriladi.
  useEffect(() => {
    const list = classes.data ?? [];
    if (!classId && list.length > 0) setClassId(list[0].class_id);
  }, [classes.data, classId]);

  const current = (classes.data ?? []).find((c) => c.class_id === classId);

  const reasons = useQuery({
    queryKey: ['absence-reasons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absence_reasons')
        .select('id, code, name, deducts')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!reasonId && reasons.data?.length) setReasonId(reasons.data[0].id);
  }, [reasons.data, reasonId]);

  // --- Sinf o'quvchilari ---------------------------------------------
  const students = useQuery({
    queryKey: ['my-class-students', classId, day],
    enabled: !!classId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id, full_name, payment_code')
        .eq('class_id', classId!)
        .eq('status', 'active')
        .is('deleted_at', null)
        .lte('enrolled_on', day)
        .order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- Shu kunda allaqachon belgilanganlar ---------------------------
  const existing = useQuery({
    queryKey: ['my-class-absences', classId, day],
    enabled: !!classId,
    queryFn: async () => {
      const ids = (students.data ?? []).map((s) => s.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('absences')
        .select('student_id, reason_id')
        .in('student_id', ids)
        .eq('day', day);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Bazadagi holat tanlovga ko'chiriladi — o'qituvchi tuzatish
  // kiritishi mumkin, noldan boshlashi shart emas.
  useEffect(() => {
    if (touched) return;
    const s = new Set<string>();
    for (const a of existing.data ?? []) s.add(a.student_id);
    setAbsent(s);
  }, [existing.data, touched]);

  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('mark_class_attendance', {
        p_class_id: classId!,
        p_day: day,
        p_absent: [...absent].map((id) => ({
          student_id: id,
          reason_id: reasonId || null,
        })),
      });
      if (error) throw error;
      return data as { absent: number };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['my-classes'] });
      qc.invalidateQueries({ queryKey: ['my-class-absences'] });
      setTouched(false);
      toast.ok(t('att.saved', { count: res.absent }));
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function toggle(id: string) {
    setTouched(true);
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const list = students.data ?? [];
  const present = list.length - absent.size;

  const shifted = useMemo(() => {
    const today = isoDate();
    return day !== today;
  }, [day]);

  if (classes.isLoading) return <Loading />;
  if (classes.error) {
    return <ErrorState message={(classes.error as Error).message}
                       onRetry={() => classes.refetch()} />;
  }

  // --- Sinf rahbari emas ---------------------------------------------
  if ((classes.data?.length ?? 0) === 0) {
    return (
      <>
        <PageHeader title={t('att.title')} />
        <Card>
          <EmptyState title={t('att.noClass')} hint={t('att.noClassHint')} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('att.title')}
        subtitle={date(day, lang)}
      />

      {/* --- Kun tanlash. Odatda bugun, lekin kecha unutilgan
              bo'lsa orqaga qaytish mumkin (bir hafta ichida). --- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm"
                onClick={() => { setTouched(false); setDay(shiftDay(day, -1)); }}>
          ←
        </Button>
        <span className="text-sm font-medium">{date(day, lang)}</span>
        <Button size="sm" disabled={!shifted}
                onClick={() => { setTouched(false); setDay(shiftDay(day, 1)); }}>
          →
        </Button>
        {shifted && (
          <Button size="sm" variant="ghost"
                  onClick={() => { setTouched(false); setDay(isoDate()); }}>
            {t('att.today')}
          </Button>
        )}
      </div>

      {/* --- Sinf tanlash — faqat bir nechta bo'lsa ------------- */}
      {(classes.data?.length ?? 0) > 1 && (
        <div className="mb-3">
          <Select
            value={classId ?? ''}
            onChange={(e) => { setTouched(false); setClassId(e.target.value); }}
          >
            {classes.data!.map((c) => (
              <option key={c.class_id} value={c.class_id}>
                {c.class_name} — {c.students} {t('att.students')}
                {c.marked_at ? ' ✓' : ''}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* --- Holat ---------------------------------------------- */}
      {current && !current.is_workday && (
        <div className="mb-3">
          <Notice tone="warn">{t('att.notWorkday')}</Notice>
        </div>
      )}

      {current?.marked_at && !touched && (
        <div className="mb-3">
          <Notice tone="ok">
            {t('att.alreadyMarked', {
              time: dateTime(current.marked_at, lang),
              count: current.absent_count ?? 0,
            })}
          </Notice>
        </div>
      )}

      {/* --- Hisob ---------------------------------------------- */}
      <div className="mb-3 grid grid-cols-3 gap-2">
        <Counter label={t('att.total')} value={list.length} />
        <Counter label={t('att.present')} value={present} tone="ok" />
        <Counter label={t('att.absent')} value={absent.size}
                 tone={absent.size > 0 ? 'danger' : 'neutral'} />
      </div>

      {/* --- Sabab ---------------------------------------------- */}
      {absent.size > 0 && (
        <div className="mb-3">
          <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
            {(reasons.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.deducts ? '' : ` — ${t('att.noDeduct')}`}
              </option>
            ))}
          </Select>
        </div>
      )}

      {/* --- Ro'yxat -------------------------------------------- */}
      <Card padded={false}>
        {students.isLoading
          ? <Loading />
          : list.length === 0
          ? <EmptyState title={t('att.noStudents')} hint="" />
          : (
            <ul>
              {list.map((s) => {
                const off = absent.has(s.id);
                return (
                  <li key={s.id} className="border-b border-[var(--border-soft)]
                    last:border-0">
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      className={`flex w-full items-center justify-between gap-3
                        px-4 py-3.5 text-left transition-colors ${
                          off
                            ? 'bg-[var(--danger-bg)]'
                            : 'hover:bg-[var(--bg-subtle)]'
                        }`}
                    >
                      <span className={`text-[15px] ${
                        off ? 'font-medium text-[var(--danger)]'
                            : 'text-[var(--text)]'}`}>
                        {s.full_name}
                      </span>
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center
                          justify-center rounded-full border-2 text-[13px]
                          font-bold ${
                            off
                              ? 'border-[var(--danger)] bg-[var(--danger)] text-white'
                              : 'border-[var(--border)] text-transparent'
                          }`}
                        aria-hidden="true"
                      >
                        ✕
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      <div className="mt-3">
        <Notice tone="neutral">{t('att.hint')}</Notice>
      </div>

      {/* --- Tasdiqlash. Pastda va butun kenglikda — telefonda
              bosh barmoq aynan shu yerga tushadi. ------------- */}
      <div className="sticky bottom-0 mt-4 -mx-3 border-t bg-[var(--bg)]
        px-3 py-3 md:mx-0 md:rounded-lg md:border">
        <Button
          variant="primary"
          className="w-full !h-11 text-[15px]"
          disabled={save.isPending || list.length === 0
            || (current ? !current.is_workday : false)}
          onClick={() => save.mutate()}
        >
          {save.isPending
            ? t('common.saving')
            : absent.size === 0
            ? t('att.confirmAllPresent')
            : t('att.confirmN', { count: absent.size })}
        </Button>
      </div>
    </>
  );
}

function Counter({ label, value, tone = 'neutral' }: {
  label: string;
  value: number;
  tone?: 'neutral' | 'ok' | 'danger';
}) {
  const color = {
    neutral: 'text-[var(--text)]',
    ok: 'text-[var(--ok)]',
    danger: 'text-[var(--danger)]',
  }[tone];
  return (
    <div className="rounded-lg border bg-[var(--bg)] px-3 py-2 text-center">
      <div className={`num text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}

/** Kunni siljitadi. */
function shiftDay(iso: string, delta: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + delta);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (d > today) return isoDate();
  return isoDate(d);
}
