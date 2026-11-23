// =====================================================================
//  O'quv markazi uchun umumiy yordamchilar.
//
//  Guruh narxi `services`/`service_prices` da yashaydi (moliya
//  dvigateli shu orqali ishlaydi), shuning uchun panel narxni ham shu
//  yerdan oladi — ikkinchi manba yo'q.
// =====================================================================

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isoDate } from '@/lib/format';

export type GroupStatus = 'forming' | 'active' | 'finished';
export type MemberStatus = 'trial' | 'active' | 'frozen' | 'left';
export type PayKind = 'percent' | 'per_lesson' | 'per_student';
export type MarkStatus = 'present' | 'absent' | 'late' | 'excused';

/** ISO hafta kunlari: 1 = dushanba ... 7 = yakshanba. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** "14:00:00" → "14:00". */
export function hhmm(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : '';
}

/** Daqiqalar: "14:30" → 870. */
export function minutes(t: string | null | undefined): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Sanadan ISO hafta kuni (1..7). */
export function isoDow(d: string | Date): number {
  const x = typeof d === 'string' ? new Date(`${d}T00:00:00`) : d;
  return ((x.getDay() + 6) % 7) + 1;
}

export function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return isoDate(x);
}

export function monthStart(d: string = isoDate()): string {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: string = isoDate()): string {
  const x = new Date(`${monthStart(d)}T00:00:00`);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  return isoDate(x);
}

/** Kurs rangi bo'lmasa — guruh nomidan barqaror rang. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#db2777', '#65a30d'];
export function colorFor(key: string, explicit?: string | null): string {
  if (explicit) return explicit;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export interface GroupRow {
  id: string;
  branch_id: string;
  name: string;
  course_id: string | null;
  teacher_id: string | null;
  room_id: string | null;
  service_id: string | null;
  days: number[];
  start_time: string | null;
  end_time: string | null;
  starts_on: string;
  ends_on: string | null;
  capacity: number | null;
  status: string;
  teacher_pay_kind: string | null;
  teacher_pay_value: number | null;
  is_online: boolean;
  note: string | null;
  courses: { name: string; level: string | null; color: string | null } | null;
  teachers: { full_name: string } | null;
  rooms: { name: string } | null;
}

export const GROUP_SELECT =
  'id, branch_id, name, course_id, teacher_id, room_id, service_id, days, start_time, end_time, ' +
  'starts_on, ends_on, capacity, status, teacher_pay_kind, teacher_pay_value, is_online, note, ' +
  'courses(name, level, color), teachers(full_name), rooms(name)';

/** Filialdagi guruhlar (o'chirilmaganlari). */
export function useGroups(branchId: string | null) {
  return useQuery({
    queryKey: ['lc-groups', branchId],
    queryFn: async () => {
      let q = supabase.from('study_groups').select(GROUP_SELECT)
        .is('deleted_at', null).order('name');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as GroupRow[];
    },
  });
}

/** Guruh xizmatlarining bugungi narxi: service_id → narx. */
export function usePrices(serviceIds: string[]) {
  const key = [...serviceIds].sort().join(',');
  return useQuery({
    queryKey: ['lc-prices', key],
    enabled: serviceIds.length > 0,
    queryFn: async () => {
      const today = isoDate();
      const { data, error } = await supabase
        .from('service_prices')
        .select('service_id, price, valid_from, valid_to')
        .in('service_id', serviceIds)
        .lte('valid_from', today)
        .order('valid_from', { ascending: false });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const p of data ?? []) {
        if (map.has(p.service_id)) continue;
        if (p.valid_to && p.valid_to < today) continue;
        map.set(p.service_id, Number(p.price));
      }
      return map;
    },
  });
}

/** Guruhdagi band o'rinlar: group_id → { active, trial, frozen }. */
export function useMemberCounts(branchId: string | null) {
  return useQuery({
    queryKey: ['lc-member-counts', branchId],
    queryFn: async () => {
      let q = supabase.from('group_members').select('group_id, status')
        .neq('status', 'left');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      const map = new Map<string, { active: number; trial: number; frozen: number }>();
      for (const m of data ?? []) {
        const c = map.get(m.group_id) ?? { active: 0, trial: 0, frozen: 0 };
        if (m.status === 'active') c.active++;
        else if (m.status === 'trial') c.trial++;
        else if (m.status === 'frozen') c.frozen++;
        map.set(m.group_id, c);
      }
      return map;
    },
  });
}

export function useCourses() {
  return useQuery({
    queryKey: ['lc-courses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('courses')
        .select('id, name, level, default_price, lesson_minutes, duration_months, color, is_active, note')
        .is('deleted_at', null).order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRooms(branchId: string | null) {
  return useQuery({
    queryKey: ['lc-rooms', branchId],
    queryFn: async () => {
      let q = supabase.from('rooms')
        .select('id, branch_id, name, capacity, is_active, note')
        .is('deleted_at', null).order('name');
      if (branchId) q = q.eq('branch_id', branchId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTeachersList() {
  return useQuery({
    queryKey: ['lc-teachers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('teachers')
        .select('id, full_name')
        .eq('is_active', true).is('deleted_at', null).order('full_name');
      if (error) throw error;
      return data ?? [];
    },
  });
}
