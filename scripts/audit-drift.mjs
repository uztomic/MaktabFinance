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
//  Tarixda bor, fayli yo'q — LEKIN mazmuni boshqa faylga ko'chirilgan.
//
//  Bu 10 ta migratsiya super admin qismini qurgan va jonli bazaga
//  qo'llangan, ammo fayllari repoga tushmagan. Ular yaratgan obyektlar
//  bazadan o'qib olinib `20260826120010_platform_reconstruct.sql` ga
//  yozildi — ya'ni toza baza ham AYNAN shu holatda quriladi.
//
//  Tarix yozuvlari ATAYLAB o'chirilmadi: agar o'sha 10 ta fayl keyin
//  topilib repoga qo'shilsa, ular jonli bazada QAYTA bajarilmasligi
//  kerak. "Qo'llangan" belgisi shuni ta'minlaydi.
// ---------------------------------------------------------------------
const COVERED = new Map([
  ['20260826120000', 'platform_enums'],
  ['20260826120001', 'platform_billing'],
  ['20260826120002', 'support_chat'],
  ['20260826120003', 'platform_rls'],
  ['20260826120004', 'platform_rpc'],
  ['20260826120005', 'impersonation_rpc'],
  ['20260826120006', 'billing_cron'],
  ['20260826120007', 'platform_reports'],
  ['20260826120008', 'guard_service_context'],
  ['20260826120009', 'log_platform_action'],
].map(([v, n]) => [v, n]));

const COVERED_BY = '20260826120010_platform_reconstruct.sql';

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
const covered = [];

for (const v of [...applied].sort()) {
  if (known.has(v)) continue;
  if (COVERED.has(v)) {
    covered.push(`${v} (${COVERED.get(v)})`);
    continue;
  }
  problems.push(`tarixda bor, fayli yo'q: ${v}`);
}

if (covered.length > 0 && !files.includes(COVERED_BY)) {
  problems.push(
    `${COVERED_BY} yo'q — ${covered.length} ta migratsiya qoplanmay qoldi`);
}

// --- Natija ------------------------------------------------------------
console.log(`\nMigratsiya fayli: ${files.length}, tarixda: ${applied.size}`);

if (covered.length > 0) {
  console.log(
    `\n  ${covered.length} ta migratsiya fayli yo'q, mazmuni ${COVERED_BY} da:`);
  for (const c of covered) console.log(`   · ${c}`);
}

if (problems.length === 0) {
  console.log('\n  ✓ Baza va repo mos — toza bazada ham shu holat quriladi\n');
  process.exit(0);
}

console.log(`\n  ${problems.length} ta nomuvofiqlik:\n`);
for (const p of problems) console.log(`   · ${p}`);
console.log('');
process.exit(1);
