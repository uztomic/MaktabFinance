#!/usr/bin/env node
// =====================================================================
//  check-secrets.mjs — GitHub'ga yuborishdan OLDIN ishlatiladi.
//
//  `.gitignore` bor deb ishonib qolmaslik kerak: bitta noto'g'ri
//  `git add -f`, yangi papka yoki nusxa ko'chirilgan fayl yetarli.
//  Bu skript git'ning O'ZIDAN "nimani qo'shasan" deb so'raydi va
//  aynan o'sha fayllarni tekshiradi.
//
//  Nima qidiriladi:
//    · Supabase service_role / anon JWT
//    · Supabase access token (sbp_...) va secret key (sb_secret_...)
//    · Telegram bot tokeni
//    · qiymati yozilgan SERVICE_ROLE_KEY
//
//  ATAYLAB OCHIQ: `apps/maktab-panel/.env.production` dagi
//  publishable kalit. U brauzerga baribir chiqadi va himoya RLS da.
//
//    node scripts/check-secrets.mjs
// =====================================================================

import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const RULES = [
  ['Supabase JWT (anon/service_role)',
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['Supabase access token (sbp_)', /\bsbp_[a-f0-9]{40}\b/],
  ['Supabase secret key (sb_secret_)', /\bsb_secret_[A-Za-z0-9_-]{10,}/],
  ['Telegram bot tokeni', /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['SERVICE_ROLE_KEY qiymat bilan',
    /SERVICE_ROLE_KEY\s*=\s*(?!Deno\.|process\.|import\.)[^\s#'"`]{20,}/],
];

/** Publishable kalit ataylab ochiq — u sir emas. */
function isAllowed(file, match) {
  if (file.replace(/\\/g, '/').endsWith('apps/maktab-panel/.env.production')) {
    return match.startsWith('sb_publishable_');
  }
  return false;
}

let files;
try {
  const out = execSync('git add -An .', {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  files = out.split('\n')
    .map((l) => l.replace(/^add '/, '').replace(/'$/, ''))
    .filter(Boolean);
} catch {
  console.error("XATO: git repozitoriy topilmadi (git init qilinganmi?)");
  process.exit(1);
}

const hits = [];

for (const f of files) {
  let st;
  try { st = statSync(f); } catch { continue; }
  if (!st.isFile() || st.size > 2_000_000) continue;

  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }

  for (const [name, re] of RULES) {
    for (const m of text.matchAll(new RegExp(re, 'g'))) {
      if (isAllowed(f, m[0])) continue;
      hits.push({ name, file: f, sample: m[0].slice(0, 28) });
    }
  }
}

console.log(`\nTekshirilgan fayl: ${files.length}\n`);

if (hits.length === 0) {
  console.log("  ✓ Maxfiy kalit topilmadi — yuborish xavfsiz\n");
  process.exit(0);
}

console.log(`  ✗ ${hits.length} ta ehtimoliy sir topildi:\n`);
for (const h of hits) {
  console.log(`  ${h.name}`);
  console.log(`    ${h.file}`);
  console.log(`    ${h.sample}…\n`);
}
console.log("  YUBORMANG. Faylni .gitignore ga qo'shing yoki kalitni oling.\n");
process.exit(1);
