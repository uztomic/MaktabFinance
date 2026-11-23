// =====================================================================
//  Guruh yaratish / tahrirlash.
//
//  Saqlashdan OLDIN jadval to'qnashuvi tekshiriladi: shu xona yoki
//  shu o'qituvchi o'sha kun va vaqtda boshqa guruhda bandmi. Bu
//  taqiq emas (ba'zan ataylab qilinadi), ogohlantirish.
// =====================================================================

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useT } from '@/i18n';
import { isoDate } from '@/lib/format';
import {
  type GroupRow, hhmm, useCourses, useRooms, useTeachersList, WEEKDAYS,
} from '@/lib/lc';
import { Button, Field, Input, Modal, MoneyInput, Notice, Select } from '@/ui';
import { useToast } from '@/ui/Feedback';

interface Props {
  open: boolean;
  group: GroupRow | null;
  currentPrice?: number | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}

export function GroupForm({ open, group, currentPrice, onClose, onSaved }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile, branches, branchId } = useAuth();

  const [f, setF] = useState(() => init(group, currentPrice, branchId ?? branches[0]?.id ?? ''));
  useEffect(() => {
    if (open) setF(init(group, currentPrice, branchId ?? branches[0]?.id ?? ''));
  }, [open, group, currentPrice, branchId, branches]);

  const courses = useCourses();
  const rooms = useRooms(f.branch_id || null);
  const teachers = useTeachersList();

  // Kurs tanlanganda: narx va davomiylik taklif qilinadi.
  const pickCourse = (id: string) => {
    const c = (courses.data ?? []).find((x) => x.id === id);
    setF((p) => ({
      ...p,
      course_id: id,
      price: p.price || (c?.default_price ? String(Math.round(Number(c.default_price))) : ''),
      end_time: p.end_time || (p.start_time && c?.lesson_minutes
        ? addMinutes(p.start_time, c.lesson_minutes) : p.end_time),
      name: p.name || (c ? `${c.name}${c.level ? ` ${c.level}` : ''}` : p.name),
    }));
  };

  const conflicts = useQuery({
    queryKey: ['lc-conflicts', f.branch_id, f.days.join(','), f.start_time, f.end_time,
      f.teacher_id, f.room_id, group?.id],
    enabled: open && f.days.length > 0 && !!f.start_time && !!f.end_time
      && f.end_time > f.start_time && (!!f.teacher_id || !!f.room_id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('group_conflicts', {
        p_branch_id: f.branch_id,
        p_days: f.days,
        p_start: f.start_time,
        p_end: f.end_time,
        p_teacher_id: f.teacher_id || null,
        p_room_id: f.room_id || null,
        p_except_id: group?.id ?? undefined,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: f.name.trim(),
        course_id: f.course_id || null,
        teacher_id: f.teacher_id || null,
        room_id: f.room_id || null,
        days: [...f.days].sort(),
        start_time: f.start_time || null,
        end_time: f.end_time || null,
        starts_on: f.starts_on,
        ends_on: f.ends_on || null,
        capacity: f.capacity ? Number(f.capacity) : null,
        status: f.status,
        teacher_pay_kind: f.pay_kind || null,
        teacher_pay_value: f.pay_kind && f.pay_value ? Number(f.pay_value) : null,
        is_online: f.is_online,
        note: f.note.trim() || null,
      };

      let id = group?.id;
      if (id) {
        const { error } = await supabase.from('study_groups').update(payload).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('study_groups').insert({
          school_id: profile!.school_id,
          branch_id: f.branch_id,
          ...payload,
        }).select('id').single();
        if (error) throw error;
        id = data.id;
      }

      // Narx o'zgargan bo'lsa — tarix bilan yoziladi (oy boshidan).
      const price = Number(f.price || 0);
      if (f.price !== '' && price !== (currentPrice ?? null)) {
        const { error } = await supabase.rpc('set_group_price', {
          p_group_id: id!,
          p_price: price,
          p_valid_from: group ? isoDate() : f.starts_on,
        });
        if (error) throw error;
      }

      // Yangi guruh: kelasi 2 oyning darslari darhol yaratiladi.
      if (!group && payload.days.length > 0) {
        const to = new Date();
        to.setMonth(to.getMonth() + 2);
        await supabase.rpc('generate_group_sessions', {
          p_group_id: id!,
          p_from: f.starts_on,
          p_to: isoDate(to),
        });
      }
      return id!;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['lc-groups'] });
      qc.invalidateQueries({ queryKey: ['lc-group', id] });
      qc.invalidateQueries({ queryKey: ['lc-prices'] });
      qc.invalidateQueries({ queryKey: ['lc-sessions'] });
      toast.ok(t('ux.saved'));
      onSaved?.(id);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const timeInvalid = !!f.start_time && !!f.end_time && f.end_time <= f.start_time;
  const roomCap = useMemo(
    () => (rooms.data ?? []).find((r) => r.id === f.room_id)?.capacity ?? null,
    [rooms.data, f.room_id],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim() || timeInvalid) return;
    save.mutate();
  };

  const toggleDay = (d: number) =>
    setF((p) => ({
      ...p,
      days: p.days.includes(d) ? p.days.filter((x) => x !== d) : [...p.days, d],
    }));

  return (
    <Modal
      open={open}
      wide
      title={group ? t('lc.group.edit') : t('lc.group.add')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" type="submit" form="group-form"
                  disabled={save.isPending || !f.name.trim() || timeInvalid}>
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {!group && branches.length > 1 && (
          <Field label={t('common.branch')} required>
            <Select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value, room_id: '' })}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}

        <Field label={t('lc.course')}>
          <Select value={f.course_id} onChange={(e) => pickCourse(e.target.value)}>
            <option value="">—</option>
            {(courses.data ?? []).filter((c) => c.is_active || c.id === f.course_id).map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.level ? ` · ${c.level}` : ''}</option>
            ))}
          </Select>
        </Field>

        <Field label={t('lc.group.name')} required hint={t('lc.group.nameHint')}>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>

        <Field label={t('lc.teacher')}>
          <Select value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}>
            <option value="">—</option>
            {(teachers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
          </Select>
        </Field>

        <Field label={t('lc.room')}>
          <Select value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value })}>
            <option value="">{f.is_online ? t('lc.online') : '—'}</option>
            {(rooms.data ?? []).filter((r) => r.is_active || r.id === f.room_id).map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` (${r.capacity})` : ''}</option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-[13px] font-medium text-[var(--text-muted)]">
            {t('lc.days')}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => {
              const on = f.days.includes(d);
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)}
                  className={`h-9 min-w-11 rounded-lg border px-3 text-[13px] font-medium transition-colors
                    ${on ? 'border-brand-700 bg-brand-900 text-white'
                      : 'hover:bg-[var(--bg-inset)]'}`}
                  aria-pressed={on}>
                  {t(`lc.dowShort.${d}`)}
                </button>
              );
            })}
            <span className="mx-1 self-center text-[var(--text-faint)]">·</span>
            <button type="button" onClick={() => setF({ ...f, days: [1, 3, 5] })}
              className="h-9 rounded-lg px-2.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-inset)]">
              {t('lc.preset.odd')}
            </button>
            <button type="button" onClick={() => setF({ ...f, days: [2, 4, 6] })}
              className="h-9 rounded-lg px-2.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--bg-inset)]">
              {t('lc.preset.even')}
            </button>
          </div>
        </div>

        <Field label={t('lc.startTime')}>
          <Input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} />
        </Field>
        <Field label={t('lc.endTime')} error={timeInvalid ? t('lc.timeInvalid') : undefined}>
          <Input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} />
        </Field>

        {(conflicts.data?.length ?? 0) > 0 && (
          <div className="sm:col-span-2">
            <Notice tone="warn">
              <div className="font-medium">{t('lc.conflict.title')}</div>
              <ul className="mt-1 list-disc pl-5">
                {conflicts.data!.map((c) => (
                  <li key={c.group_id + c.kind}>
                    {t(c.kind === 'room' ? 'lc.conflict.room' : 'lc.conflict.teacher', {
                      group: c.group_name,
                      time: `${hhmm(c.start_time)}–${hhmm(c.end_time)}`,
                    })}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        )}

        <Field label={t('lc.price')} hint={group ? t('lc.priceHintEdit') : t('lc.priceHint')}>
          <MoneyInput value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>

        <Field label={t('lc.capacity')}
               hint={roomCap ? t('lc.roomCap', { n: roomCap }) : undefined}>
          <Input type="number" min={1} value={f.capacity}
                 onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        </Field>

        <Field label={t('lc.startsOn')} required>
          <Input type="date" value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} required />
        </Field>
        <Field label={t('lc.endsOn')}>
          <Input type="date" value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} />
        </Field>

        <Field label={t('lc.status')}>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {['forming', 'active', 'finished'].map((s) => (
              <option key={s} value={s}>{t(`lc.gstatus.${s}`)}</option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
          <input type="checkbox" checked={f.is_online}
                 onChange={(e) => setF({ ...f, is_online: e.target.checked })} />
          {t('lc.online')}
        </label>

        <div className="rounded-lg border border-dashed p-3 sm:col-span-2">
          <div className="mb-2 text-[13px] font-medium">{t('lc.pay.title')}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field hint={t('lc.pay.hint')}>
              <Select value={f.pay_kind} onChange={(e) => setF({ ...f, pay_kind: e.target.value })}>
                <option value="">{t('lc.pay.none')}</option>
                <option value="percent">{t('lc.pay.percent')}</option>
                <option value="per_lesson">{t('lc.pay.per_lesson')}</option>
                <option value="per_student">{t('lc.pay.per_student')}</option>
              </Select>
            </Field>
            {f.pay_kind === 'percent' && (
              <Field>
                <span className="relative block">
                  <Input type="number" min={0} max={100} step="0.5" value={f.pay_value}
                         onChange={(e) => setF({ ...f, pay_value: e.target.value })} className="pr-8" />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-[var(--text-faint)]">%</span>
                </span>
              </Field>
            )}
            {(f.pay_kind === 'per_lesson' || f.pay_kind === 'per_student') && (
              <Field>
                <MoneyInput value={f.pay_value} onChange={(e) => setF({ ...f, pay_value: e.target.value })} />
              </Field>
            )}
          </div>
        </div>

        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

function addMinutes(time: string, m: number): string {
  const [h, mm] = time.split(':').map(Number);
  const total = h * 60 + mm + m;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function init(g: GroupRow | null, price: number | null | undefined, branch: string) {
  return {
    branch_id: g?.branch_id ?? branch,
    name: g?.name ?? '',
    course_id: g?.course_id ?? '',
    teacher_id: g?.teacher_id ?? '',
    room_id: g?.room_id ?? '',
    days: (g?.days ?? []) as number[],
    start_time: hhmm(g?.start_time),
    end_time: hhmm(g?.end_time),
    starts_on: g?.starts_on ?? isoDate(),
    ends_on: g?.ends_on ?? '',
    capacity: g?.capacity ? String(g.capacity) : '',
    status: g?.status ?? 'active',
    pay_kind: g?.teacher_pay_kind ?? '',
    pay_value: g?.teacher_pay_value != null ? String(Math.round(Number(g.teacher_pay_value) * 100) / 100) : '',
    is_online: g?.is_online ?? false,
    note: g?.note ?? '',
    price: price != null ? String(Math.round(price)) : '',
  };
}
