#!/usr/bin/env node
// =====================================================================
//  new-school.mjs — yangi maktabni ulaydi (TZ 4.13.2).
//
//  Super admin paneli tayyor bo'lguncha shu skript o'sha sehrgarning
//  vazifasini bajaradi:
//    1. maktab + standart filial + obuna     (provision_school)
//    2. shablon sozlamalar                   (seed_school_defaults)
//    3. direktor hisobi va kirish ma'lumoti  (Auth admin API)
//
//  Ishga tushirish:
//    node scripts/new-school.mjs "Maktab nomi" direktor@pochta.uz
//    node scripts/new-school.mjs "Maktab nomi" 998901234567
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

const REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_BASE = `https://${REF}.supabase.co`;

if (!REF || !TOKEN || !SERVICE_KEY) {
  console.error(
    'XATO: .env.local da SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN va ' +
    'SUPABASE_SERVICE_ROLE_KEY bo\'lishi kerak.',
  );
  process.exit(1);
}

const [schoolName, login, branchName] = process.argv.slice(2);

if (!schoolName || !login) {
  console.log(
    '\nFoydalanish:\n' +
    '  node scripts/new-school.mjs "Maktab nomi" <email yoki telefon> [filial nomi]\n\n' +
    'Misol:\n' +
    '  node scripts/new-school.mjs "Nur maktabi" direktor@nur.uz\n' +
    '  node scripts/new-school.mjs "Nur maktabi" 998901234567 "Chilonzor filiali"\n',
  );
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
  const body = await res.json();
  if (!res.ok || body?.message) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body;
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function looksLikePhone(v) {
  return !v.includes('@') && v.replace(/\D/g, '').length >= 9;
}

function generatePassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ---------------------------------------------------------------------
console.log(`\nMaktab ulanmoqda: ${schoolName}\n`);

// 1) Maktab + filial + obuna + shablon sozlamalar
const [prov] = await sql(`
  select public.provision_school(
    ${lit(schoolName)},
    ${lit(branchName || 'Asosiy filial')},
    'basic', 30
  ) as result
`);

const { school_id, branch_id } = prov.result;
console.log(`  ✓ Maktab yaratildi   ${school_id}`);
console.log(`  ✓ Filial yaratildi   ${branch_id}`);
console.log('  ✓ Shablon sozlamalar yuklandi (xarajat kategoriyalari,');
console.log('    chegirma turlari, yo\'qlik sabablari, kalendar, oylik parametrlari)');

// 2) Direktor hisobi
const isPhone = looksLikePhone(login);
const email = isPhone ? `${login.replace(/\D/g, '')}@maktab.local` : login.toLowerCase();
const password = generatePassword();

const authRes = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Direktor' },
  }),
});

const authBody = await authRes.json();
if (!authRes.ok) {
  console.error(`\nXATO: hisob yaratilmadi — ${authBody?.msg ?? authBody?.message}`);
  console.error('(Bu email allaqachon band bo\'lishi mumkin.)');
  process.exit(1);
}

const userId = authBody.id;

await sql(`
  insert into public.app_users
    (id, school_id, role, full_name, email, phone, all_branches)
  values (
    ${lit(userId)}, ${lit(school_id)}, 'director', 'Direktor',
    ${isPhone ? 'null' : lit(email)},
    ${isPhone ? lit(login.replace(/\D/g, '')) : 'null'},
    true
  );
`);

console.log(`  ✓ Direktor hisobi yaratildi\n`);

console.log('─'.repeat(56));
console.log('  KIRISH MA\'LUMOTLARI');
console.log('─'.repeat(56));
console.log(`  Login : ${isPhone ? login : email}`);
console.log(`  Parol : ${password}`);
console.log('─'.repeat(56));
console.log('\n  ⚠️  Parol faqat HOZIR ko\'rsatiladi. Uni saqlab qo\'ying.');
console.log('  Direktor kirgach boshqa xodimlarni o\'zi qo\'sha oladi.\n');
