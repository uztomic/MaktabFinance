#!/usr/bin/env node
// =====================================================================
//  fix-selects.mjs — `.select()` ichidagi ulangan qatorlarni birlashtiradi.
//
//  MUAMMO: supabase-js so'rov turini `.select()` ga berilgan matndan
//  aniqlaydi. Buning uchun matn LITERAL bo'lishi shart. Agar u
//  `'a, b, ' + 'c'` ko'rinishida yozilsa, TypeScript uni oddiy
//  `string` deb ko'radi va tur aniqlanmaydi — natijada
//  `GenericStringError` chiqadi.
//
//  Bu skript uzun select qatorlarini bitta literalga birlashtiradi.
// =====================================================================

import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'apps', 'maktab-panel', 'src');

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (['.ts', '.tsx'].includes(extname(e.name))) yield p;
  }
}

// .select( ... ) ichidagi ketma-ket ulangan literal qatorlar.
const PATTERN = /\.select\(\s*((?:'[^']*'\s*\+\s*)+'[^']*')\s*([,)])/g;

let touched = 0;

for await (const file of walk(SRC)) {
  const original = await readFile(file, 'utf8');

  const updated = original.replace(PATTERN, (_m, expr, tail) => {
    // Har bir 'literal' ni ajratib olamiz va birlashtiramiz.
    const parts = [...expr.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    const joined = parts.join('');
    return `.select('${joined}'${tail}`;
  });

  if (updated !== original) {
    await writeFile(file, updated, 'utf8');
    touched++;
    console.log(`  ✓ ${file.replace(SRC, 'src')}`);
  }
}

console.log(`\n${touched} ta fayl tuzatildi.\n`);
