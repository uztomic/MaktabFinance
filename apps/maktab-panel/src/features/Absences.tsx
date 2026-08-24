// =====================================================================
//  Yo'qlik qayd etuvi (TZ 4.5).
//
//  ASOSIY TAMOYIL: tizimda KELGANLAR EMAS, KELMAGANLAR belgilanadi.
//  Standart holatda barcha o'quvchi xizmatdan foydalangan hisoblanadi.
//  Amalda 300 o'quvchidan 5-15 tasi belgilanadi.
//
//  TZ 4.5.3 — interfeys TELEFONDA ishlaydi va bitta sinfni belgilash
//  30 SONIYADAN KO'P VAQT OLMASLIGI kerak. Shuning uchun:
//    · sinf tanlanadi → o'quvchilar darhol ro'yxatda
//    · har biri bitta teginish bilan belgilanadi (yirik maydon)
//    · sabab ixtiyoriy, standart qiymat bilan
//    · "Kunni tasdiqlash" bitta tugma
//
//  TZ 4.5.1 — faqat KUNLIK xizmatga yozilgan o'quvchilar ko'rsatiladi.
// =====================================================================

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, Loading,
  Notice, PageHeader, Select,
} from '@/ui';

export default function Absences() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const { branchId, branches, mayWrite, can, profile } = useAuth();

  const [day, setDay] = useState(isoDate());
  const [className, setClassName] = useState('');
  const [reasonId, setReasonId] = useState('');
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const activeBranch = branchId ?? branches[0]?.id ?? null;
  const canMark = mayWrite('absences.mark');

  // --- Kunlik xizmatga yozilgan o'quvchilar (TZ 4.5.1) --------------
  const roster = useQuery({
    queryKey: ['absence-roster', activeBranch, day],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_services')
        .select('student_id, starts_on, ends_on, services!inner(id, name, billing_type, branch_id, is_active), students!inner(id, full_name, class_name, branch_id, status, deleted_at)',
        )
        .eq('services.billing_type', 'daily')
        .eq('services.is_active', true)
        .eq('students.branch_id', activeBranch!)
        .eq('students.status', 'active')
        .lte('starts_on', day);
      if (error) throw error;

      // Muddati tugagan yozilishlarni chiqarib tashlaymiz.
      return (data ?? []).filter((r) => !r.ends_on || r.ends_on >= day);
    },
  });

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

  // --- Shu kunda allaqachon belgilangan yo'qliklar ------------------
  const existing = useQuery({
    queryKey: ['absences', activeBranch, day],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absences')
        .select('id, student_id, reason_id')
        .eq('branch_id', activeBranch!)
        .eq('day', day);
      if (error) throw error;
      return data ?? [];
    },
  });

  // --- Sinf ko'rib chiqilganmi (TZ 4.5.6) ---------------------------
  const checks = useQuery({
    queryKey: ['attendance-checks', activeBranch, day],
    enabled: !!activeBranch,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attendance_checks')
        .select('class_name, marked_at, absent_count')
        .eq('branch_id', activeBranch!)
        .eq('day', day);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Sinflar ro'yxati
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const r of roster.data ?? []) {
      // deno-lint-ignore no-explicit-any
      const cn = (r as any).students?.class_name;
      if (cn) set.add(cn);
    }
    return [...set].sort();
  }, [roster.data]);

  // Tanlangan sinfning o'quvchilari (takrorlanmasin — bir o'quvchi
  // bir nechta kunlik xizmatga yozilgan bo'lishi mumkin).
  const students = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const r of roster.data ?? []) {
      // deno-lint-ignore no-explicit-any
      const st = (r as any).students;
      if (!st) continue;
      if (className && st.class_name !== className) continue;
      if (!map.has(st.id)) map.set(st.id, { id: st.id, name: st.full_name });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [roster.data, className]);

  // Bazadagi holatni tanlovga birlashtiramiz
  const effectiveMarked = useMemo(() => {
    const s = new Set(marked);
    for (const a of existing.data ?? []) s.add(a.student_id);
    return s;
  }, [marked, existing.data]);

  const checked = (checks.data ?? []).find((c) => c.class_name === className);

  function toggle(studentId: string) {
    if (!canMark) return;
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  }

  // --- Saqlash: yo'qliklar + kun tasdig'i ---------------------------
  const save = useMutation({
    mutationFn: async () => {
      const absentIds = [...effectiveMarked].filter((id) =>
        students.some((s) => s.id === id)
      );
      const existingIds = new Set(
        (existing.data ?? [])
          .filter((a) => students.some((s) => s.id === a.student_id))
          .map((a) => a.student_id),
      );

      const toAdd = absentIds.filter((id) => !existingIds.has(id));
      const toRemove = [...existingIds].filter((id) => !effectiveMarked.has(id));

      if (toAdd.length) {
        const { error } = await supabase.from('absences').insert(
          toAdd.map((student_id) => ({
            school_id: profile!.school_id,
            branch_id: activeBranch!,
            student_id,
            day,
            reason_id: reasonId || null,
            marked_by: profile!.id,
          })),
        );
        if (error) throw error;
      }

      if (toRemove.length) {
        // TZ 5.4.8 — yozuv jismonan o'chirilmaydi degan qoida
        // MOLIYAVIY yozuvlarga taalluqli. Yo'qlik belgisini olib
        // tashlash — xatoni tuzatish, u audit jurnaliga tushadi.
        const ids = (existing.data ?? [])
          .filter((a) => toRemove.includes(a.student_id))
          .map((a) => a.id);
        const { error } = await supabase.from('absences').delete().in('id', ids);
        if (error) throw error;
      }

      // Sinf ko'rib chiqilganini qayd etamiz (TZ 4.5.6).
      const { error: cErr } = await supabase.from('attendance_checks').upsert({
        school_id: profile!.school_id,
        branch_id: activeBranch!,
        day,
        class_name: className,
        absent_count: absentIds.length,
        marked_by: profile!.id,
        marked_at: new Date().toISOString(),
      });
      if (cErr) throw cErr;

      return absentIds.length;
    },
    onSuccess: () => {
      setMarked(new Set());
      qc.invalidateQueries({ queryKey: ['absences'] });
      qc.invalidateQueries({ queryKey: ['attendance-checks'] });
      qc.invalidateQueries({ queryKey: ['absence-gaps'] });
    },
  });

  if (!can('absences.mark')) {
    return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  }
  if (roster.isLoading) return <Loading />;
  if (roster.error) {
    return <ErrorState message={(roster.error as Error).message}
                       onRetry={() => roster.refetch()} />;
  }

  return (
    <>
      <PageHeader title={t('absences.title')} subtitle={t('absences.hint')} />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('common.date')}>
            <Input type="date" value={day} max={isoDate()}
                   onChange={(e) => { setDay(e.target.value); setMarked(new Set()); }} />
          </Field>
          <Field label={t('students.class')}>
            <Select value={className}
                    onChange={(e) => { setClassName(e.target.value); setMarked(new Set()); }}>
              <option value="">— {t('absences.markClass')} —</option>
              {classes.map((c) => {
                const done = (checks.data ?? []).some((x) => x.class_name === c);
                return (
                  <option key={c} value={c}>{done ? `✓ ${c}` : c}</option>
                );
              })}
            </Select>
          </Field>
          <Field label={t('absences.reason')}
                 hint="Belgilanganlarga qo'llaniladi">
            <Select value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="">—</option>
              {(reasons.data ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.deducts ? '' : ' (pul olinadi)'}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {classes.length === 0 && (
        <Notice tone="neutral">{t('absences.noDaily')}</Notice>
      )}

      {className && (
        <Card
          title={
            <span className="flex items-center gap-2">
              {className}
              {checked && (
                <Badge tone="ok">
                  {t('absences.dayConfirmed')} · {checked.absent_count}
                </Badge>
              )}
            </span>
          }
          action={
            <span className="text-[13px] text-[var(--text-muted)]">
              {date(day, lang)}
            </span>
          }
          padded={false}
        >
          {students.length === 0
            ? <EmptyState title={t('absences.noDaily')} hint="" />
            : (
              <>
                <ul className="divide-y divide-[var(--border-soft)]">
                  {students.map((s) => {
                    const absent = effectiveMarked.has(s.id);
                    return (
                      <li key={s.id}>
                        <button
                          onClick={() => toggle(s.id)}
                          disabled={!canMark}
                          // Yirik teginish maydoni — telefonda tez ishlash uchun.
                          className={`flex w-full items-center justify-between gap-3
                            px-4 py-3 text-left transition-colors
                            ${absent
                              ? 'bg-[var(--danger-bg)]'
                              : 'hover:bg-[var(--bg-subtle)]'}
                            disabled:cursor-not-allowed`}
                        >
                          <span className={`text-sm ${absent ? 'font-medium' : ''}`}>
                            {s.name}
                          </span>
                          <span
                            className={`shrink-0 rounded px-2 py-1 text-xs font-medium
                              ${absent
                                ? 'bg-[var(--danger)] text-white'
                                : 'bg-[var(--bg-inset)] text-[var(--text-faint)]'}`}
                          >
                            {absent ? t('absences.absent') : t('absences.present')}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
                  <span className="text-[13px] text-[var(--text-muted)]">
                    {t('absences.absent')}: <strong>{
                      [...effectiveMarked].filter((id) =>
                        students.some((s) => s.id === id)).length
                    }</strong> / {students.length}
                  </span>
                  <Button
                    variant="primary"
                    onClick={() => save.mutate()}
                    disabled={!canMark || save.isPending}
                  >
                    {save.isPending ? t('common.saving') : t('absences.saveDay')}
                  </Button>
                </div>

                {save.error && (
                  <div className="px-4 pb-3">
                    <Notice tone="danger">
                      {(save.error as Error).message.includes('Davr yopilgan')
                        ? t('absences.lockedPeriod')
                        : (save.error as Error).message}
                    </Notice>
                  </div>
                )}
              </>
            )}
        </Card>
      )}
    </>
  );
}
