// =====================================================================
//  Supabase mijozi.
//
//  Brauzerda FAQAT publishable (ochiq) kalit turadi — bu normal.
//  Himoya RLS darajasida: bundle o'g'irlansa ham hech kim boshqa
//  maktabning ma'lumotini ko'ra olmaydi (TZ 5.5.7).
//
//  service_role kaliti bu yerga HECH QACHON kelmaydi.
// =====================================================================

import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "VITE_SUPABASE_URL va VITE_SUPABASE_PUBLISHABLE_KEY sozlanmagan. " +
    ".env.local faylini tekshiring.",
  );
}

export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'maktab-moliya-auth',
  },
});

/**
 * Telefon raqamni sintetik pochtaga aylantiradi.
 *
 * Navbatchi va o'qituvchi telefon bilan kiradi (foydalanuvchi tanlovi),
 * lekin Supabase Auth email talab qiladi. Shuning uchun raqam
 * `998901234567@maktab.local` ko'rinishiga keltiriladi. Bu manzilga
 * haqiqiy xat bormaydi — u faqat ichki identifikator.
 */
export function phoneToEmail(raw: string): string {
  return `${raw.replace(/\D/g, '')}@maktab.local`;
}

/** Kiritilgan matn telefon raqammi yoki emailmi? */
export function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return !value.includes('@') && digits.length >= 9;
}
