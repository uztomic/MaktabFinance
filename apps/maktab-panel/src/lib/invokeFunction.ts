// =====================================================================
//  EDGE FUNCTION CHAQIRUVI — XATO SABABI BILAN
//
//  `supabase.functions.invoke` xato bo'lganda "Edge Function returned
//  a non-2xx status code" degan xabar beradi. Server esa sababni
//  AYTGAN bo'ladi — u javob tanasida turadi va shu yerda tashlab
//  yuborilardi.
//
//  Foydalanuvchi uchun farqi katta:
//
//    ilgari:  Edge Function returned a non-2xx status code
//    endi:    Ruxsat yo'q: foydalanuvchi qo'shish
//
//  Birinchisi bilan nima qilish kerakligi noma'lum, ikkinchisi esa
//  darhol tushunarli.
// =====================================================================

import { supabase } from '@/lib/supabase';

/** Server yuborgan sababni o'qishga urinadi. */
async function reason(err: unknown): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const ctx = (err as any)?.context;
  if (!ctx || typeof ctx.text !== 'function') return null;
  try {
    const raw = await ctx.text();
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      return j?.error ?? j?.message ?? raw.slice(0, 300);
    } catch {
      return raw.slice(0, 300);
    }
  } catch {
    //  Javob tanasi allaqachon o'qilgan bo'lishi mumkin.
    return null;
  }
}

/**
 *  Funksiyani chaqiradi va xatoni O'QILADIGAN xabar bilan tashlaydi.
 *
 *  Ikki xil xato bor va ikkalasi ham shu yerda hal qilinadi:
 *    · HTTP xatosi — sabab javob tanasida
 *    · funksiya 200 qaytarib, ichida `{ error }` yuborishi
 */
export async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const why = await reason(error);
    throw new Error(why ?? error.message);
  }
  // deno-lint-ignore no-explicit-any
  if ((data as any)?.error) throw new Error(String((data as any).error));

  return data as T;
}
