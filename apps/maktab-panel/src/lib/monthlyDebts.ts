// =====================================================================
//  Oylar kesimida qarzdorlik — sinf → o'quvchi → oy.
//
//  Savol: "Noyabr uchun kim to'ladi, kim qisman, kim umuman
//  to'lamadi, va har kim qaysi oylar uchun qarzdor?"
//
//  To'lov hisoblanmaga bog'lab saqlanmaydi — o'quvchining umumiy
//  balansini kamaytiradi. Shuning uchun oyga taqsimlash FIFO bilan
//  qilinadi (TZ 4.8.3): tasdiqlangan to'lovlar avval ENG ESKI
//  hisoblanmani yopadi. `v_student_balances` va `report_debts` ham
//  xuddi shu qoidaga tayanadi — raqamlar bir-biriga mos keladi.
//
//  Hisob brauzerda: bazaga yangi funksiya kerak emas, panel bazadan
//  oldin chiqarilsa ham ishlaydi. Bitta maktabda bir necha ming qator
//  — 1000 talik sahifalab o'qiladi (PostgREST chegarasi).
// =====================================================================

import { supabase } from '@/lib/supabase';
import { currentPeriod } from '@/lib/format';

export type PayState = 'paid' | 'partial' | 'unpaid' | 'none';

export interface StudentMonth {
  student_id: string;
  full_name: string;
  payment_code: string | null;
  class_id: string | null;
  class_name: string | null;
  /** Tanlangan oy uchun hisoblangan. */
  charged: number;
  /** Tanlangan oy hisoblanmasiga tushgan to'lov (FIFO). */
  paid: number;
  remaining: number;
  state: PayState;
  /** Barcha oylar bo'yicha qarz. Manfiy — avans (ortiqcha to'lov). */
  totalDebt: number;
  /** To'liq yopilmagan oylar, eskisi birinchi. */
  unpaidPeriods: string[];
  /** Har bir yopilmagan oy va undan qolgan summa. */
  unpaidMonths: Array<{ period: string; owed: number }>;
}

export interface ClassMonth {
  key: string;
  class_id: string | null;
  name: string;
  grade: number | null;
  /** Filial nomi — "Barcha filiallar"da bir xil nomli sinflarni ajratish uchun. */
  branch: string | null;
  students: StudentMonth[];
  charged: number;
  paid: number;
  remaining: number;
  totalDebt: number;
  count: Record<PayState, number>;
}

// deno-lint-ignore no-explicit-any
type Builder = any;

/** Barcha qatorlarni 1000 talik bo'laklarda o'qiydi. */
async function fetchAll<T>(make: () => Builder): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await make().range(from, from + size - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < size) break;
  }
  return out;
}

interface InvRow { student_id: string; period: string; total: number }
interface PayRow { student_id: string; amount: number }
interface StuRow {
  id: string; full_name: string; payment_code: string | null;
  class_id: string | null; class_name: string | null; status: string;
}
interface ClsRow { id: string; name: string; grade_level: number | null; branches: { name: string } | null }

export async function loadMonthlyDebts(
  period: string,
  branchId: string | null,
): Promise<ClassMonth[]> {
  const br = (q: Builder) => (branchId ? q.eq('branch_id', branchId) : q);

  const [students, classes, invoices, payments] = await Promise.all([
    fetchAll<StuRow>(() => br(supabase.from('students')
      .select('id, full_name, payment_code, class_id, class_name, status')
      .is('deleted_at', null)).order('id')),
    fetchAll<ClsRow>(() => br(supabase.from('classes')
      .select('id, name, grade_level, branches(name)')
      .is('deleted_at', null)).order('id')),
    fetchAll<InvRow>(() => br(supabase.from('v_invoice_totals')
      .select('student_id, period, total')
      .neq('status', 'cancelled')).order('invoice_id')),
    fetchAll<PayRow>(() => br(supabase.from('payments')
      .select('student_id, amount')
      .eq('status', 'confirmed')).order('id')),
  ]);

  // --- O'quvchi bo'yicha guruhlash ------------------------------------
  const invBy = new Map<string, Map<string, number>>();
  for (const r of invoices) {
    const m = invBy.get(r.student_id) ?? new Map<string, number>();
    m.set(r.period, (m.get(r.period) ?? 0) + Number(r.total ?? 0));
    invBy.set(r.student_id, m);
  }
  const paidBy = new Map<string, number>();
  for (const p of payments) {
    paidBy.set(p.student_id, (paidBy.get(p.student_id) ?? 0) + Number(p.amount ?? 0));
  }

  const now = currentPeriod();
  const rows: StudentMonth[] = [];

  for (const s of students) {
    const months = invBy.get(s.id) ?? new Map<string, number>();
    const charged = months.get(period) ?? 0;
    //  Ketgan o'quvchi faqat shu oy hisoblanmasi bo'lsa ko'rinadi.
    if (s.status === 'expelled' && charged <= 0) continue;

    let pool = paidBy.get(s.id) ?? 0;
    let total = 0;
    let paidThis = 0;
    const unpaid: string[] = [];
    const unpaidM: Array<{ period: string; owed: number }> = [];
    for (const p of [...months.keys()].sort()) {
      const due = months.get(p)!;
      total += due;
      const alloc = Math.max(0, Math.min(pool, due));
      pool -= alloc;
      if (p === period) paidThis = alloc;
      if (due - alloc > 0.009 && p <= now) {
        unpaid.push(p);
        unpaidM.push({ period: p, owed: due - alloc });
      }
    }
    const totalDebt = total - (paidBy.get(s.id) ?? 0);
    const remaining = Math.max(0, charged - paidThis);
    const state: PayState = charged <= 0 ? 'none'
      : remaining <= 0.009 ? 'paid'
      : paidThis > 0 ? 'partial' : 'unpaid';

    rows.push({
      student_id: s.id,
      full_name: s.full_name,
      payment_code: s.payment_code,
      class_id: s.class_id,
      class_name: s.class_name,
      charged, paid: paidThis, remaining, state,
      totalDebt, unpaidPeriods: unpaid, unpaidMonths: unpaidM,
    });
  }

  // --- Sinf bo'yicha jamlash ------------------------------------------
  const clsById = new Map(classes.map((c) => [c.id, c]));
  const groups = new Map<string, ClassMonth>();
  for (const r of rows) {
    const cls = r.class_id ? clsById.get(r.class_id) : undefined;
    const key = r.class_id ?? `name:${r.class_name ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key, class_id: r.class_id,
        name: cls?.name ?? r.class_name ?? '—',
        grade: cls?.grade_level ?? null,
        branch: cls?.branches?.name ?? null,
        students: [], charged: 0, paid: 0, remaining: 0, totalDebt: 0,
        count: { paid: 0, partial: 0, unpaid: 0, none: 0 },
      };
      groups.set(key, g);
    }
    g.students.push(r);
    g.charged += r.charged;
    g.paid += r.paid;
    g.remaining += r.remaining;
    g.totalDebt += Math.max(0, r.totalDebt);
    g.count[r.state] += 1;
  }

  const ORDER: Record<PayState, number> = { unpaid: 0, partial: 1, paid: 2, none: 3 };
  const list = [...groups.values()];
  for (const g of list) {
    g.students.sort((a, b) => ORDER[a.state] - ORDER[b.state]
      || b.remaining - a.remaining
      || a.full_name.localeCompare(b.full_name));
  }
  return list.sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99)
    || a.name.localeCompare(b.name, undefined, { numeric: true })
    || (a.branch ?? '').localeCompare(b.branch ?? ''));
}
