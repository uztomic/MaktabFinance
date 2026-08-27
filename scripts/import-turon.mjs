#!/usr/bin/env node
// =====================================================================
//  import-turon.mjs — "Turon Ilm Xazinasi" ro'yxatini bazaga kiritadi.
//
//  Manba qo'lda yuritilgan ro'yxat, ya'ni unda tabiiy ravishda
//  chalkashlik bor: bir odam ikki xil yozilgan, bir ism ikki guruhda
//  uchraydi, ba'zi qatorda narx yo'q. Skript ularni JIM tuzatmaydi —
//  har bir qaror hisobotda ko'rinadi va odam uni o'qib chiqadi.
//
//  ISHLATISH:
//
//    node scripts/import-turon.mjs             — faqat hisobot
//    node scripts/import-turon.mjs --confirm   — bazaga yozish
//
//  `--confirm` siz HECH NARSA yozilmaydi. Bu ataylab: 229 ta o'quvchi
//  va shartnoma yaratiladi va ularni qaytarib olish oson emas.
// =====================================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GROUPS, REGISTER } from './turon-data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIRM = process.argv.includes('--confirm');

//  O'quv yili. Bugun avgust oxiri, ya'ni ro'yxat kelayotgan yil uchun.
const YEAR = '2026/2027';
const STARTS_ON = '2026-09-01';
//  Shartnoma bugun tuzilyapti, lekin kuchga sentabrdan kiradi.
const SIGNED_ON = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------
//  Ulanish
// ---------------------------------------------------------------------

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
  console.error('XATO: .env.local da SUPABASE_ACCESS_TOKEN va SUPABASE_PROJECT_REF kerak.');
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

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// ---------------------------------------------------------------------
//  ISM SOLISHTIRISH
//
//  O'zbek ismlari lotinchada bir necha xil yoziladi va manbada
//  ikkalasi ham uchraydi:
//
//    Azimhadjayev ↔ Azimxodjayev      (h ↔ x)
//    SHuhratjonov ↔ Shuxratjonov      (SH ↔ Sh, h ↔ x)
//    Solihadjayeva ↔ Solixodjayeva
//
//  Shuning uchun taqqoslashdan oldin ism SODDALASHTIRILADI: harf
//  variantlari bitta shaklga keltiriladi, apostroflar olib tashlanadi,
//  "o'g'li" va "qizi" kabi qo'shimchalar kesiladi.
// ---------------------------------------------------------------------

function normalize(name) {
  return name
    .toLowerCase()
    .replace(/[''''`ʻʼ]/g, '')
    .replace(/x/g, 'h')          // Axror = Ahror
    .replace(/q/g, 'k')          // Masodiqov = Masadikov
    .replace(/ch/g, 'c')
    .replace(/sh/g, 's')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 *  Ism-sharifdan qo'shimchalarni kesib, [familiya, qolgani] qaytaradi.
 *
 *  Qolgan BARCHA so'z birlashtiriladi, faqat ikkinchisi emas. Sababi:
 *  "Karimov Muhammad Yusuf" da ikkinchi so'z "Muhammad" bo'lib qoladi
 *  va u Muhammad bilan boshlanadigan har qanday ismga — Muhammadali,
 *  Muhammadamin, Muhammadsolih — mos kelib ketadi. Bunday ismlar esa
 *  bu ro'yxatda o'nlab.
 */
function parts(name) {
  const words = normalize(name)
    .split(' ')
    .filter((w) => !['ogli', 'oglі', 'qizi', 'kizi', 'ugli'].includes(w));
  return [words[0] ?? '', words.slice(1).join('')];
}

/** Ikki so'z orasidagi tahrir masofasi. */
function distance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 *  Ikki ism bir odamnikimi?
 *
 *  Qoidalar ATAYLAB qattiq. Birinchi urinishda ular bo'shroq edi va
 *  natijada butunlay boshqa bolalar birlashtirildi:
 *
 *    Zufarov Muhammad      → Umarov Muhammadmustafo
 *    Xakimov Muhammadyusuf → Xalilov Muhammadyusufxon
 *    Akbarov Hasan         → Akbarov Husan       (EGIZAKLAR!)
 *    Kamalova Mohina       → Kamalova Shahina
 *    Anvarov Muhammadsodiq → Anvarov M Umarxon
 *
 *  Oxirgisi eng xavflisi: bitta "M" harfi har qanday ismning boshiga
 *  mos keladi. Shuning uchun qisqartma bilan solishtirilmaydi.
 *
 *  Xato birlashtirish xato ajratishdan YOMONROQ: ajralib qolgan
 *  ikkita yozuvni ko'rish oson va qo'lda qo'shib yuboriladi, birlashib
 *  ketgan ikki bolaning esa bittasi umuman yo'qoladi va buni hech kim
 *  sezmaydi.
 */
function sameName(a, b) {
  const [sa, na] = parts(a);
  const [sb, nb] = parts(b);
  if (!sa || !sb) return false;

  //  Familiya: bir xil yoki BITTA harf farqi (yozuv varianti).
  //  Ikkita farqga yo'l qo'yilsa "Zufarov" va "Umarov" mos keladi.
  const surnameOk = sa === sb || distance(sa, sb) <= 1;
  if (!surnameOk) return false;

  if (!na || !nb) return true;

  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;

  //  "Ismoil" → "Ismoilxon": to'liq boshlanish mos kelsa, bir odam.
  //  Qisqartma (1-3 harf) hisobga olinmaydi.
  if (short.length >= 4 && long.startsWith(short)) return true;

  //  Bitta harf farqi — faqat UZUN ismlarda. "Abubakr"/"Abubakir" — ha,
  //  "Hasan"/"Husan" — yo'q, chunki bular ikki xil ism.
  return short.length >= 6 && distance(na, nb) <= 1;
}

// ---------------------------------------------------------------------
//  TAYYORLASH
// ---------------------------------------------------------------------

const report = { merged: [], added: [], dupInGroup: [], crossGroup: [], noPrice: [] };

//  Barcha o'quvchilar bitta ro'yxatga — guruhi va narxi bilan.
const roster = [];
for (const g of GROUPS) {
  for (const [name, price] of g.students) {
    //  Ayni guruh ichida takror: manbada bir odam ikki marta yozilgan.
    const twin = roster.find((r) => r.group === g.name && sameName(r.name, name));
    if (twin) {
      report.dupInGroup.push({ group: g.name, kept: twin.name, dropped: name });
      continue;
    }

    //  Boshqa guruhda ham bor: odatda lager. O'quvchi BITTA sinfga
    //  tegishli bo'ladi, shuning uchun birinchi uchragani saqlanadi.
    const other = roster.find((r) => sameName(r.name, name));
    if (other) {
      report.crossGroup.push({
        name, keptIn: other.group, alsoIn: g.name, price,
      });
      continue;
    }

    if (price === null) report.noPrice.push({ group: g.name, name });
    roster.push({ group: g.name, name, price, full: null });
  }
}

//  Rasmiy ro'yxatni moslash.
for (const [group, full] of REGISTER) {
  //  Avval o'sha guruh ichida, keyin butun maktab bo'yicha qidiriladi:
  //  rasmiy ro'yxatdagi sinf to'lov ro'yxatidagidan farq qilishi mumkin.
  const inGroup = roster.find((r) => r.group === group && sameName(r.name, full));
  const anywhere = inGroup ?? roster.find((r) => sameName(r.name, full));

  if (anywhere) {
    if (!anywhere.full) {
      anywhere.full = full;
      report.merged.push({
        short: anywhere.name, full, group: anywhere.group,
        note: inGroup ? null : `ro'yxatda ${group}, to'lovda ${anywhere.group}`,
      });
    }
    continue;
  }

  report.added.push({ group, name: full });
  roster.push({ group, name: full, price: null, full });
}

// ---------------------------------------------------------------------
//  HISOBOT
// ---------------------------------------------------------------------

const line = (n = 70) => console.log('─'.repeat(n));

console.log('');
line();
console.log('  Turon Ilm Xazinasi — ro\'yxatni kiritish');
line();
console.log('');

const groupNames = [...new Set(roster.map((r) => r.group))];
console.log(`  Guruh        : ${groupNames.length} ta`);
console.log(`  O'quvchi     : ${roster.length} ta`);
console.log(`  Shartnoma    : ${roster.filter((r) => r.price !== null).length} ta`);
console.log(`  O'quv yili   : ${YEAR}, boshlanish ${STARTS_ON}`);
console.log('');

if (report.merged.length) {
  console.log(`  Rasmiy ism bilan birlashtirildi — ${report.merged.length} ta:`);
  for (const m of report.merged) {
    console.log(`    ${m.short}  →  ${m.full}${m.note ? `   [${m.note}]` : ''}`);
  }
  console.log('');
}

if (report.added.length) {
  console.log(`  To'lov ro'yxatida yo'q, qo'shildi — ${report.added.length} ta:`);
  for (const a of report.added) console.log(`    ${a.group}: ${a.name}`);
  console.log('');
}

if (report.dupInGroup.length) {
  console.log(`  Guruh ichida takror — ${report.dupInGroup.length} ta:`);
  for (const d of report.dupInGroup) {
    console.log(`    ${d.group}: "${d.dropped}" tashlandi ("${d.kept}" qoldi)`);
  }
  console.log('');
}

if (report.crossGroup.length) {
  console.log(`  Ikki guruhda uchradi — ${report.crossGroup.length} ta:`);
  for (const c of report.crossGroup) {
    console.log(`    ${c.name}: ${c.keptIn} da qoldi, ${c.alsoIn} dan tashlandi`);
  }
  console.log('');
  console.log('    O\'quvchi bitta sinfga tegishli bo\'ladi. Agar lagerga');
  console.log('    qatnashi ham hisobga olinishi kerak bo\'lsa, uni keyin');
  console.log('    XIZMAT sifatida qo\'shish to\'g\'ri bo\'ladi.');
  console.log('');
}

if (report.noPrice.length) {
  console.log(`  Narxi ko'rsatilmagan — ${report.noPrice.length} ta (shartnomasiz):`);
  for (const n of report.noPrice) console.log(`    ${n.group}: ${n.name}`);
  console.log('');
}

line();
for (const g of groupNames) {
  const rows = roster.filter((r) => r.group === g);
  const withPrice = rows.filter((r) => r.price !== null);
  const sum = withPrice.reduce((a, r) => a + r.price * 1000, 0);
  console.log(
    `  ${g.padEnd(11)} ${String(rows.length).padStart(3)} o'quvchi   `
    + `oylik jami: ${sum.toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`,
  );
}
line();

const monthly = roster
  .filter((r) => r.price !== null)
  .reduce((a, r) => a + r.price * 1000, 0);
console.log(`  Oyiga jami: ${monthly.toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`);
line();
console.log('');

if (!CONFIRM) {
  console.log('  Hech narsa yozilmadi. Yozish uchun:');
  console.log('    node scripts/import-turon.mjs --confirm');
  console.log('');
  process.exit(0);
}

// ---------------------------------------------------------------------
//  YOZISH
// ---------------------------------------------------------------------

const [school] = await sql(`
  select s.id, s.name,
         (select b.id from public.branches b
           where b.school_id = s.id and b.deleted_at is null
           order by b.created_at limit 1) as branch_id
    from public.schools s
   where s.deleted_at is null
     and (s.name ilike '%turon%' or s.name ilike '%truon%')
   limit 1;
`);

if (!school?.id) throw new Error('Turon maktabi topilmadi');
if (!school.branch_id) throw new Error('Maktabda filial yo\'q');

console.log(`  Maktab: ${school.name}  (${school.id})`);

//  Nomdagi harf xatosi tuzatiladi: "Truon" → "Turon".
if (school.name !== 'Turon Ilm Xazinasi') {
  await sql(`
    update public.schools set name = 'Turon Ilm Xazinasi' where id = ${q(school.id)};
  `);
  console.log(`  Nomi tuzatildi: "${school.name}" → "Turon Ilm Xazinasi"`);
}

// --- Sinflar ----------------------------------------------------------
const classRows = groupNames.map((name) => {
  const g = GROUPS.find((x) => x.name === name);
  const note = g?.lang ? `O'qitish tili: ${g.lang}` : null;
  return `(${q(school.id)}, ${q(school.branch_id)}, ${q(name)}, `
    + `${g?.grade ?? 'null'}, ${q(YEAR)}, true, ${q(note)})`;
});

await sql(`
  insert into public.classes
    (school_id, branch_id, name, grade_level, academic_year, is_active, note)
  values ${classRows.join(',\n         ')};
`);
console.log(`  ${classRows.length} ta sinf yaratildi`);

const classes = await sql(`
  select id, name from public.classes
   where school_id = ${q(school.id)} and academic_year = ${q(YEAR)};
`);
const classId = Object.fromEntries(classes.map((c) => [c.name, c.id]));

// --- O'quvchilar -------------------------------------------------------
//  Bo'laklab yuboriladi: bitta so'rovda 229 ta qator uzun bo'lib
//  ketadi va xato bo'lsa qaysi qatordan ekanini topish qiyin.
const CHUNK = 60;
for (let i = 0; i < roster.length; i += CHUNK) {
  const slice = roster.slice(i, i + CHUNK);
  const values = slice.map((r) =>
    `(${q(school.id)}, ${q(school.branch_id)}, ${q(r.full ?? r.name)}, `
    + `${q(classId[r.group])}, ${q(STARTS_ON)}, 'active')`);

  await sql(`
    insert into public.students
      (school_id, branch_id, full_name, class_id, enrolled_on, status)
    values ${values.join(',\n           ')};
  `);
}
console.log(`  ${roster.length} ta o'quvchi qo'shildi`);

// --- Shartnomalar -------------------------------------------------------
const created = await sql(`
  select id, full_name, class_id from public.students
   where school_id = ${q(school.id)} and enrolled_on = ${q(STARTS_ON)};
`);

const byName = new Map();
for (const s of created) byName.set(`${s.class_id}|${s.full_name}`, s.id);

let contracts = 0;
const withPrice = roster.filter((r) => r.price !== null);

for (let i = 0; i < withPrice.length; i += CHUNK) {
  const slice = withPrice.slice(i, i + CHUNK);
  const values = [];

  for (const r of slice) {
    const id = byName.get(`${classId[r.group]}|${r.full ?? r.name}`);
    if (!id) {
      console.log(`  ! shartnoma yaratilmadi: ${r.name} (${r.group})`);
      continue;
    }
    contracts += 1;
    values.push(
      `(${q(school.id)}, ${q(id)}, ${q(`SH-2026-${String(contracts).padStart(4, '0')}`)}, `
      + `${q(SIGNED_ON)}, ${q(STARTS_ON)}, ${r.price * 1000}, 10, 12, true)`);
  }

  if (values.length === 0) continue;
  await sql(`
    insert into public.contracts
      (school_id, student_id, number, signed_on, starts_on,
       tuition_amount, due_day, billing_months, is_active)
    values ${values.join(',\n           ')};
  `);
}
console.log(`  ${contracts} ta shartnoma yaratildi`);

console.log('');
line();
console.log('  Tayyor.');
line();
console.log('');
