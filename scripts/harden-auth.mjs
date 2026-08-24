#!/usr/bin/env node
// =====================================================================
//  harden-auth.mjs — Supabase Auth sozlamalarini qattiqlashtiradi.
//
//  NEGA SKRIPT, PANELDAN QO'LDA EMAS: bu sozlamalar bazada emas,
//  loyiha darajasida saqlanadi va migratsiyaga tushmaydi. Ya'ni
//  loyiha ko'chirilsa yoki yangi mijozga o'rnatilsa, ular jimgina
//  standart (zaif) holatga qaytadi. Skript bo'lsa — qayta ishlatiladi
//  va nima o'zgarganini ko'rsatadi.
//
//  Har bir qiymat nega shunday ekani yonida yozilgan.
//
//    node scripts/harden-auth.mjs            # ko'rsatadi, tegmaydi
//    node scripts/harden-auth.mjs --apply    # qo'llaydi
// =====================================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadEnv() {
  const path = join(ROOT, '.env.local');
  if (!existsSync(path)) return;
  const text = await readFile(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
await loadEnv();

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) {
  console.error("XATO: .env.local da SUPABASE_ACCESS_TOKEN va SUPABASE_PROJECT_REF kerak.");
  process.exit(1);
}

/** Sayt manzili — parol tiklash havolasi shu yerga qaytadi. */
const SITE = process.env.PANEL_SITE_URL || 'https://maktab.uztomic.uz';
const DEV = 'http://localhost:5173';

// =====================================================================
//  BEPUL TARIFDA HAM ISHLAYDIGANLAR
// =====================================================================

const WANTED = {
  // --- Parol ------------------------------------------------------
  //  8 ta belgi 2026-yilda kam. Moliyaviy tizim uchun 12 — oqilona
  //  minimum va bu bepul tarifda ham qo'llanadi.
  password_min_length: 12,

  //  Kichik + katta harf + raqam. Maxsus belgi TALAB QILINMAYDI:
  //  u odamlarni "Parol1!" kabi bir xil naqshga majburlaydi va
  //  amalda kuchni oshirmaydi.
  password_required_characters:
    'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',

  //  Parolni o'zgartirish uchun qaytadan tasdiqlash.
  security_update_password_require_reauthentication: true,

  // --- Sessiya ----------------------------------------------------
  //  Kirish tokeni bir soat, keyin refresh orqali yangilanadi.
  jwt_exp: 3600,

  //  Refresh token har ishlatilganda almashadi. Eskisi qayta
  //  ishlatilsa — o'g'irlangani ma'lum bo'ladi va butun zanjir
  //  bekor qilinadi.
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,

  // --- Xatdagi havola ---------------------------------------------
  //  Bir soat juda uzoq: pochtaga kirish imkoni bo'lgan odam
  //  shuncha vaqt ichida havolani ishlatib olishi mumkin.
  mailer_otp_exp: 900,

  // --- Ro'yxatdan o'tish -------------------------------------------
  //  Hisobni FAQAT administrator yaratadi. Ochiq ro'yxatdan o'tish
  //  bo'lsa, istalgan odam maktab bazasida foydalanuvchi bo'lardi.
  disable_signup: true,
  external_phone_enabled: false,
  security_manual_linking_enabled: false,

  // --- Manzillar ---------------------------------------------------
  //  Bu ro'yxatda bo'lmagan manzilga tiklash havolasi qaytmaydi —
  //  ochiq yo'naltirish (open redirect) hujumining oldini oladi.
  site_url: SITE,
  uri_allow_list: [`${SITE}/**`, `${DEV}/**`].join(','),
};

// =====================================================================
//  PRO TARIF TALAB QILADIGANLAR
//
//  ALOHIDA yuboriladi: bitta so'rovda yuborilsa Supabase butun
//  so'rovni 402 bilan rad etadi va bepul tarifda ishlaydigan
//  sozlamalar ham qo'llanmay qoladi.
// =====================================================================

const PRO_ONLY = {
  //  Tarqalgan parollar bazasi (HaveIBeenPwned) bilan solishtirish.
  password_hibp_enabled: true,

  //  Eng real xavf — kanselyariyadagi umumiy kompyuter ochiq
  //  qolishi. Sakkiz soat ish kunini buzmaydi, lekin tunab qolgan
  //  sessiyani o'ldiradi.
  sessions_inactivity_timeout: 8 * 60 * 60,

  //  O'g'irlangan token cheksiz yashamaydi.
  sessions_timebox: 24 * 60 * 60,
};

/** Odam o'qiydigan nom — natija ro'yxatida ko'rinadi. */
const PRO_LABEL = {
  password_hibp_enabled: 'sizib chiqqan parollarni tekshirish',
  sessions_inactivity_timeout: 'harakatsizlikdan keyin chiqarish (8 soat)',
  sessions_timebox: 'sessiyaning eng uzun umri (24 soat)',
};

// =====================================================================

const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const cur = await (await fetch(API, { headers: H })).json();

const changes = Object.entries(WANTED)
  .filter(([k, v]) => JSON.stringify(cur[k]) !== JSON.stringify(v))
  .map(([k, v]) => ({ k, now: cur[k], v }));

const proPending = Object.entries(PRO_ONLY)
  .filter(([k, v]) => JSON.stringify(cur[k]) !== JSON.stringify(v));

if (changes.length === 0 && proPending.length === 0) {
  console.log('\n  ✓ Auth sozlamalari allaqachon qattiqlashtirilgan\n');
  process.exit(0);
}

if (changes.length) {
  console.log("\nO'zgaradigan sozlamalar:\n");
  for (const c of changes) {
    console.log(`  ${c.k}`);
    console.log(`    ${JSON.stringify(c.now)}  →  ${JSON.stringify(c.v)}`);
  }
}
if (proPending.length) {
  console.log('\nPro tarif talab qiladiganlar:\n');
  for (const [k] of proPending) console.log(`  · ${PRO_LABEL[k] ?? k}`);
}

if (!process.argv.includes('--apply')) {
  console.log("\n  Qo'llash uchun: node scripts/harden-auth.mjs --apply\n");
  process.exit(0);
}

// --- 1. Bepul tarifdagilar -----------------------------------------
let after = cur;

if (changes.length) {
  const res = await fetch(API, {
    method: 'PATCH', headers: H,
    body: JSON.stringify(Object.fromEntries(changes.map((c) => [c.k, c.v]))),
  });
  if (!res.ok) {
    const out = await res.json();
    console.error(`\n  XATO ${res.status}: ${JSON.stringify(out).slice(0, 400)}\n`);
    process.exit(1);
  }

  // Nima haqiqatan qo'llanganini TEKSHIRAMIZ — "OK" javob yetarli
  // emas, ba'zi sozlama jimgina rad etilishi mumkin.
  after = await (await fetch(API, { headers: H })).json();

  let failed = 0;
  console.log('\nNatija:\n');
  for (const c of changes) {
    const ok = JSON.stringify(after[c.k]) === JSON.stringify(c.v);
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${c.k.padEnd(50)} ${JSON.stringify(after[c.k])}`);
  }
  console.log(failed === 0
    ? "\n  ✓ Bepul tarifdagi sozlamalar qo'llandi"
    : `\n  ${failed} ta sozlama qo'llanmadi`);
}

// --- 2. Pro tarif talab qiladiganlar --------------------------------
const proChanges = Object.entries(PRO_ONLY)
  .filter(([k, v]) => JSON.stringify(after[k]) !== JSON.stringify(v));

if (proChanges.length === 0) {
  console.log("  ✓ Qo'shimcha himoya ham joyida\n");
  process.exit(0);
}

const proRes = await fetch(API, {
  method: 'PATCH', headers: H,
  body: JSON.stringify(Object.fromEntries(proChanges)),
});

if (proRes.ok) {
  console.log("  ✓ Qo'shimcha himoya qo'llandi:");
  for (const [k] of proChanges) console.log(`      · ${PRO_LABEL[k] ?? k}`);
  console.log('');
  process.exit(0);
}

const msg = (await proRes.json())?.message ?? proRes.status;

console.log("\n  ! Quyidagilar QO'LLANMADI (bepul tarif cheklovi):");
for (const [k] of proChanges) console.log(`      · ${PRO_LABEL[k] ?? k}`);
console.log(`\n      ${msg}\n`);
console.log("    Amaldagi ta'siri:");
console.log("    · sizib chiqqan parolni qo'yish mumkin — shuning uchun");
console.log('      12 belgi va harf+raqam talabi MUHIM, ular bepul');
console.log("      tarifda ham ishlaydi va qo'llandi;");
console.log("    · sessiya o'zi tugamaydi — ochiq qolgan brauzer ochiq");
console.log('      qolaveradi.');
console.log('');
console.log("    O'rnini bosuvchi chora (allaqachon ishlaydi):");
console.log('    · panelda "Chiqish" tugmasi;');
console.log('    · refresh token har ishlatilganda almashadi —');
console.log("      o'g'irlangani ma'lum bo'lsa zanjir bekor qilinadi;");
console.log('    · har bir moliyaviy amal audit jurnaliga tushadi.');
console.log('');
console.log("    Pro tarifga o'tilganda shu skriptni qayta ishga");
console.log("    tushiring — qolgani o'zi qo'llanadi.");
console.log('');
