#!/usr/bin/env node
// =====================================================================
//  setup-platform.mjs — bir martalik platforma sozlamalari.
//
//  Uchta ishni bajaradi:
//    1. Vault ga project_url va service_role_key ni yozadi — cron
//       Edge Function'ni shular orqali chaqiradi (kalit kodda emas).
//    2. Custom Access Token Hook ni yoqadi — impersonation claim'lari
//       JWT ga shu orqali qo'yiladi (TZ 5.4.12).
//    3. Auth sozlamalarini TZ ga moslaydi (ochiq ro'yxatdan o'tish yo'q).
//
//  Ishga tushirish:  node scripts/setup-platform.mjs
//  Takroran ishga tushirsa xavfsiz (idempotent).
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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !REF) {
  console.error('XATO: .env.local da SUPABASE_ACCESS_TOKEN va SUPABASE_PROJECT_REF kerak.');
  process.exit(1);
}

const PROJECT_URL = `https://${REF}.supabase.co`;

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

async function api(path, method, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------
// 1. VAULT
// ---------------------------------------------------------------------
console.log('\n1) Vault kalitlari...');

// service_role kalitini API dan olamiz — uni qo'lda kiritish shart emas.
let serviceKey = SERVICE_KEY;
if (!serviceKey) {
  try {
    const keys = await api('/api-keys?reveal=true', 'GET');
    serviceKey = keys.find((k) => k.name === 'service_role')?.api_key;
  } catch { /* eski API — quyida ogohlantiramiz */ }
}

if (!serviceKey) {
  console.log('   ⚠️  service_role kaliti topilmadi.');
  console.log('   .env.local ga SUPABASE_SERVICE_ROLE_KEY=... qo\'shing va qayta ishga tushiring.');
  console.log('   (Bunsiz cron queue-sender ni chaqira olmaydi.)');
} else {
  await sql(`
    do $do$
    begin
      -- Mavjud bo'lsa yangilaymiz, bo'lmasa yaratamiz.
      if exists (select 1 from vault.secrets where name = 'project_url') then
        perform vault.update_secret(
          (select id from vault.secrets where name = 'project_url'),
          ${lit(PROJECT_URL)}, 'project_url');
      else
        perform vault.create_secret(${lit(PROJECT_URL)}, 'project_url',
          'Cron Edge Function chaqiruvi uchun');
      end if;

      if exists (select 1 from vault.secrets where name = 'service_role_key') then
        perform vault.update_secret(
          (select id from vault.secrets where name = 'service_role_key'),
          ${lit(serviceKey)}, 'service_role_key');
      else
        perform vault.create_secret(${lit(serviceKey)}, 'service_role_key',
          'Cron Edge Function chaqiruvi uchun');
      end if;
    end $do$;
  `);
  console.log('   ✓ project_url va service_role_key Vault ga yozildi');
}

// ---------------------------------------------------------------------
// 2. AUTH HOOK + SOZLAMALAR
// ---------------------------------------------------------------------
console.log('\n2) Auth sozlamalari va hook...');

try {
  await api('/config/auth', 'PATCH', {
    // TZ 5.4.12 — impersonation claim'lari JWT ga shu hook orqali tushadi.
    hook_custom_access_token_enabled: true,
    hook_custom_access_token_uri:
      'pg-functions://postgres/public/custom_access_token_hook',

    // Ochiq ro'yxatdan o'tish YO'Q: hisoblarni faqat super admin yoki
    // direktor yaratadi (TZ 4.13.3).
    disable_signup: true,

    // Telefon bilan kirganlarga sintetik pochta beriladi va unga
    // haqiqiy xat bormaydi — tasdiqlash yoqilsa ular kira olmaydi.
    mailer_autoconfirm: true,

    // TZ 5.7 — sessiya 1 soat, refresh token aylanadi.
    jwt_exp: 3600,
    refresh_token_rotation_enabled: true,
    security_refresh_token_reuse_interval: 10,
  });
  console.log('   ✓ Custom Access Token Hook yoqildi');
  console.log('   ✓ Ochiq ro\'yxatdan o\'tish o\'chirildi (TZ 4.13.3)');
} catch (err) {
  console.log(`   ⚠️  Auth sozlamasi qo'llanmadi: ${err.message}`);
}

// ---------------------------------------------------------------------
// 3. TEKSHIRUV
// ---------------------------------------------------------------------
console.log('\n3) Tekshiruv...');

const [vault] = await sql(`
  select
    (select count(*) from vault.secrets
      where name in ('project_url','service_role_key')) as vault_secrets,
    (select count(*) from cron.job where jobname like 'maktab_%') as cron_jobs,
    (select count(*) from storage.buckets
      where id in ('receipts','statements','expense-docs')) as buckets,
    (select count(*) from storage.buckets
      where id in ('receipts','statements','expense-docs') and public) as public_buckets
`);

console.log(`   Vault kalitlari : ${vault.vault_secrets}/2`);
console.log(`   Cron vazifalari : ${vault.cron_jobs}/3`);
console.log(`   Storage bucket  : ${vault.buckets}/3`);
console.log(
  `   Ochiq bucket    : ${vault.public_buckets} ${
    vault.public_buckets === '0' || vault.public_buckets === 0
      ? '(to\'g\'ri — TZ 5.5.8)'
      : '⚠️ OCHIQ BUCKET BOR!'
  }`,
);

console.log('\nTayyor.\n');
