// =====================================================================
//  Kurslar va xonalar — o'quv markazining ma'lumotnomalari.
// =====================================================================

import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useI18n, useT } from '@/i18n';
import { money } from '@/lib/format';
import { colorFor, useCourses, useGroups, useRooms } from '@/lib/lc';
import {
  Badge, Button, Card, EmptyState, Field, Input, Loading, Modal, MoneyInput, Notice,
  PageHeader, Select, Table, Td, Th, Tr,
} from '@/ui';
import { useToast } from '@/ui/Feedback';

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];

export default function Courses() {
  const t = useT();
  const { lang } = useI18n();
  const { branchId, branches, can, mayWrite } = useAuth();
  const courses = useCourses();
  const rooms = useRooms(branchId);
  const groups = useGroups(branchId);

  // deno-lint-ignore no-explicit-any
  const [course, setCourse] = useState<any>(null);
  // deno-lint-ignore no-explicit-any
  const [room, setRoom] = useState<any>(null);

  if (!can('students.manage')) return <Notice tone="danger">{t('common.noAccess')}</Notice>;
  const canEdit = mayWrite('students.manage');

  const groupsPer = (key: 'course_id' | 'room_id', id: string) =>
    (groups.data ?? []).filter((g) => g[key] === id && g.status !== 'finished').length;

  return (
    <>
      <PageHeader title={t('lc.coursesRooms')} />

      <div className="grid gap-4 xl:grid-cols-[3fr_2fr]">
        <Card title={t('lc.courses')} padded={false}
          action={canEdit && <Button size="sm" variant="primary" onClick={() => setCourse({})}>{t('lc.c.add')}</Button>}>
          {courses.isLoading ? <Loading /> : (courses.data ?? []).length === 0 ? (
            <EmptyState title={t('lc.c.emptyTitle')} hint={t('lc.c.emptyHint')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  <Th>{t('lc.c.level')}</Th>
                  <Th align="right">{t('lc.c.defaultPrice')}</Th>
                  <Th align="right">{t('lc.c.minutes')}</Th>
                  <Th align="right">{t('lc.groups')}</Th>
                </tr>
              </thead>
              <tbody>
                {courses.data!.map((c) => (
                  <Tr key={c.id} onClick={canEdit ? () => setCourse(c) : undefined}>
                    <Td>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                            style={{ background: colorFor(c.id, c.color) }} />
                      <span className="font-medium">{c.name}</span>
                      {!c.is_active && <span className="ml-2"><Badge>{t('lc.c.archived')}</Badge></span>}
                    </Td>
                    <Td>{c.level ?? '—'}</Td>
                    <Td align="right" mono>{c.default_price != null ? money(c.default_price, lang) : '—'}</Td>
                    <Td align="right" mono>{c.lesson_minutes ?? '—'}</Td>
                    <Td align="right" mono>{groupsPer('course_id', c.id)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={t('lc.rooms')} padded={false}
          action={canEdit && <Button size="sm" variant="primary" onClick={() => setRoom({})}>{t('lc.r.add')}</Button>}>
          {rooms.isLoading ? <Loading /> : (rooms.data ?? []).length === 0 ? (
            <EmptyState title={t('lc.r.emptyTitle')} hint={t('lc.r.emptyHint')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('common.name')}</Th>
                  {branches.length > 1 && <Th>{t('common.branch')}</Th>}
                  <Th align="right">{t('lc.capacity')}</Th>
                  <Th align="right">{t('lc.groups')}</Th>
                </tr>
              </thead>
              <tbody>
                {rooms.data!.map((r) => (
                  <Tr key={r.id} onClick={canEdit ? () => setRoom(r) : undefined}>
                    <Td className="font-medium">
                      {r.name}
                      {!r.is_active && <span className="ml-2"><Badge>{t('lc.c.archived')}</Badge></span>}
                    </Td>
                    {branches.length > 1 && <Td>{branches.find((b) => b.id === r.branch_id)?.name}</Td>}
                    <Td align="right" mono>{r.capacity ?? '—'}</Td>
                    <Td align="right" mono>{groupsPer('room_id', r.id)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <CourseModal course={course} onClose={() => setCourse(null)} />
      <RoomModal room={room} onClose={() => setRoom(null)} />
    </>
  );
}

// deno-lint-ignore no-explicit-any
function CourseModal({ course, onClose }: { course: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile } = useAuth();
  const [f, setF] = useState({ name: '', level: '', price: '', minutes: '', months: '', color: '', is_active: true, note: '' });

  useEffect(() => {
    if (!course) return;
    setF({
      name: course.name ?? '', level: course.level ?? '',
      price: course.default_price != null ? String(Math.round(Number(course.default_price))) : '',
      minutes: course.lesson_minutes ? String(course.lesson_minutes) : '',
      months: course.duration_months ? String(course.duration_months) : '',
      color: course.color ?? '', is_active: course.is_active ?? true, note: course.note ?? '',
    });
  }, [course]);

  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault();
      const payload = {
        name: f.name.trim(), level: f.level.trim() || null,
        default_price: f.price ? Number(f.price) : null,
        lesson_minutes: f.minutes ? Number(f.minutes) : null,
        duration_months: f.months ? Number(f.months) : null,
        color: f.color || null, is_active: f.is_active, note: f.note.trim() || null,
      };
      const { error } = course?.id
        ? await supabase.from('courses').update(payload).eq('id', course.id)
        : await supabase.from('courses').insert({ school_id: profile!.school_id, ...payload });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('ux.saved')); qc.invalidateQueries({ queryKey: ['lc-courses'] }); qc.invalidateQueries({ queryKey: ['lc-groups'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal open={!!course} onClose={onClose} title={course?.id ? t('lc.c.edit') : t('lc.c.add')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="course-form" disabled={!f.name.trim() || save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="course-form" onSubmit={(e) => save.mutate(e)} className="grid gap-3 sm:grid-cols-2">
        <Field label={t('common.name')} required>
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t('lc.c.namePh')} />
        </Field>
        <Field label={t('lc.c.level')}>
          <Input value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} placeholder="Beginner, A1, 1-bosqich" />
        </Field>
        <Field label={t('lc.c.defaultPrice')} hint={t('lc.c.priceHint')}>
          <MoneyInput value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
        </Field>
        <Field label={t('lc.c.minutes')}>
          <Input type="number" min={15} max={480} value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} />
        </Field>
        <Field label={t('lc.c.months')}>
          <Input type="number" min={1} max={60} value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} />
        </Field>
        <Field label={t('lc.c.color')}>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })}
                className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-[var(--bg)] ${f.color === c ? 'ring-2 ring-brand-600' : ''}`}
                style={{ background: c }} aria-label={c} />
            ))}
          </div>
        </Field>
        {course?.id && (
          <Field label={t('common.status')}>
            <Select value={f.is_active ? '1' : '0'} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}>
              <option value="1">{t('lc.c.active')}</option>
              <option value="0">{t('lc.c.archived')}</option>
            </Select>
          </Field>
        )}
        <Field label={t('common.note')}>
          <Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}

// deno-lint-ignore no-explicit-any
function RoomModal({ room, onClose }: { room: any; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const toast = useToast();
  const { profile, branches, branchId } = useAuth();
  const [f, setF] = useState({ name: '', capacity: '', branch_id: '', is_active: true });

  useEffect(() => {
    if (!room) return;
    setF({
      name: room.name ?? '', capacity: room.capacity ? String(room.capacity) : '',
      branch_id: room.branch_id ?? branchId ?? branches[0]?.id ?? '', is_active: room.is_active ?? true,
    });
  }, [room, branchId, branches]);

  const save = useMutation({
    mutationFn: async (e: FormEvent) => {
      e.preventDefault();
      const payload = { name: f.name.trim(), capacity: f.capacity ? Number(f.capacity) : null, is_active: f.is_active };
      const { error } = room?.id
        ? await supabase.from('rooms').update(payload).eq('id', room.id)
        : await supabase.from('rooms').insert({ school_id: profile!.school_id, branch_id: f.branch_id, ...payload });
      if (error) throw error;
    },
    onSuccess: () => { toast.ok(t('ux.saved')); qc.invalidateQueries({ queryKey: ['lc-rooms'] }); onClose(); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Modal open={!!room} onClose={onClose} title={room?.id ? t('lc.r.edit') : t('lc.r.add')}
      footer={<>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" type="submit" form="room-form" disabled={!f.name.trim() || save.isPending}>{t('common.save')}</Button>
      </>}>
      <form id="room-form" onSubmit={(e) => save.mutate(e)} className="grid gap-3 sm:grid-cols-2">
        {!room?.id && branches.length > 1 && (
          <Field label={t('common.branch')}>
            <Select value={f.branch_id} onChange={(e) => setF({ ...f, branch_id: e.target.value })}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('common.name')} required>
          <Input autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="101-xona" />
        </Field>
        <Field label={t('lc.capacity')}>
          <Input type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
        </Field>
        {room?.id && (
          <Field label={t('common.status')}>
            <Select value={f.is_active ? '1' : '0'} onChange={(e) => setF({ ...f, is_active: e.target.value === '1' })}>
              <option value="1">{t('lc.c.active')}</option>
              <option value="0">{t('lc.c.archived')}</option>
            </Select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
