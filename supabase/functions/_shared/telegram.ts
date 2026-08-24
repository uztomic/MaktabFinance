// =====================================================================
//  telegram.ts — Telegram Bot API bilan ishlash.
//
//  TOKEN KODDA EMAS: u Edge Function maxfiy kaliti sifatida saqlanadi
//  (npx supabase secrets set TELEGRAM_BOT_TOKEN=...).
// =====================================================================

const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const API = `https://api.telegram.org/bot${TOKEN}`;

export interface TgResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/** Telegram API ga so'rov. Xato tashlamaydi — natijani qaytaradi. */
export async function tg<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
): Promise<TgResult<T>> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json() as TgResult<T>;
  } catch (err) {
    return { ok: false, description: String(err) };
  }
}

export function sendMessage(
  chatId: number,
  text: string,
  extra: Record<string, unknown> = {},
) {
  return tg('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...extra,
  });
}

export function answerCallback(id: string, text?: string) {
  return tg('answerCallbackQuery', { callback_query_id: id, text });
}

/** Klaviatura tugmalari — ustunlar soni bilan. */
export function keyboard(rows: Array<Array<{ text: string; data: string }>>) {
  return {
    inline_keyboard: rows.map((r) =>
      r.map((b) => ({ text: b.text, callback_data: b.data }))
    ),
  };
}

/**
 * Telegram fayl yo'lini oladi va faylni yuklab beradi.
 * TZ 4.7.4.1 — chek rasmi siqilgan holda saqlanadi; Telegram ning
 * `photo[]` massividagi eng katta tomoni ~1600 px ga yaqin o'lchamni
 * tanlash ko'p hollarda qayta kodlashni ham keraksiz qiladi.
 */
export async function downloadFile(fileId: string): Promise<
  { bytes: Uint8Array; path: string } | null
> {
  const info = await tg<{ file_path: string }>('getFile', { file_id: fileId });
  if (!info.ok || !info.result?.file_path) return null;

  const res = await fetch(
    `https://api.telegram.org/file/bot${TOKEN}/${info.result.file_path}`,
  );
  if (!res.ok) return null;

  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    path: info.result.file_path,
  };
}

/** TZ 4.7.4.1 — 1600 px ga eng yaqin (lekin oshmagan) o'lchamni tanlaydi. */
export function pickPhotoSize(
  photos: Array<{ file_id: string; width: number; height: number }>,
): { file_id: string; width: number; height: number } | null {
  if (!photos?.length) return null;
  const TARGET = 1600;
  const sorted = [...photos].sort((a, b) =>
    Math.max(a.width, a.height) - Math.max(b.width, b.height)
  );
  const fitting = sorted.filter((p) => Math.max(p.width, p.height) <= TARGET);
  return fitting.length ? fitting[fitting.length - 1] : sorted[0];
}
