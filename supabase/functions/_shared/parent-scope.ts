// =====================================================================
//  parent-scope.ts — OTA-ONA DOIRASI (TZ 5.4.15, 5.4.16)
//
//  ⚠️ BU FAYL BUTUN BOTNING XAVFSIZLIK CHEGARASI.
//
//  TZ 5.4.14 ni eslatib o'tamiz: "Edge Function `service_role` bilan
//  ishlaydi va RLS UNI TO'XTATMAYDI. Ota-onaning kirish huquqi kodda,
//  QO'LDA tekshiriladi."
//
//  Ya'ni bazadagi barcha himoya qatlami bu yerda ishlamaydi — himoya
//  faqat shu fayldagi mantiqqa bog'liq.
//
//  TZ 5.4.15: "Har bir so'rovda: Telegram ID bo'yicha ota-ona topiladi,
//  so'ng FAQAT UNGA BIRIKTIRILGAN o'quvchilar bo'yicha so'rov
//  bajariladi. O'quvchi identifikatori xabar yoki tugma ma'lumotidan
//  TO'G'RIDAN-TO'G'RI ISHONIB OLINMAYDI."
//
//  TZ 5.4.16: "Bu tekshiruv YAGONA yordamchi funksiyaga chiqariladi va
//  barcha stsenariylarda shu ishlatiladi."
//
//  Shuning uchun botda `students` jadvaliga to'g'ridan-to'g'ri so'rov
//  YOZILMAYDI. Har bir stsenariy `resolveParentScope()` dan boshlanadi
//  va faqat `scope.students` ichidagi o'quvchilar bilan ishlaydi.
// =====================================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ScopedStudent {
  id: string;
  school_id: string;
  branch_id: string;
  full_name: string;
  class_name: string | null;
  payment_code: string;
  status: string;
}

export interface ParentRecord {
  id: string;
  school_id: string;
  full_name: string;
  lang: string;
}

export class ParentScope {
  constructor(
    readonly parents: ParentRecord[],
    readonly students: ScopedStudent[],
  ) {}

  /** Ota-onaning tili. Bir nechta yozuv bo'lsa birinchisi olinadi. */
  get lang(): string {
    return this.parents[0]?.lang ?? 'uz';
  }

  get schoolIds(): string[] {
    return [...new Set(this.parents.map((p) => p.school_id))];
  }

  /**
   * Berilgan o'quvchi shu ota-onaga tegishlimi?
   *
   * Tugma ma'lumotidan (`callback_data`) kelgan identifikator FAQAT
   * shu tekshiruvdan o'tgandan keyin ishlatiladi. Ro'yxat bazadan
   * ota-onaning telegram_id si bo'yicha qurilgan, shuning uchun
   * boshqa oilaning o'quvchisi bu yerga tusha olmaydi.
   */
  owns(studentId: string): boolean {
    return this.students.some((s) => s.id === studentId);
  }

  /**
   * Tugma ma'lumotidagi identifikatorni XAVFSIZ o'quvchiga aylantiradi.
   * Tegishli bo'lmasa `null` — chaqiruvchi so'rovni rad etadi.
   */
  student(studentId: string | null | undefined): ScopedStudent | null {
    if (!studentId) return null;
    return this.students.find((s) => s.id === studentId) ?? null;
  }

  /** Bitta farzand bo'lsa uni qaytaradi (tanlash so'ralmaydi). */
  get onlyStudent(): ScopedStudent | null {
    return this.students.length === 1 ? this.students[0] : null;
  }
}

/**
 * Telegram ID bo'yicha ota-onani va UNGA BIRIKTIRILGAN o'quvchilarni
 * topadi. Bot har bir so'rovni shundan boshlaydi.
 *
 * Bir Telegram hisob bir nechta maktabda ota-ona bo'lishi mumkin
 * (20-migratsiya), shuning uchun barcha yozuvlar yig'iladi.
 *
 * @returns Ota-ona topilmasa `null` — bu "ro'yxatdan o'tmagan" degani.
 */
export async function resolveParentScope(
  db: SupabaseClient,
  telegramId: number,
): Promise<ParentScope | null> {
  // --- 1-qadam: Telegram ID bo'yicha ota-ona yozuvlari -------------
  const { data: parents, error: pErr } = await db
    .from('parents')
    .select('id, school_id, full_name, lang')
    .eq('telegram_id', telegramId)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (pErr || !parents?.length) return null;

  const parentIds = parents.map((p) => p.id);

  // --- 2-qadam: FAQAT shu ota-onalarga biriktirilgan o'quvchilar ---
  //  So'rov `student_parents` bog'lovchisidan boshlanadi — ya'ni
  //  o'quvchini tanlash mezoni ota-onaning o'zi, xabardagi ma'lumot emas.
  const { data: links, error: lErr } = await db
    .from('student_parents')
    .select(
      'student_id, students!inner(id, school_id, branch_id, full_name, class_name, payment_code, status, deleted_at)',
    )
    .in('parent_id', parentIds);

  if (lErr) return new ParentScope(parents, []);

  const seen = new Set<string>();
  const students: ScopedStudent[] = [];

  for (const row of links ?? []) {
    // deno-lint-ignore no-explicit-any
    const s = (row as any).students;
    if (!s || s.deleted_at) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    students.push({
      id: s.id,
      school_id: s.school_id,
      branch_id: s.branch_id,
      full_name: s.full_name,
      class_name: s.class_name,
      payment_code: s.payment_code,
      status: s.status,
    });
  }

  students.sort((a, b) => a.full_name.localeCompare(b.full_name));

  return new ParentScope(parents, students);
}

/**
 * Telefon raqami bo'yicha ota-onani topadi va Telegram hisobiga
 * bog'laydi (TZ 4.9.1 — "Ota-ona bot bilan telefon raqami orqali
 * bog'lanadi").
 *
 * Raqam faqat Telegram ning `contact` obyektidan olinadi — foydalanuvchi
 * qo'lda yozgan matndan EMAS. Aks holda birov boshqaning raqamini
 * yozib, uning farzandlari ma'lumotini ochib olishi mumkin edi.
 */
export async function linkParentByPhone(
  db: SupabaseClient,
  telegramId: number,
  rawPhone: string,
): Promise<number> {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length < 9) return 0;

  // Oxirgi 9 raqam bo'yicha solishtiramiz: bazada raqam turli
  // formatda saqlangan bo'lishi mumkin (+998.., 998.., 90..).
  const tail = digits.slice(-9);

  const { data: candidates } = await db
    .from('parents')
    .select('id, phone, school_id')
    .is('deleted_at', null)
    .eq('is_active', true)
    .like('phone', `%${tail}`);

  if (!candidates?.length) return 0;

  const matched = candidates.filter((p) =>
    p.phone.replace(/\D/g, '').slice(-9) === tail
  );
  if (!matched.length) return 0;

  const { error } = await db
    .from('parents')
    .update({ telegram_id: telegramId })
    .in('id', matched.map((p) => p.id));

  return error ? 0 : matched.length;
}

/**
 * Tarjima olish. Matnlar bazada (TZ 5.6.5 — yangi til qo'shish uchun
 * kodga o'zgartirish kerak emas).
 */
export async function translate(
  db: SupabaseClient,
  key: string,
  lang: string,
  schoolId: string | null = null,
  params: Record<string, string | number> = {},
): Promise<string> {
  const { data } = await db.rpc('bot_text', {
    p_key: key,
    p_lang: lang,
    p_school_id: schoolId,
  });

  let text = (data as string) ?? key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

/** Pul summasini o'qish oson ko'rinishga keltiradi: 1 450 000 */
export function money(value: number | string): string {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('ru-RU').replace(/ /g, ' ');
}
