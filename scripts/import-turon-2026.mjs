// =====================================================================
//  TURON — 2026/2027 ro'yxatini bazaga kiritish
//
//  Skript IDEMPOTENT emas: maktab TOZA bo'lishi kutiladi. Ikki marta
//  ishlatilsa hamma narsa ikkilanadi, shuning uchun boshida
//  tekshiriladi.
//
//    node scripts/import-turon-2026.mjs --dry
//    node scripts/import-turon-2026.mjs
// =====================================================================

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CLASSES, TEACHERS, UNNAMED } from './turon-2026-data.mjs';

const DRY = process.argv.includes('--dry');
const SCHOOL = 'Turon Ilm Xazinasi';
const YEAR = '2026/2027';
const START = '2026-09-01';

/**
 *  So'rovni bajaradi.
 *
 *  Uzun so'rov FAYL orqali yuboriladi: Windows da buyruq qatori
 *  ~8000 belgidan uzun bo'lolmaydi va 200 qatorli `insert` o'sha
 *  chegaradan oshib ketadi. Xatosi esa chalg'ituvchi: buyruq
 *  umuman ishga tushmaydi va sabab ko'rinmaydi.
 */
function sql(q) {
  const args = q.length > 6000
    ? (() => {
        const f = `${tmpdir()}/maktab-import-${Date.now()}.sql`;
        writeFileSync(f, q);
        return ['scripts/db.mjs', 'file', f];
      })()
    : ['scripts/db.mjs', 'sql', q];

  const out = execFileSync('node', args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

/** SQL matn qiymati — apostrof ikkilantiriladi. */
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// --- Maktab va filial -------------------------------------------------
const [school] = sql(`
  select s.id as school_id, b.id as branch_id
    from public.schools s
    join public.branches b on b.school_id = s.id
   where s.name = ${q(SCHOOL)}
   limit 1`);

if (!school) throw new Error('Maktab topilmadi');

const [before] = sql(`
  select
    (select count(*) from public.students  where school_id = ${q(school.school_id)}) as students,
    (select count(*) from public.classes   where school_id = ${q(school.school_id)}) as classes,
    (select count(*) from public.teachers  where school_id = ${q(school.school_id)}) as teachers`);

console.log(`Maktab: ${SCHOOL}`);
console.log(`Hozir: ${before.students} o'quvchi, ${before.classes} sinf, ${before.teachers} xodim\n`);

if (Number(before.students) > 0 || Number(before.classes) > 0
    || Number(before.teachers) > 0) {
  console.error('MAKTAB BO\'SH EMAS. Skript faqat toza maktab uchun.');
  process.exit(1);
}

// --- Rejani chiqarish --------------------------------------------------
let nStudents = 0, nContracts = 0, monthly = 0;
const noPrice = [];
const dupNames = new Map();

for (const c of CLASSES) {
  for (const [name, price] of c.students) {
    const key = name.toLowerCase().replace(/[^a-z ]/g, '');
    dupNames.set(key, (dupNames.get(key) ?? 0) + 1);
    nStudents++;
    if (price === null) noPrice.push(`${name} [${c.name}]`);
    else { nContracts++; monthly += price * 1000; }
  }
}

console.log(`Kiritiladi: ${CLASSES.length} sinf, ${nStudents} o'quvchi, `
  + `${nContracts} shartnoma, ${monthly.toLocaleString('ru-RU')} so'm/oy`);
console.log(`Narxsiz (shartnomasiz): ${noPrice.length}`);
console.log(`Xodim: ${TEACHERS.length}, sinf rahbari: ${TEACHERS.filter((t) => t.class).length}\n`);

if (DRY) {
  for (const n of noPrice) console.log('  narxsiz:', n);
  const dups = [...dupNames.entries()].filter(([, v]) => v > 1);
  for (const [k, v] of dups) console.log(`  TAKROR: ${k} — ${v} marta`);
  console.log('\n(quruq yugurish — hech narsa yozilmadi)');
  process.exit(0);
}

// --- Sinflar -----------------------------------------------------------
const values = CLASSES.map((c) =>
  `(${q(school.school_id)}, ${q(school.branch_id)}, ${q(c.name)}, `
  + `${c.grade ?? 'null'}, ${q(YEAR)}, ${q(c.lang ? `O'qitish tili: ${c.lang}` : null)}, true)`
).join(',\n    ');

sql(`
  insert into public.classes
    (school_id, branch_id, name, grade_level, academic_year, note, is_active)
  values
    ${values}`);

const classIds = new Map(
  sql(`select id, name from public.classes where school_id = ${q(school.school_id)}`)
    .map((r) => [r.name, r.id]),
);
console.log(`Sinflar: ${classIds.size}`);

// --- O'quvchilar --------------------------------------------------------
//  Bitta so'rovda hammasi: 200 ta alohida so'rov sekin va yarim
//  yo'lda uzilsa qaysi biri kirganini topish qiyin bo'lardi.
const seen = new Set();
const rows = [];
const skipped = [];

for (const c of CLASSES) {
  for (const [name] of c.students) {
    const key = `${c.name}|${name.toLowerCase()}`;
    if (seen.has(key)) { skipped.push(`${name} [${c.name}]`); continue; }
    seen.add(key);
    rows.push(
      `(${q(school.school_id)}, ${q(school.branch_id)}, ${q(classIds.get(c.name))}, `
      + `${q(name)}, ${c.grade ?? 'null'}, ${q(START)}, 'active')`,
    );
  }
}

sql(`
  insert into public.students
    (school_id, branch_id, class_id, full_name, grade_level, enrolled_on, status)
  values
    ${rows.join(',\n    ')}`);

console.log(`O'quvchilar: ${rows.length}`);
if (skipped.length) {
  console.log(`  TAKROR yozuv o'tkazib yuborildi: ${skipped.join(', ')}`);
}

// --- Shartnomalar --------------------------------------------------------
const ids = new Map(
  sql(`select id, full_name, class_id from public.students
        where school_id = ${q(school.school_id)}`)
    .map((r) => [`${r.class_id}|${r.full_name}`, r.id]),
);

let no = 0;
const contracts = [];
for (const c of CLASSES) {
  const cid = classIds.get(c.name);
  const done = new Set();
  for (const [name, price] of c.students) {
    if (price === null) continue;
    const k = `${cid}|${name}`;
    if (done.has(k)) continue;
    done.add(k);
    const sid = ids.get(k);
    if (!sid) throw new Error(`O'quvchi topilmadi: ${name} [${c.name}]`);
    no++;
    contracts.push(
      `(${q(school.school_id)}, ${q(sid)}, `
      + `${q(`SH-2026-${String(no).padStart(4, '0')}`)}, `
      + `current_date, ${q(START)}, ${price * 1000}, 10, 12, true)`,
    );
  }
}

sql(`
  insert into public.contracts
    (school_id, student_id, number, signed_on, starts_on,
     tuition_amount, due_day, billing_months, is_active)
  values
    ${contracts.join(',\n    ')}`);

console.log(`Shartnomalar: ${contracts.length}`);

// --- Xodimlar -------------------------------------------------------------
const tRows = TEACHERS.map((t) =>
  `(${q(school.school_id)}, ${q(t.name)}, ${q(t.subject ?? null)}, `
  + `${t.factor ?? 1}, ${t.salary}, ${q(START)}, true, ${q(t.note ?? null)})`
).join(',\n    ');

sql(`
  insert into public.teachers
    (school_id, full_name, category, rate_factor, base_salary, hired_on,
     is_active, note)
  values
    ${tRows}`);

const teacherIds = new Map(
  sql(`select id, full_name from public.teachers where school_id = ${q(school.school_id)}`)
    .map((r) => [r.full_name, r.id]),
);

//  Filial biriktirish — busiz oylikni tasdiqlab bo'lmaydi.
sql(`
  insert into public.teacher_branches (teacher_id, branch_id, load_share)
  select t.id, ${q(school.branch_id)}, 1.0
    from public.teachers t
   where t.school_id = ${q(school.school_id)}`);

console.log(`Xodimlar: ${teacherIds.size}`);

// --- Sinf rahbarlari --------------------------------------------------------
let linked = 0;
for (const t of TEACHERS) {
  if (!t.class) continue;
  const cid = classIds.get(t.class);
  const tid = teacherIds.get(t.name);
  if (!cid || !tid) {
    console.log(`  BOG'LANMADI: ${t.name} → ${t.class}`);
    continue;
  }
  sql(`update public.classes set teacher_id = ${q(tid)} where id = ${q(cid)}`);
  linked++;
}
console.log(`Sinf rahbari biriktirildi: ${linked}`);

// --- Yakuniy holat -----------------------------------------------------------
const [after] = sql(`
  select
    (select count(*) from public.students  where school_id = ${q(school.school_id)}) as students,
    (select count(*) from public.classes   where school_id = ${q(school.school_id)}) as classes,
    (select count(*) from public.contracts where school_id = ${q(school.school_id)}) as contracts,
    (select count(*) from public.teachers  where school_id = ${q(school.school_id)}) as teachers,
    (select coalesce(sum(tuition_amount),0)::bigint from public.contracts
      where school_id = ${q(school.school_id)} and is_active) as monthly,
    (select coalesce(sum(base_salary * rate_factor),0)::bigint from public.teachers
      where school_id = ${q(school.school_id)} and deleted_at is null) as payroll`);

console.log('\n--- NATIJA ---');
console.log(`Sinf:        ${after.classes}`);
console.log(`O'quvchi:    ${after.students}`);
console.log(`Shartnoma:   ${after.contracts}`);
console.log(`Xodim:       ${after.teachers}`);
console.log(`Oylik tushum:  ${Number(after.monthly).toLocaleString('ru-RU')} so'm`);
console.log(`Oylik xarajat: ${Number(after.payroll).toLocaleString('ru-RU')} so'm`);
console.log(`Farq:          ${(Number(after.monthly) - Number(after.payroll)).toLocaleString('ru-RU')} so'm`);

if (noPrice.length) {
  console.log(`\nNarxi ko'rsatilmagan — shartnomasiz qoldi (${noPrice.length}):`);
  for (const n of noPrice) console.log('  ', n);
}
if (UNNAMED.length) {
  console.log(`\nIsmi ko'rsatilmagan — kiritilmadi (${UNNAMED.length}):`);
  for (const u of UNNAMED) {
    console.log(`   ${u.subject ?? "fani ko'rsatilmagan"} — ${u.salary.toLocaleString('ru-RU')} so'm`);
  }
}
