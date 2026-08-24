import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'apps/maktab-panel/src';
const uz = JSON.parse(readFileSync(join(SRC, 'i18n/uz.json'), 'utf8'));

const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(SRC);

const missing = new Map();
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
    if (!(m[1] in uz)) {
      if (!missing.has(m[1])) missing.set(m[1], new Set());
      missing.get(m[1]).add(f.replace(SRC + '/', ''));
    }
  }
}
if (missing.size === 0) console.log('OK — barcha kalitlar mavjud');
else {
  console.log(`YETISHMAYDI (${missing.size}):`);
  for (const [k, fs] of [...missing].sort()) console.log(`  ${k}  ← ${[...fs].join(', ')}`);
}
