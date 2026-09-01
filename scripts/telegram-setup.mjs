// =====================================================================
//  TELEGRAM BOTNI SOZLASH
//
//  Uchta ishni bajaradi:
//    1. Webhook manzilini ro'yxatdan o'tkazadi (maxfiy token bilan)
//    2. Buyruqlar ro'yxatini yozadi — Telegram da "Menu" tugmasi
//       paydo bo'ladi va odam nima yozish mumkinligini ko'radi
//    3. Holatni tekshiradi: oxirgi xato bo'lganmi, navbatda nechta
//       yangilanish turibdi
//
//  TOKEN KODGA YOZILMAYDI. U `.env.local` dan o'qiladi (bu fayl git
//  ga kirmaydi) yoki muhit o'zgaruvchisidan olinadi.
//
//    node scripts/telegram-setup.mjs          — holatni ko'rsatadi
//    node scripts/telegram-setup.mjs --apply  — sozlaydi
// =====================================================================

import { readFileSync } from 'node:fs';

function env() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const i = line.indexOf('=');
      if (i < 1 || line.trimStart().startsWith('#')) continue;
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
    }
  } catch { /* fayl yo'q — muhit o'zgaruvchilari ishlatiladi */ }
  return out;
}

const E = env();
const TOKEN = E.TELEGRAM_BOT_TOKEN;
const SECRET = E.TELEGRAM_WEBHOOK_SECRET;
const URL = E.VITE_SUPABASE_URL;
const APPLY = process.argv.includes('--apply');

if (!TOKEN) {
  console.error(`TELEGRAM_BOT_TOKEN topilmadi.

Uni .env.local ga qo'shing (bu fayl git ga kirmaydi):

    TELEGRAM_BOT_TOKEN=123456:AA...
    TELEGRAM_WEBHOOK_SECRET=<uzun tasodifiy matn>

Xuddi shu ikkitasi Edge Function sirlarida ham bo'lishi kerak:

    npx supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=...
`);
  process.exit(1);
}

const api = async (method, body) => {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return r.json();
};

// --- Bot kimligi --------------------------------------------------------
const me = await api('getMe');
if (!me.ok) {
  console.error('Token yaroqsiz:', me.description);
  process.exit(1);
}
console.log(`Bot: @${me.result.username} (${me.result.first_name})`);

// --- Holat ---------------------------------------------------------------
const info = await api('getWebhookInfo');
const w = info.result ?? {};
console.log(`\nWebhook: ${w.url || '(sozlanmagan)'}`);
console.log(`Navbatda: ${w.pending_update_count ?? 0} ta yangilanish`);
if (w.last_error_message) {
  console.log(`Oxirgi xato: ${w.last_error_message}`);
  console.log(`  (${new Date((w.last_error_date ?? 0) * 1000).toISOString()})`);
}
console.log(`Maxfiy token: ${w.has_custom_certificate === undefined ? '—' : ''}`
  + (w.url ? (SECRET ? 'sozlangan' : 'NOMA\'LUM') : '—'));

if (!APPLY) {
  console.log('\n(--apply bilan ishga tushiring — sozlash uchun)');
  process.exit(0);
}

if (!SECRET) {
  console.error('\nTELEGRAM_WEBHOOK_SECRET yo\'q — webhook himoyasiz qoladi.');
  process.exit(1);
}
if (!URL) {
  console.error('\nVITE_SUPABASE_URL topilmadi.');
  process.exit(1);
}

// --- Webhook -------------------------------------------------------------
const hook = `${URL}/functions/v1/telegram-webhook`;
const set = await api('setWebhook', {
  url: hook,
  secret_token: SECRET,
  //  Faqat kerakli turlar: qolganlari bekorga navbatni to'ldiradi.
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
});
console.log(`\nsetWebhook: ${set.ok ? 'OK' : set.description}`);
console.log(`  ${hook}`);

// --- Buyruqlar ro'yxati ---------------------------------------------------
//  Telegram da "Menu" tugmasi shu ro'yxatdan quriladi. Busiz odam
//  botga nima yozish mumkinligini bilmaydi va faqat tugmalarga
//  tayanadi — suhbat tarixi uzayganda ular yo'qolib qoladi.
const COMMANDS = {
  uz: [
    { command: 'menu',   description: 'Bosh menyu' },
    { command: 'yordam', description: 'Bot nima qila oladi' },
    { command: 'til',    description: 'Tilni almashtirish' },
  ],
  ru: [
    { command: 'menu',   description: 'Главное меню' },
    { command: 'yordam', description: 'Что умеет бот' },
    { command: 'til',    description: 'Сменить язык' },
  ],
};

for (const [lang, commands] of Object.entries(COMMANDS)) {
  const r = await api('setMyCommands', {
    commands,
    scope: { type: 'all_private_chats' },
    language_code: lang === 'uz' ? undefined : lang,
  });
  console.log(`setMyCommands (${lang}): ${r.ok ? 'OK' : r.description}`);
}

//  Chatga kirganda ko'rinadigan qisqa tavsif.
await api('setMyDescription', {
  description: 'Maktabning rasmiy boti: farzandingiz davomati, '
    + 'hisoblanma, qarzdorlik va to\'lov cheki.',
});
await api('setMyShortDescription', {
  short_description: 'Davomat, hisoblanma va to\'lov',
});

const after = await api('getWebhookInfo');
console.log(`\nTekshiruv: ${after.result?.url || '(bo\'sh)'}`);
