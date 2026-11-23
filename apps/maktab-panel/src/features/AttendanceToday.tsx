// =====================================================================
//  Davomat — butun maktab, bitta sahifada KO'RISH va BELGILASH.
//
//  Ilgari ikkita sahifa bir ishni qilardi: "Davomat" faqat ko'rsatardi,
//  "Yo'qlik" esa belgilardi (sinfni ro'yxatdan qayta tanlab). Endi
//  qarzdorlik sahifasidagidek: har sinf bitta qator, bossa JOYIDA
//  ochiladi — kim keldi, kim kelmadi, sababi, va (huquq bo'lsa) shu
//  yerning o'zida belgilab saqlash.
//
//  Yozish `mark_class_attendance` orqali — sinf rahbari ishlatadigan
//  o'sha funksiya. Ikki xil yozish yo'li qolmadi, ya'ni ikki ekran
//  bir-biriga zid javob bera olmaydi.
//
//  TZ 4.5: kelganlar emas, KELMAGANLAR belgilanadi. Belgilanmagan sinf
//  ("davomat olinmagan") tepada turadi — e'tibor talab qiladigani shu.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, dateTime, isoDate } from '@/lib/format';
import { exportTable } from '@/lib/export';
import {
  Badge, Button, EmptyState, ErrorState, Input, Loading, Notice,
  Progress, Segmented, Select, Stat,
} from '@/ui';

type ClassRow = {
  class_id: string;
  class_name: string;
  grade_level: number | null;
  teacher_name: string | null;
  total: number;
  present: number;
  absent: number;
  late: number;
  checked: boolean;
  marked_at: string | null;
};

type Filter = 'all' | 'unchecked' | 'absent';

export function AttendanceToday() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId } = useAuth();

  const [day, setDay] = useState(isoDate());
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const rows = useQuery({
    queryKey: ['attendance-today', day, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_attendance_today', {
        p_day: day,
        p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as ClassRow[];
    },
  });

  const list = useMemo(() => [...(rows.data ?? [])].sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1;
    return (a.grade_level ?? 99) - (b.grade_level ?? 99)
      || a.class_name.localeCompare(b.class_name, undefined, { numeric: true });
  }), [rows.data]);

  const totals = list.reduce((a, r) => ({
    total: a.total + r.total,
    present: a.present + r.present,
    absent: a.absent + r.absent,
  }), { total: 0, present: 0, absent: 0 });
  const unchecked = list.filter((r) => !r.checked && r.total > 0).length;

  const shown = list.filter((r) =>
    filter === 'all' ? true
      : filter === 'unchecked' ? !r.checked && r.total > 0
      : r.absent > 0);

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const doExport = () => exportTable(
    'davomat',
    [
      { header: t('students.class'), value: (r: ClassRow) => r.class_name },
      { header: t('cls.teacher'), value: (r: ClassRow) => r.teacher_name },
      { header: t('att.students'), value: (r: ClassRow) => r.total, numeric: true },
      { header: t('att.came'), value: (r: ClassRow) => r.present, numeric: true },
      { header: t('att.notCame'), value: (r: ClassRow) => r.absent, numeric: true },
      {
        header: t('att.checked'),
        value: (r: ClassRow) => (r.checked ? t('common.yes') : t('common.no')),
      },
    ],
    list,
    [t('att.overviewTitle'), date(day, lang)],
  );

  const rate = totals.total > 0 ? Math.round((totals.present / totals.total) * 100) : 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" value={day} max={isoDate()} className="w-[160px]"
               aria-label={t('common.date')}
               onChange={(e) => { setDay(e.target.value); setOpen(new Set()); }} />
        <div className="flex-1" />
        <Button onClick={doExport} disabled={list.length === 0}>{t('common.export')}</Button>
      </div>

      {rows.isLoading ? <Loading /> : rows.error ? (
        <ErrorState message={(rows.error as Error).message} onRetry={() => rows.refetch()} />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border bg-[var(--bg)]"><EmptyState /></div>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={t('att.came')} value={`${totals.present} / ${totals.total}`} tone="ok">
              <div className="mt-3"><Progress value={rate} /></div>
            </Stat>
            <Stat label={t('att.notCame')} value={String(totals.absent)}
                  tone={totals.absent > 0 ? 'danger' : 'neutral'} />
            <div className="col-span-2 lg:col-span-1">
              <Stat label={t('att.notChecked')} value={String(unchecked)}
                    tone={unchecked > 0 ? 'warn' : 'ok'}
                    hint={unchecked > 0 ? t('att.uncheckedShort') : t('att.allChecked')} />
            </div>
          </div>

          <div className="mb-3">
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: t('dm.all') },
                { value: 'unchecked', label: <>{t('att.notChecked')} <Count n={unchecked} /></> },
                { value: 'absent', label: <>{t('att.withAbsent')} <Count n={list.filter((r) => r.absent > 0).length} /></> },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <div className="rounded-2xl border bg-[var(--bg)]"><EmptyState hint="" /></div>
          ) : (
            <div className="space-y-2">
              {shown.map((r) => (
                <ClassRowView key={r.class_id} r={r} day={day}
                              open={open.has(r.class_id)} onToggle={() => toggle(r.class_id)} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="num text-[11.5px] text-[var(--text-faint)]">{n}</span>;
}

// ---------------------------------------------------------------------

function ClassRowView({ r, day, open, onToggle }: {
  r: ClassRow;
  day: string;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const empty = r.total === 0;

  return (
    <section className="overflow-hidden rounded-2xl border bg-[var(--bg)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-subtle)] md:gap-5 md:px-5"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-90' : ''}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>

        <div className="min-w-0 flex-1 md:flex-none md:basis-56">
          <div className="truncate text-[15px] font-semibold tracking-tight">{r.class_name}</div>
          <div className="truncate text-[12px] text-[var(--text-faint)]">{r.teacher_name ?? '—'}</div>
        </div>

        <div className="hidden flex-1 items-center gap-2 md:flex">
          {!empty && (r.checked
            ? <Badge tone="ok">✓ {r.marked_at ? dateTime(r.marked_at, lang).split(', ')[1] : t('att.checkedShort')}</Badge>
            : <Badge tone="warn">{t('att.notChecked')}</Badge>)}
          {r.absent > 0 && <Badge tone="danger"><span className="num mr-1 font-semibold">{r.absent}</span>{t('att.notCame').toLowerCase()}</Badge>}
        </div>

        <div className="shrink-0 text-right">
          <div className="num text-[15px] font-semibold">
            <span className={r.checked ? 'text-[var(--ok)]' : ''}>{r.present}</span>
            <span className="text-[var(--text-faint)]"> / {r.total}</span>
          </div>
          <div className="text-[11.5px] md:hidden">
            {r.checked
              ? <span className="text-[var(--ok)]">✓</span>
              : <span className="text-[var(--warn)]">{t('att.notChecked')}</span>}
            {r.absent > 0 && <span className="text-[var(--danger)]"> · {r.absent}</span>}
          </div>
          <div className="hidden text-[11.5px] text-[var(--text-faint)] md:block">{t('att.came')}</div>
        </div>
      </button>

      {open && <ClassPanel r={r} day={day} />}
    </section>
  );
}

/**
 *  Sinf ichi: har o'quvchi bitta qator. Huquq bo'lsa — bosib
 *  "kelmadi" qilinadi, sabab tanlanadi va saqlanadi.
 */
function ClassPanel({ r, day }: { r: ClassRow; day: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { mayWrite } = useAuth();
  const canMark = mayWrite('absences.mark');

  const students = useQuery({
    queryKey: ['class-attendance', r.class_id, day],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('class_attendance_students', {
        p_class_id: r.class_id, p_day: day,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  //  Belgilangan yo'qliklarning sababi (id) — qayta saqlashda yo'qolmasin.
  const existing = useQuery({
    queryKey: ['class-absences', r.class_id, day, students.data?.length ?? 0],
    enabled: canMark && !!students.data,
    queryFn: async () => {
      const ids = (students.data ?? []).map((s) => s.student_id);
      if (ids.length === 0) return new Map<string, string | null>();
      const { data, error } = await supabase.from('absences')
        .select('student_id, reason_id').eq('day', day).in('student_id', ids);
      if (error) throw error;
      return new Map((data ?? []).map((a) => [a.student_id, a.reason_id]));
    },
  });

  const reasons = useQuery({
    queryKey: ['absence-reasons'],
    enabled: canMark,
    queryFn: async () => {
      const { data, error } = await supabase.from('absence_reasons')
        .select('id, name, deducts').eq('is_active', true).order('sort_order');
      if (error) throw error;
      return data ?? [];
    },
  });

  //  Joriy tanlov: student_id → reason_id ('' — sababsiz).
  const [absent, setAbsent] = useState<Map<string, string>>(new Map());
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!students.data) return;
    const m = new Map<string, string>();
    for (const s of students.data) {
      if (!s.is_present) m.set(s.student_id, existing.data?.get(s.student_id) ?? '');
    }
    setAbsent(m);
    setDirty(false);
  }, [students.data, existing.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('mark_class_attendance', {
        p_class_id: r.class_id,
        p_day: day,
        p_absent: [...absent].map(([student_id, reason_id]) => ({
          student_id, reason_id: reason_id || null,
        })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['attendance-today'] });
      qc.invalidateQueries({ queryKey: ['class-attendance', r.class_id, day] });
      qc.invalidateQueries({ queryKey: ['class-absences', r.class_id, day] });
      qc.invalidateQueries({ queryKey: ['absence-gaps'] });
    },
  });

  if (students.isLoading) return <div className="border-t"><Loading /></div>;
  if ((students.data?.length ?? 0) === 0) {
    return <div className="border-t"><EmptyState hint="" /></div>;
  }

  const flip = (id: string) => {
    if (!canMark) return;
    setAbsent((m) => {
      const n = new Map(m);
      if (n.has(id)) n.delete(id); else n.set(id, '');
      return n;
    });
    setDirty(true);
  };

  return (
    <div className="border-t border-[var(--border-soft)]">
      {students.data!.map((s) => {
        const isAbsent = canMark ? absent.has(s.student_id) : !s.is_present;
        return (
          <div key={s.student_id}
               className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border-soft)]
                 px-4 py-2.5 last:border-b-0 md:px-5 md:pl-12
                 ${isAbsent ? 'bg-[var(--danger-bg)]' : ''}`}>
            <Link to={`/oquvchilar/${s.student_id}`}
                  className="min-w-0 flex-1 truncate text-[14px] font-medium hover:underline">
              {s.full_name}
            </Link>

            {isAbsent && canMark && (
              <Select
                value={absent.get(s.student_id) ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setAbsent((m) => new Map(m).set(s.student_id, v));
                  setDirty(true);
                }}
                className="h-8 w-44 text-[13px]"
                aria-label={t('absences.reason')}
              >
                <option value="">{t('att.noReason')}</option>
                {(reasons.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </Select>
            )}
            {isAbsent && !canMark && (
              <span className="text-[12.5px] text-[var(--text-muted)]">
                {s.reason_name ?? t('att.noReason')}
              </span>
            )}

            <button
              type="button"
              onClick={() => flip(s.student_id)}
              disabled={!canMark}
              className={`h-8 min-w-[92px] shrink-0 rounded-lg px-3 text-[12.5px] font-medium transition-colors
                disabled:cursor-default ${isAbsent
                  ? 'bg-[var(--danger)] text-white'
                  : s.is_late
                  ? 'bg-[var(--warn-bg)] text-[var(--warn)]'
                  : 'bg-[var(--ok-bg)] text-[var(--ok)]'}`}
            >
              {isAbsent ? t('att.notCame') : s.is_late ? t('att.late') : t('att.came')}
            </button>
          </div>
        );
      })}

      {canMark && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-subtle)] px-4 py-3 md:px-5">
          <span className="text-[13px] text-[var(--text-muted)]">
            {t('att.tapHint')} · {t('att.notCame')}: <strong className="num">{absent.size}</strong>
          </span>
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || (!dirty && r.checked)}>
            {save.isPending ? t('common.saving') : r.checked && !dirty ? `✓ ${t('att.saved')}` : t('att.save')}
          </Button>
          {save.error && (
            <div className="w-full">
              <Notice tone="danger">
                {(save.error as Error).message.includes('Davr yopilgan')
                  ? t('absences.lockedPeriod')
                  : (save.error as Error).message}
              </Notice>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Bosh sahifa uchun ixcham xulosa — to'liq ro'yxat Davomat sahifasida. */
export function AttendanceSummary() {
  const t = useT();
  const { branchId } = useAuth();
  const day = isoDate();
  const rows = useQuery({
    queryKey: ['attendance-today', day, branchId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('report_attendance_today', {
        p_day: day, p_branch_id: branchId ?? undefined,
      });
      if (error) throw error;
      return (data ?? []) as ClassRow[];
    },
  });
  const list = rows.data ?? [];
  if (list.length === 0) return null;
  const total = list.reduce((a, r) => a + r.total, 0);
  const present = list.reduce((a, r) => a + r.present, 0);
  const absent = list.reduce((a, r) => a + r.absent, 0);
  const unchecked = list.filter((r) => !r.checked && r.total > 0).length;
  return (
    <Link to="/davomat" className="block rounded-2xl border bg-[var(--bg)] p-5 hover:bg-[var(--bg-subtle)]">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold tracking-tight">{t('att.todayTitle')}</span>
        <span className="text-[var(--text-faint)]">→</span>
      </div>
      <div className="num mt-3 text-[26px] font-semibold tracking-tight">
        <span className="text-[var(--ok)]">{present}</span>
        <span className="text-[var(--text-faint)]"> / {total}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[12.5px]">
        {absent > 0 && <span className="text-[var(--danger)]">{absent} {t('att.notCame').toLowerCase()}</span>}
        {unchecked > 0
          ? <span className="text-[var(--warn)]">{unchecked} {t('att.classesUnchecked')}</span>
          : <span className="text-[var(--ok)]">{t('att.allChecked')}</span>}
      </div>
    </Link>
  );
}
