// =====================================================================
//  queue-sender — Telegram xabar navbatini qayta ishlaydi (TZ 4.9.1)
//
//  NEGA NAVBAT KERAK: Telegram sekundiga ~30 ta xabar cheklovini
//  qo'llaydi. 300 o'quvchiga hisoblanma xabarini to'g'ridan-to'g'ri
//  yuborish botning vaqtincha bloklanishiga olib keladi.
//
//  Shuning uchun barcha xabar `message_queue` ga yoziladi, bu funksiya
//  esa cron orqali har daqiqada ishga tushib, navbatni BO'LIB-BO'LIB
//  qayta ishlaydi.
//
//  TZ 4.9.1.5 — foydalanuvchi botni bloklagan bo'lsa (403) yoki chat
//  topilmasa (400) holat qayd etiladi va TAKROR URINILMAYDI.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { json, SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/http.ts';
import { tg } from '../_shared/telegram.ts';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Bir chaqiruvda nechta xabar. Telegram chegarasidan ancha past. */
const BATCH = 25;
/** Xabarlar orasidagi tanaffus (ms) — ~20 xabar/sekund. */
const GAP_MS = 50;
/** TZ 4.9.1.4 — urinishlar soni cheklanadi. */
const MAX_ATTEMPTS = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * TZ 5.4.20 — son va pul formatlari tanlangan tilga muvofiq
 * shakllantiriladi. O'zbek va rus tilida minglik ajratgich —
 * BO'SH JOY, vergul emas.
 *
 * SQL tomonidagi to_char() lc_numeric ga qarab vergul beradi,
 * shuning uchun formatlash shu yerda — taqdimot qatlamida —
 * yakunlanadi.
 *
 * Uzilmaydigan bo'shliq ishlatiladi, shunda Telegram raqamni satr
 * oxirida bo'lib tashlamaydi.
 */
const NBSP = ' ';

function formatValue(v: unknown): string {
  const s = String(v);

  // Guruhlangan son: "1,450,000" yoki "1 450 000"
  if (/^-?\d{1,3}([,\s]\d{3})+$/.test(s)) {
    return s.replace(/[,\s]/g, NBSP);
  }
  // Xom son: "1450000" → "1 450 000"
  if (/^-?\d{4,}$/.test(s)) {
    return Number(s).toLocaleString('ru-RU').replace(/\s/g, NBSP);
  }
  return s;
}

Deno.serve(async () => {
  const started = Date.now();

  // --- Yuborishga tayyor xabarlar -----------------------------------
  const { data: queue, error } = await db
    .from('message_queue')
    .select('id, school_id, chat_id, lang, template_key, params, attempts')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("navbatni o'qib bo'lmadi", error);
    return json({ error: error.message }, 500);
  }
  if (!queue?.length) {
    return json({ processed: 0, sent: 0 });
  }

  let sent = 0, failed = 0, blocked = 0;

  for (const m of queue) {
    // --- Matnni bazadan olamiz (TZ 5.6.5) --------------------------
    const { data: template } = await db.rpc('bot_text', {
      p_key: m.template_key,
      p_lang: m.lang,
      p_school_id: m.school_id,
    });

    let body = (template as string) ?? m.template_key;
    for (const [k, v] of Object.entries(m.params ?? {})) {
      body = body.replaceAll(`{${k}}`, formatValue(v));
    }

    const res = await tg('sendMessage', {
      chat_id: m.chat_id,
      text: body,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    if (res.ok) {
      await db.from('message_queue').update({
        status: 'sent',
        body,
        sent_at: new Date().toISOString(),
        attempts: m.attempts + 1,
      }).eq('id', m.id);
      sent++;
    } else {
      const code = res.error_code ?? 0;
      const desc = res.description ?? "noma'lum xato";

      // TZ 4.9.1.5 — bot bloklangan (403) yoki chat topilmadi (400):
      // qayta urinishning ma'nosi yo'q.
      const permanent = code === 403 || code === 400;
      const attempts = m.attempts + 1;

      await db.from('message_queue').update({
        status: permanent
          ? 'blocked'
          : (attempts >= MAX_ATTEMPTS ? 'failed' : 'pending'),
        attempts,
        last_error: `${code}: ${desc}`,
        body,
        // Vaqtinchalik xato — keyingi urinish kechiktiriladi
        // (2, 4, 8, 16 daqiqa).
        ...(permanent ? {} : {
          scheduled_at: new Date(
            Date.now() + Math.min(60, 2 ** attempts) * 60_000,
          ).toISOString(),
        }),
      }).eq('id', m.id);

      if (permanent) blocked++;
      else failed++;
    }

    await sleep(GAP_MS);
  }

  return json({
    processed: queue.length,
    sent,
    failed,
    blocked,
    ms: Date.now() - started,
  });
});
