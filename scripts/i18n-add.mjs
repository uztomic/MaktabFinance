#!/usr/bin/env node
// =====================================================================
//  i18n-add.mjs — yangi tarjima kalitlarini qo'shadi.
//
//    node scripts/i18n-add.mjs yangi-kalitlar.json
//
//  Fayl ko'rinishi:
//    { "cls.title": ["Sinflar", "Классы"] }   // [o'zbekcha, ruscha]
//
//  Mavjud kalitga TEGMAYDI — faqat yo'qlarini qo'shadi. Shuning uchun
//  bir faylni bir necha marta ishlatish xavfsiz.
//
//  Kirill varianti qo'lda yozilmaydi: oxirida `make-cyrillic.mjs`
//  o'zi hosil qiladi.
// =====================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps', 'maktab-panel', 'src', 'i18n');

const input = process.argv[2];
if (!input) {
  console.error('Foydalanish: node scripts/i18n-add.mjs kalitlar.json');
  process.exit(1);
}

const ADD = JSON.parse(readFileSync(input, 'utf8'));

for (const [file, idx] of [['uz.json', 0], ['ru.json', 1]]) {
  const p = join(DIR, file);
  const obj = JSON.parse(readFileSync(p, 'utf8'));
  let added = 0;
  for (const [k, v] of Object.entries(ADD)) {
    const text = Array.isArray(v) ? v[idx] : v;
    if (text === undefined) continue;
    if (!(k in obj)) { obj[k] = text; added++; }
  }
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  console.log(`${file}: +${added} → ${Object.keys(obj).length}`);
}

console.log("Endi: node scripts/make-cyrillic.mjs");
