#!/usr/bin/env node
// =====================================================================
//  audit-drift.mjs — baza va repo bir-biriga MOS kelayotganini tekshiradi.
//
//  NEGA KERAK. 2026-08-26 da shunday hol yuz berdi: super admin qismi
//  (10 ta migratsiya — tariflash, obuna to'lovi, muloqot) jonli bazaga
//  qo'llangan, lekin migratsiya fayllari repoga tushmagan. Baza ishlab
//  turardi, panel ishlardi, barcha auditlar "toza" derdi. Nomuvofiqlik
//  faqat TOZA BAZAGA ko'chirganda chiqardi — ya'ni eng noqulay paytda.
//
//  Shu tekshiruv ikki tomonlama:
//
//    1. Bazada bor, faylda yo'q — migratsiya yozilmay qolgan.
//       Toza bazada bu obyekt UMUMAN bo'lmaydi.
//
//    2. Faylda bor, tarixda yo'q — qo'llanmagan migratsiya.
//       Kod bazadan oldinda ketgan.
//
//  Ishlatish:  node scripts/audit-drift.mjs
// =====================================================================

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// ---------------------------------------------------------------------
//  BOSHQA REPO EGALIK QILADIGAN QISM
//
//  Baza IKKI repo tomonidan bo'lishiladi:
//
//    · maktab qismi   → SHU REPO
//    · platforma qismi → `MaktabFinanceSupperAdmin/SupperAdminMaktabFinance`
//      (obuna, tariflash, muloqot, impersonation, platforma hisobotlari)
//
//  Shuning uchun platforma migratsiyalari va ular yaratgan obyektlar
//  bu yerda "yo'qolgan" deb hisoblanmaydi — ularning fayli boshqa
//  repoda va o'sha repo o'z `audit-drift` ini yuritadi.
//
//  Nega ro'yxat QO'LDA: avtomatik aniqlash uchun ikkala repoga bir
//  vaqtda qarash kerak bo'lardi. Ro'yxat esa o'n qatorlik va yangi
//  platforma obyekti qo'shilganda bir marta yangilanadi.
// ---------------------------------------------------------------------

//  QAYSI MIGRATSIYA BEGONA — VAQT UYASI BO'YICHA.
//
//  Versiya `YYYYMMDD` + `HHMMSS`. Ikkala repo bitta tarix jadvaliga
//  yozadi, shuning uchun raqamlar to'qnashmasligi kerak: platforma
//  repo HAR DOIM `15` uyasini oladi, bu repo `12`–`14` ni.
//
//  TO'QNASHUV JIM O'TADI: bir xil versiya raqami `db.mjs` tomonidan
//  "allaqachon qo'llangan" deb ko'riladi va migratsiya BAJARILMAY
//  qoladi, xato ham bermaydi. 2026-08-27 da aynan shunday bo'ldi.
//
//  Istisno — platforma reposining birinchi o'nta migratsiyasi `12`
//  uyasida yozilgan, qoida joriy qilinishidan oldin.
const FOREIGN_LEGACY = new Set([
  '20260826120000', '20260826120001', '20260826120002', '20260826120003',
  '20260826120004', '20260826120005', '20260826120006', '20260826120007',
  '20260826120008', '20260826120009',
]);

const isForeignVersion = (v) =>
  v.slice(8, 10) === '15' || FOREIGN_LEGACY.has(v);

//  Platforma obyektlari — ularning DDL si boshqa repoda.
const FOREIGN_OBJECTS = new Set([
  'platform_settings', 'subscription_invoices', 'subscription_payments',
  'support_threads', 'support_messages',
  'subscription_invoice_status', 'subscription_payment_status',
  'support_thread_status', 'support_priority',
  'billing_num', 'plog', 'require_platform_admin', 'recompute_school_billing',
  'apply_subscription_payment', 'support_post', 'notify_school',
  'school_price', 'set_school_status', 'set_school_plan',
  'issue_subscription_invoice', 'record_subscription_payment',
  'submit_subscription_payment', 'review_subscription_payment',
  'set_platform_setting', 'log_platform_action',
  'start_impersonation', 'end_impersonation', 'school_users',
  'open_support_thread', 'post_support_message',
  'set_support_thread_status', 'mark_support_read',
  'run_billing_cycle', 'update_school_profile',
  'platform_schools', 'platform_overview',
  'platform_revenue', 'platform_school_card',
]);



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

async function sql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${REF}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const body = JSON.parse(await res.text());
  if (!res.ok || body?.message) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body;
}

// --- Migratsiya fayllarining butun matni -----------------------------
const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
const texts = await Promise.all(
  files.map((f) => readFile(join(MIGRATIONS, f), 'utf8')),
);
const corpus = texts.join('\n').toLowerCase();

//  Nom matnda umuman uchraydimi? Bu QO'POL, lekin ataylab shunday:
//  aniq DDL tahlili murakkab va noto'g'ri xavotir beradi. Bu yerda
//  savol oddiy — "bu obyekt haqida repoda biror joyda gap boradimi?"
const inRepo = (name) => corpus.includes(name.toLowerCase());

const problems = [];

// --- 1. Bazada bor, repoda yo'q ---------------------------------------
const tables = await sql(`
  select table_name as name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';
`);
const views = await sql(`
  select table_name as name from information_schema.views
   where table_schema = 'public';
`);
const enums = await sql(`
  select t.typname as name from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype = 'e';
`);
const funcs = await sql(`
  select distinct n.nspname || '.' || p.proname as name, p.proname as bare
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app');
`);

for (const [kind, rows, key] of [
  ['jadval', tables, 'name'],
  ["ko'rinish", views, 'name'],
  ['enum', enums, 'name'],
  ['funksiya', funcs, 'bare'],
]) {
  for (const r of rows) {
    //  Platforma obyekti — uning DDL si boshqa repoda, bu yerda
    //  "yo'qolgan" deb hisoblanmaydi.
    if (FOREIGN_OBJECTS.has(r[key])) continue;
    if (!inRepo(r[key])) {
      problems.push(`bazada bor, repoda yo'q — ${kind}: ${r.name ?? r[key]}`);
    }
  }
}

// --- 2. Faylda bor, tarixda yo'q --------------------------------------
const applied = new Set(
  (await sql('select version from supabase_migrations.schema_migrations;'))
    .map((r) => r.version),
);
const versions = files.map((f) => (f.match(/^(\d+)_/) ?? [])[1]).filter(Boolean);

for (const [i, v] of versions.entries()) {
  if (!applied.has(v)) problems.push(`qo'llanmagan migratsiya: ${files[i]}`);
}

// --- 3. Tarixda bor, faylda yo'q --------------------------------------
//  Eng xavflisi shu: baza fayllardan oldinda. Toza bazani qurish
//  natijasi HOZIRGIDAN BOSHQA bo'ladi.
const known = new Set(versions);
let foreign = 0;

for (const v of [...applied].sort()) {
  if (known.has(v)) continue;
  if (isForeignVersion(v)) { foreign++; continue; }
  problems.push(`tarixda bor, fayli yo'q: ${v}`);
}

// --- Natija ------------------------------------------------------------
console.log(`\nMigratsiya fayli: ${files.length}, tarixda: ${applied.size}`);

if (foreign > 0) {
  console.log(`Platforma reposiniki (tekshirilmadi): ${foreign}`);
}

if (problems.length === 0) {
  console.log('\n  ✓ Baza va repo mos — toza bazada ham shu holat quriladi\n');
  process.exit(0);
}

console.log(`\n  ${problems.length} ta nomuvofiqlik:\n`);
for (const p of problems) console.log(`   · ${p}`);
console.log('');
process.exit(1);
