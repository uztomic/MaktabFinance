#!/usr/bin/env node
// =====================================================================
//  seed-demo-edu.mjs — "Uztomic Edu" NAMUNA maktabi: 3 filial,
//  ~250 / 238 / 236 o'quvchi, sentabrdan bugungacha haqiqiy ish
//  (sentabr–oktabr yopilgan, noyabr — JORIY, dekabr hisoblanmasi tayyor).
//
//  FAQAT shu nomli maktabga tegadi: boshqa maktablar (Turon) joyida.
//  Qayta ishga tushirilsa — eski "Uztomic Edu" o'chiriladi va qaytadan
//  quriladi.
//
//    node scripts/seed-demo-edu.mjs            # ko'rsatadi
//    node scripts/seed-demo-edu.mjs --confirm  # quradi
// =====================================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generatePassword } from './password.mjs';
import {
  FEMALE_NAMES, MALE_NAMES, SURNAMES,
  chance, feminize, phone, pick, reseed, rint, rnd, shuffle,
} from './seed-names.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// =====================================================================
//  Ulanish
// =====================================================================

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
const URL_BASE = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TOKEN || !REF || !URL_BASE || !SERVICE) {
  console.error(
    '\nXATO: .env.local da SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF,\n' +
    'VITE_SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY bo\'lishi kerak.\n');
  process.exit(1);
}

const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

/** SQL bajaradi. Xato bo'lsa to'xtaydi — yarim qurilgan baza kerak emas. */
async function sql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error('\n╭─ SQL XATO ' + '─'.repeat(50));
    console.error(text.slice(0, 900));
    console.error('╰' + '─'.repeat(61) + '\n');
    throw new Error('SQL yiqildi');
  }
  return text ? JSON.parse(text) : [];
}

/** SQL matn literali — apostrof ikkilanadi. */
const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
/** SQL sana literali. */
const d = (v) => (v ? `'${v}'::date` : 'null');
/** SQL son. */
const n = (v) => (v === null || v === undefined ? 'null' : String(v));

// =====================================================================
//  Sana yordamchilari
// =====================================================================

const iso = (dt) => dt.toISOString().slice(0, 10);
const monthStart = (y, m) => new Date(Date.UTC(y, m - 1, 1));
const addMonths = (dt, k) =>
  new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + k, dt.getUTCDate()));
const addDays = (dt, k) =>
  new Date(dt.getTime() + k * 86400000);
const monthEnd = (dt) =>
  new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));

// =====================================================================
//  Ko'rsatkichlar
// =====================================================================

const SCHOOL = 'Uztomic Edu';
const BRANCH = 'Chilonzor filiali';
const DOMAIN = 'uztomicedu.uz';
/** Filiallar va o'quvchi soni. Birinchisi provision_school bilan. */
const BRANCHES = [
  { name: 'Chilonzor filiali', size: 250, address: 'Toshkent sh., Chilonzor t., Bunyodkor ko‘chasi 12' },
  { name: 'Yunusobod filiali', size: 238, address: 'Toshkent sh., Yunusobod t., Amir Temur ko‘chasi 108' },
  { name: 'Sergeli filiali',   size: 236, address: 'Toshkent sh., Sergeli t., Yangi Sergeli ko‘chasi 5' },
];
const YEAR = '2026/2027';
/** Bugungi oy — hisoblanma tuziladi, lekin yakunlanmaydi. */
const CURRENT = (() => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth(), 1)); })();
const TODAY = (() => { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())); })();

/** Birinchi va oxirgi davr. */
const FIRST = monthStart(2026, 9);
const LAST = CURRENT;
const MONTHS = (LAST.getUTCFullYear() - FIRST.getUTCFullYear()) * 12 + LAST.getUTCMonth() - FIRST.getUTCMonth() + 1;

/** O'qish to'lovi — bosqich bo'yicha, 2024/25 uchun. */
const TUITION = {
  0: 1_400_000,   // bog'cha
  1: 1_800_000, 2: 1_800_000, 3: 1_800_000, 4: 1_800_000,
  5: 2_100_000, 6: 2_100_000, 7: 2_100_000, 8: 2_100_000, 9: 2_100_000,
};
/** Sozlamalar → Tariflar. */
const PLANS = [
  { name: 'Bog‘cha', from: 0, to: 0, amount: 1_400_000 },
  { name: 'Boshlang‘ich sinflar (1–4)', from: 1, to: 4, amount: 1_800_000 },
  { name: 'Yuqori sinflar (5–9)', from: 5, to: 9, amount: 2_100_000 },
];
/** 2025/26 da narx 15% oshgan. */
const RAISE = 1.15;

const step = (i, total, text) =>
  console.log(`  [${String(i).padStart(2)}/${total}] ${text}`);

// =====================================================================
//  B1 — TOZALASH
// =====================================================================

/** Bog'liqlik tartibida — bola jadval avval. */
const WIPE_ORDER = [
  'payroll_lines', 'payroll_runs', 'teacher_advances', 'teacher_allowances',
  'expenses', 'lessons',
  'cash_receipts', 'payment_proofs', 'payments',
  'bank_statement_rows', 'bank_statements',
  'invoice_lines', 'invoices',
  'attendance_checks', 'absences',
  'student_services', 'service_prices', 'services',
  'contract_versions', 'contracts',
  'lead_events', 'leads',
  'closed_periods', 'audit_log', 'message_queue', 'impersonation_log',
  'impersonation_sessions', 'platform_log',
  'school_settings', 'payroll_settings', 'discount_types', 'absence_reasons',
  'expense_categories', 'calendar_days', 'counters', 'lookups', 'translations',
  'school_subscriptions',
];

async function wipe() {
  // O'quvchi–sinf va o'quvchi–ota-ona bog'lanishlari alohida: ularda
  // `school_id` yo'q, ota jadval orqali o'chiriladi.
  await sql(`
    set session_replication_role = replica;
    do $$
    declare s uuid;
    begin
      for s in select id from public.schools where name = ${q(SCHOOL)} loop
        delete from public.student_parents where student_id in
          (select id from public.students where school_id = s);
        delete from public.teacher_branches where teacher_id in
          (select id from public.teachers where school_id = s);
        delete from public.user_branches where user_id in
          (select id from public.app_users where school_id = s);
        delete from public.user_permissions where user_id in
          (select id from public.app_users where school_id = s);
        declare tb text; begin
          for tb in select c.table_name from information_schema.columns c
              join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'school_id' and x.table_type = 'BASE TABLE'
               and c.table_name not in ('schools','students','classes','parents','teachers','app_users','branches')
          loop
            begin
              execute format('delete from public.%I where school_id = $1', tb) using s;
            exception when foreign_key_violation then null;
            end;
          end loop;
          for tb in select c.table_name from information_schema.columns c
              join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
             where c.table_schema = 'public' and c.column_name = 'school_id' and x.table_type = 'BASE TABLE'
               and c.table_name not in ('schools','students','classes','parents','teachers','app_users','branches')
          loop
            execute format('delete from public.%I where school_id = $1', tb) using s;
          end loop;
        end;
        -- O'quvchi sinfga bog'langan: avval bog'lanishni uzamiz.
        update public.students set class_id = null where school_id = s;
        delete from public.students where school_id = s;
        delete from public.classes  where school_id = s;
        delete from public.parents  where school_id = s;
        delete from public.teachers where school_id = s;
        -- auth.users o'chsa app_users CASCADE bilan ketadi.
        delete from auth.users where id in
          (select id from public.app_users where school_id = s);
        delete from public.app_users where school_id = s;
        delete from public.branches  where school_id = s;
        delete from public.schools   where id = s;
      end loop;
    end $$;
  `);

  // Telegram jadvallariga TEGILMAYDI — ular boshqa maktabniki ham.
}

// =====================================================================
//  B2 — MAKTAB, FILIAL, KALENDAR
// =====================================================================

async function createSchool() {
  const [row] = await sql(`
    select public.provision_school(
      ${q(SCHOOL)}, ${q(BRANCH)}, 'standard', 30,
      ${q(BRANCHES[0].address)},
      ${q('998712001234')}
    ) as result
  `);
  const res = row.result;
  await sql(`update public.schools set status = 'active' where id = ${q(res.school_id)};`);
  await sql(`update public.branches set address = ${q(BRANCHES[0].address)} where id = ${q(res.branch_id)};`);
  const ids = [res.branch_id];
  for (const b of BRANCHES.slice(1)) {
    const [r2] = await sql(`
      insert into public.branches (school_id, name, address, phone, is_active)
      values (${q(res.school_id)}, ${q(b.name)}, ${q(b.address)}, ${q(phone())}, true)
      returning id;
    `);
    ids.push(r2.id);
  }
  return { school_id: res.school_id, branch_ids: ids };
}

/**
 * Kalendar: dam olish kunlari va O'zbekiston bayramlari.
 *
 * Busiz kunlik xizmat ish kunlarini noto'g'ri sanaydi — shanba-yakshanba
 * ham hisobga qo'shilib ketardi.
 */
async function fillCalendar(schoolId, branchId) {
  const HOLIDAYS = [
    ['01-01', 'Yangi yil'],
    ['03-08', 'Xotin-qizlar kuni'],
    ['03-21', 'Navro‘z'],
    ['05-09', 'Xotira va qadrlash kuni'],
    ['09-01', 'Mustaqillik kuni'],
    ['10-01', 'Ustoz va murabbiylar kuni'],
    ['12-08', 'Konstitutsiya kuni'],
  ];

  const rows = [];
  for (const year of [2026, 2027]) {
    for (const [md, name] of HOLIDAYS) {
      rows.push(`(${q(schoolId)}, ${q(branchId)}, ${d(`${year}-${md}`)}, 'holiday', ${q(name)})`);
    }
  }

  // Yozgi ta'til — iyul va avgust (bog'cha ishlaydi, maktab yo'q,
  // lekin kunlik xizmat baribir hisoblanmaydi).
  for (const year of [2027]) {
    rows.push(`(${q(schoolId)}, ${q(branchId)}, ${d(`${year}-07-01`)}, 'vacation', 'Yozgi ta''til')`);
  }

  await sql(`
    insert into public.calendar_days (school_id, branch_id, day, day_type, name)
    values ${rows.join(',\n           ')}
    on conflict do nothing;
  `);
}

// =====================================================================
//  B3 — XODIMLAR
// =====================================================================

const STAFF = [
  { login: 'direktor',   role: 'director',   name: 'Rahmonov Otabek',      title: 'Direktor (ega)' },
  { login: 'buxgalter',  role: 'accountant', name: 'Karimova Nilufar',     title: 'Bosh buxgalter' },
  { login: 'buxgalter2', role: 'accountant', name: 'Sultonova Dilnoza',    title: 'Buxgalter' },
  { login: 'menejer',    role: 'manager',    name: 'Yusupov Sanjar',       title: 'Qabul menejeri' },
  { login: 'navbatchi',  role: 'duty',       name: 'Ergasheva Zilola',     title: 'Navbatchi' },
  { login: 'ustoz1',     role: 'teacher',    name: 'Abdullayeva Gulnoza',  title: 'O‘qituvchi' },
  { login: 'ustoz2',     role: 'teacher',    name: 'Mirzayev Jasur',       title: 'O‘qituvchi' },
  { login: 'ustoz3',     role: 'teacher',    name: 'Nazarova Sevara',      title: 'O‘qituvchi' },
];

async function createAuthUser(email, password, fullName) {
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`${email}: ${body?.msg ?? body?.message ?? res.status}`);
  }
  return body.id;
}

async function createStaff(schoolId) {
  const created = [];

  for (const s of STAFF) {
    const email = `${s.login}@${DOMAIN}`;
    const password = generatePassword();
    const id = await createAuthUser(email, password, s.name);

    await sql(`
      insert into public.app_users
        (id, school_id, role, full_name, email, phone, all_branches, is_active)
      values (${q(id)}, ${q(schoolId)}, ${q(s.role)}, ${q(s.name)},
              ${q(email)}, ${q(phone())}, true, true);
    `);

    created.push({ ...s, email, password, id });
  }

  return created;
}

// =====================================================================
//  B3b — O'QITUVCHILAR
// =====================================================================

const SUBJECTS = [
  'Boshlang‘ich sinf', 'Matematika', 'Ona tili va adabiyot', 'Ingliz tili',
  'Rus tili', 'Tarix', 'Geografiya', 'Biologiya', 'Fizika', 'Kimyo',
  'Informatika', 'Jismoniy tarbiya', 'Musiqa', 'Tasviriy san’at',
  'Tarbiyachi', 'Tarbiyachi yordamchisi',
];

// Toifa → oylik oralig'i (100 000 so'mda). Yuqori toifa ko'proq oladi.
const TEACHER_CATEGORIES = [
  { name: 'Oliy toifa',      min: 58, max: 68, factor: 1.2  },
  { name: 'Birinchi toifa',  min: 50, max: 58, factor: 1.1  },
  { name: 'Ikkinchi toifa',  min: 45, max: 51, factor: 1.05 },
  { name: 'Toifasiz',        min: 40, max: 46, factor: 1    },
  { name: 'Yosh mutaxassis', min: 36, max: 42, factor: 1    },
];

async function createTeachers(schoolId, branchId, staff, count = 22, first = true) {
  const teacherStaff = first ? staff.filter((s) => s.role === 'teacher') : [];
  const rows = [];
  const meta = [];

  for (let i = 0; i < count; i++) {
    const female = chance(0.72);   // maktabda ayol o'qituvchi ko'p
    const sur = pick(SURNAMES);
    const name = female
      ? `${feminize(sur)} ${pick(FEMALE_NAMES)}`
      : `${sur} ${pick(MALE_NAMES)}`;

    // Uchtasi haqiqiy hisob bilan bog'lanadi — PWA ni sinash uchun.
    const linked = i < teacherStaff.length ? teacherStaff[i] : null;
    const fullName = linked ? linked.name : name;

    const cat = pick(TEACHER_CATEGORIES);
    const category = cat.name;
    const rate = pick([1, 1, 1, 1, 1.25, 1.5, 0.5, 0.75]);
    // Oylik TOIFAGA bog'liq. Ilgari ikkalasi mustaqil tanlanardi va
    // "Yosh mutaxassis" oliy toifadan ko'p oladigan holatlar chiqardi —
    // hisobotga qaragan odam darhol ishonmay qolardi.
    const base = rint(cat.min, cat.max) * 100_000;
    const hours = Math.round(rate * 18);
    const hired = iso(addDays(FIRST, -rint(0, 900)));
    void hired;

    rows.push(`(${q(schoolId)}, ${q(fullName)}, ${q(phone())}, ${q(category)},
                ${n(rate)}, ${n(base)}, ${n(hours)}, ${d(hired)},
                ${linked ? q(linked.id) : 'null'}, ${q(pick(SUBJECTS))})`);
    meta.push({ fullName, subject: null });
  }

  await sql(`
    insert into public.teachers
      (school_id, full_name, phone, category, rate_factor, base_salary,
       weekly_hours, hired_on, user_id, note)
    values ${rows.join(',\n           ')};
  `);

  // Har bir o'qituvchi filialga biriktiriladi — busiz oylik xarajati
  // taqsimlanmaydi (TZ 4.11.4).
  await sql(`
    insert into public.teacher_branches (teacher_id, branch_id, load_share)
    select t.id, ${q(branchId)}, 1.0 from public.teachers t
     where t.school_id = ${q(schoolId)}
       and not exists (select 1 from public.teacher_branches tb where tb.teacher_id = t.id);
  `);

  return sql(`
    select t.id, t.full_name from public.teachers t
      join public.teacher_branches tb on tb.teacher_id = t.id
     where t.school_id = ${q(schoolId)} and tb.branch_id = ${q(branchId)}
     order by t.created_at, t.full_name;
  `);
}

// =====================================================================
//  B4 — SINFLAR
// =====================================================================

/** Bog'cha guruhlari + 1–4 sinf A/B + 5–9 sinf. */
const CLASS_PLAN = [
  { name: 'Kichik guruh', grade: 0, cap: 14, size: 9 },
  { name: 'O‘rta guruh',  grade: 0, cap: 16, size: 10 },
  { name: 'Katta guruh',  grade: 0, cap: 18, size: 11 },
  { name: '1-A', grade: 1, cap: 22, size: 9 },
  { name: '1-B', grade: 1, cap: 22, size: 9 },
  { name: '2-A', grade: 2, cap: 22, size: 9 },
  { name: '2-B', grade: 2, cap: 22, size: 9 },
  { name: '3-A', grade: 3, cap: 22, size: 9 },
  { name: '3-B', grade: 3, cap: 22, size: 9 },
  { name: '4-A', grade: 4, cap: 22, size: 9 },
  { name: '4-B', grade: 4, cap: 22, size: 9 },
  { name: '5-A', grade: 5, cap: 24, size: 10 },
  { name: '6-A', grade: 6, cap: 24, size: 10 },
  { name: '7-A', grade: 7, cap: 24, size: 10 },
  { name: '8-A', grade: 8, cap: 24, size: 10 },
  { name: '9-A', grade: 9, cap: 24, size: 10 },
];

/** Filial hajmiga moslab sinf o'lchamlari. */
function planFor(size) {
  const base = CLASS_PLAN.reduce((a, c) => a + c.size, 0);
  const plan = CLASS_PLAN.map((c) => ({ ...c, size: Math.round((c.size * size) / base) }));
  let diff = size - plan.reduce((a, c) => a + c.size, 0);
  for (let i = plan.length - 1; diff !== 0; i = (i - 1 + plan.length) % plan.length) {
    plan[i].size += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  for (const c of plan) c.cap = Math.max(c.cap, c.size + rint(1, 4));
  return plan;
}

async function createClasses(schoolId, branchId, teachers, plan) {
  const rows = [];
  plan.forEach((c, i) => {
    rows.push(`(${q(schoolId)}, ${q(branchId)}, ${q(c.name)}, ${n(c.grade)},
                ${q(teachers[i % teachers.length].id)}, ${n(c.cap)},
                ${q(YEAR)}, true, null)`);
  });

  await sql(`
    insert into public.classes
      (school_id, branch_id, name, grade_level, teacher_id, capacity,
       academic_year, is_active, note)
    values ${rows.join(',\n           ')};
  `);

  return sql(`
    select id, name, grade_level from public.classes
     where branch_id = ${q(branchId)} and academic_year = ${q(YEAR)}
     order by grade_level, name;
  `);
}

// =====================================================================
//  B4.5 — OYLIK SOZLAMASI VA USTAMALAR
//
//  `provision_school` oylik sozlamasini BO'SH qiymatlar bilan qoldiradi:
//  soat narxi 0, ustamalar 0, ushlanmalar yo'q. Bu to'g'ri — bular pul
//  va har maktabda boshqacha, dastur ularni o'ylab topmasligi kerak.
//
//  Lekin DEMO maktabda ular to'ldirilishi shart. Aks holda oylik
//  sahifasi ochilganda hamma o'qituvchida ushlanma 0 turadi, sinf
//  rahbarligi ustamasi ko'rinmaydi va o'rniga kirilgan darslar
//  "3 soat × 0 so'm" bo'lib chiqadi.
// =====================================================================

async function configurePayroll(schoolId, teachers, classes) {
  const factors = Object.fromEntries(
    TEACHER_CATEGORIES.map((c) => [c.name, c.factor]),
  );

  const settings = [
    // Bir dars soati. O'rniga kirilgan va o'tkazilmagan darslar shundan.
    ['hour_price', 45_000],
    ['category_factors', factors],
    ['allowances', [
      { code: 'class_teacher', name: 'Sinf rahbarligi',   type: 'percent', value: 15 },
      { code: 'notebooks',     name: 'Daftar tekshirish', type: 'fixed',   value: 250_000 },
      { code: 'club',          name: "To'garak",          type: 'fixed',   value: 300_000 },
    ]],
    ['deductions', [
      { code: 'income_tax', name: "Daromad solig'i (JShDS)", type: 'percent', value: 12 },
    ]],
  ];

  //  `effective_from` — sikl boshlangan oy. Shunda 24 oylik tarix
  //  boshidan oxirigacha bir xil qoida bo'yicha hisoblanadi.
  for (const [key, value] of settings) {
    await sql(`
      insert into public.payroll_settings (school_id, key, value, effective_from, note)
      values (${q(schoolId)}, ${q(key)}, ${q(JSON.stringify(value))}::jsonb,
              ${d(iso(FIRST))}, 'Demo maktab uchun sozlangan')
      on conflict (school_id, key, effective_from)
        do update set value = excluded.value;
    `);
  }

  //  Ustama KIMGA tegishli ekani alohida jadvalda. Katalogda turgani
  //  bilan hech kimga tushmaydi — eng ko'p uchraydigan "oyligim kam
  //  chiqibdi" sababi shu.
  const classTeacherIds = new Set(
    (await sql(`
      select distinct teacher_id from public.classes
       where school_id = ${q(schoolId)} and teacher_id is not null;
    `)).map((r) => r.teacher_id),
  );

  const rows = [];
  let clubs = 0;

  for (const t of teachers) {
    if (classTeacherIds.has(t.id)) {
      rows.push([t.id, 'class_teacher', null]);
    } else {
      // Sinf rahbari bo'lmagan fan o'qituvchisi daftar tekshiradi.
      rows.push([t.id, 'notebooks', null]);
    }
    // To'garakni to'rt kishi olib boradi.
    if (clubs < 4 && !classTeacherIds.has(t.id)) {
      rows.push([t.id, 'club', null]);
      clubs += 1;
    }
  }

  await sql(`
    insert into public.teacher_allowances
      (school_id, teacher_id, code, value_override, starts_on)
    values ${rows.map(([id, code]) =>
      `(${q(schoolId)}, ${q(id)}, ${q(code)}, null, ${d(iso(FIRST))})`,
    ).join(',\n           ')};
  `);

  return rows.length;
}

// =====================================================================
//  B5 — XIZMATLAR VA NARX TARIXI
// =====================================================================

const SERVICES = [
  { code: 'meals',     name: 'Ovqatlanish',           type: 'daily',         old: 22_000,  now: 26_000,  sort: 10 },
  { code: 'transport', name: 'Transport',             type: 'monthly_fixed', old: 250_000, now: 290_000, sort: 20 },
  { code: 'extended',  name: 'Kunni uzaytirish',      type: 'monthly_fixed', old: 300_000, now: 350_000, sort: 30 },
  { code: 'english',   name: 'Ingliz tili to‘garagi', type: 'monthly_fixed', old: 200_000, now: 240_000, sort: 40 },
  { code: 'sport',     name: 'Sport seksiyasi',       type: 'monthly_fixed', old: 150_000, now: 180_000, sort: 50 },
  { code: 'books',     name: 'Darslik to‘plami',      type: 'one_time',      old: 400_000, now: 450_000, sort: 60 },
];

async function createServices(schoolId, branchId, accountantId) {
  await sql(`
    insert into public.services (school_id, branch_id, code, name, billing_type, sort_order)
    values ${SERVICES.map((s) =>
      `(${q(schoolId)}, ${q(branchId)}, ${q(s.code)}, ${q(s.name)}, ${q(s.type)}, ${n(s.sort)})`
    ).join(',\n           ')};
  `);

  const list = await sql(`
    select id, code from public.services where branch_id = ${q(branchId)};
  `);
  const byCode = Object.fromEntries(list.map((s) => [s.code, s.id]));

  // Ikki narx: eskisi 2025-08-31 da yopiladi. Shu tufayli o'tgan
  // yilgi hisoblanmalar eski narxda qoladi (TZ 4.4.5).
  const prices = [];
  for (const s of SERVICES) {
    prices.push(`(${q(schoolId)}, ${q(byCode[s.code])}, ${n(s.now)},
                  ${d('2026-09-01')}, null, ${q(accountantId)})`);
  }

  await sql(`
    insert into public.service_prices
      (school_id, service_id, price, valid_from, valid_to, created_by)
    values ${prices.join(',\n           ')};
  `);

  return byCode;
}

// =====================================================================
//  B6 — O'QUVCHILAR, OTA-ONALAR, XIZMATLAR
//
//  Oila birligi: aka-uka yoki opa-singil bitta ota-onaga bog'lanadi
//  va ikkinchisiga "2-farzand" chegirmasi tushadi. Chegirmani sun'iy
//  tarqatish emas, OILADAN kelib chiqarish kerak — aks holda hisobot
//  mantiqan g'alati ko'rinadi: chegirma bor, sababi yo'q.
// =====================================================================

/** Bosqichga mos tug'ilgan sana (2025/26 o'quv yili uchun). */
function birthDate(grade) {
  // Bog'cha 3–6 yosh, 1-sinf 7 yosh, keyin har bosqichda bir yosh.
  const age = grade === 0 ? rint(3, 6) : 6 + grade;
  const year = 2025 - age;
  return iso(new Date(Date.UTC(year, rint(0, 11), rint(1, 28))));
}

function buildStudents(classes, plan) {
  const students = [];
  const families = [];

  for (const cls of classes) {
    const planned = plan.find((c) => c.name === cls.name);
    for (let i = 0; i < planned.size; i++) {
      const female = chance(0.48);
      const sur = pick(SURNAMES);
      students.push({
        class_id: cls.id,
        grade: cls.grade_level,
        female,
        surname: sur,
        full_name: female
          ? `${feminize(sur)} ${pick(FEMALE_NAMES)}`
          : `${sur} ${pick(MALE_NAMES)}`,
        birth_date: birthDate(cls.grade_level),
      });
    }
  }

  // Qabul sanasi: 60% birinchi kundan, 25% ikkinchi yildan,
  // 15% o'quv yili o'rtasida kelgan.
  for (const s of students) {
    const r = rnd();
    if (r < 0.86) s.enrolled_on = iso(new Date(Date.UTC(2026, 8, rint(1, 5))));
    else s.enrolled_on = iso(new Date(Math.min(
      Date.UTC(2026, 8 + rint(0, 2), rint(6, 26)), TODAY.getTime() - 3 * 86400000)));
  }

  // Oilalar: bir familiyali ikki bola bitta ota-onaga.
  const order = shuffle(students.map((_, i) => i));
  const used = new Set();
  for (const a of order) {
    if (families.length >= 12) break;
    if (used.has(a)) continue;
    const b = order.find((x) =>
      x !== a && !used.has(x) && students[x].surname === students[a].surname);
    if (b === undefined) continue;
    used.add(a);
    used.add(b);
    families.push([a, b]);
  }

  return { students, families };
}

async function createStudents(schoolId, branchId, classes, plan) {
  const { students, families } = buildStudents(classes, plan);

  const rows = students.map((s) =>
    `(${q(schoolId)}, ${q(branchId)}, ${q(s.class_id)}, ${q(s.full_name)},
      ${n(s.grade)}, ${d(s.birth_date)}, ${d(s.enrolled_on)}, 'active')`);

  await sql(`
    insert into public.students
      (school_id, branch_id, class_id, full_name, grade_level,
       birth_date, enrolled_on, status)
    values ${rows.join(',\n           ')};
  `);

  // Tartib insert bilan bir xil bo'lsin — `created_at` bo'yicha.
  const saved = await sql(`
    select id from public.students where branch_id = ${q(branchId)}
     order by created_at, full_name;
  `);
  if (saved.length !== students.length) {
    throw new Error(`O'quvchi soni mos emas: ${saved.length} / ${students.length}`);
  }

  // `created_at` bir xil bo'lishi mumkin, shuning uchun nom bo'yicha
  // moslashtirish ishonchliroq.
  const byName = await sql(`
    select id, full_name from public.students where branch_id = ${q(branchId)};
  `);
  const nameMap = new Map();
  for (const r of byName) {
    if (!nameMap.has(r.full_name)) nameMap.set(r.full_name, []);
    nameMap.get(r.full_name).push(r.id);
  }
  for (const s of students) {
    s.id = nameMap.get(s.full_name).pop();
  }

  // --- Ota-onalar ---------------------------------------------------
  const secondChild = new Set(families.map(([, b]) => b));
  const familyOf = new Map();
  families.forEach(([a, b], fi) => { familyOf.set(a, fi); familyOf.set(b, fi); });

  const parents = [];
  const parentOf = new Map();

  students.forEach((s, i) => {
    const fi = familyOf.get(i);
    if (fi !== undefined && parentOf.has(families[fi][0])) {
      parentOf.set(i, parentOf.get(families[fi][0]));
      return;
    }
    parentOf.set(i, parents.length);
    const father = chance(0.55);
    parents.push({
      full_name: father
        ? `${s.surname} ${pick(MALE_NAMES)}`
        : `${feminize(s.surname)} ${pick(FEMALE_NAMES)}`,
      phone: phone(),
      relation: father ? 'father' : 'mother',
      // 40% ota-ona botga ulangan — chek yuborish shu yerdan keladi.
      // NAMUNA: Telegram ID YO'Q — tasodifiy raqam haqiqiy odamga xabar yuborib qo'yardi.
      telegram: null,
      lang: chance(0.15) ? 'ru' : 'uz',
    });
  });

  await sql(`
    insert into public.parents (school_id, full_name, phone, telegram_id, lang)
    values ${parents.map((p) =>
      `(${q(schoolId)}, ${q(p.full_name)}, ${q(p.phone)}, ${n(p.telegram)}, ${q(p.lang)})`
    ).join(',\n           ')};
  `);

  const savedParents = await sql(`
    select id, phone from public.parents where school_id = ${q(schoolId)};
  `);
  const phoneMap = new Map(savedParents.map((p) => [p.phone, p.id]));
  for (const p of parents) p.id = phoneMap.get(p.phone);

  await sql(`
    insert into public.student_parents (student_id, parent_id, relation, is_primary)
    values ${students.map((s, i) => {
      const p = parents[parentOf.get(i)];
      return `(${q(s.id)}, ${q(p.id)}, ${q(p.relation)}, true)`;
    }).join(',\n           ')}
    on conflict do nothing;
  `);

  return { students, secondChild, parents };
}

// =====================================================================
//  B6b — XIZMATLARGA YOZISH
// =====================================================================

async function assignServices(schoolId, students, svc) {
  const rows = [];

  for (const s of students) {
    const from = s.enrolled_on;
    if (chance(0.80)) rows.push([s.id, svc.meals, from]);
    if (chance(0.35)) rows.push([s.id, svc.transport, from]);
    // Kunni uzaytirish — asosan bog'cha va boshlang'ich sinf.
    if (s.grade <= 4 && chance(0.32)) rows.push([s.id, svc.extended, from]);
    if (chance(0.22)) rows.push([s.id, svc.english, from]);
    if (chance(0.18)) rows.push([s.id, svc.sport, from]);
    // Darslik to'plami — bir martalik, faqat maktab sinflari.
    if (s.grade >= 1 && chance(0.55)) rows.push([s.id, svc.books, from]);
  }

  await sql(`
    insert into public.student_services
      (school_id, student_id, service_id, starts_on)
    values ${rows.map(([st, sv, from]) =>
      `(${q(schoolId)}, ${q(st)}, ${q(sv)}, ${d(from)})`).join(',\n           ')}
    on conflict do nothing;
  `);

  return rows.length;
}

// =====================================================================
//  B7 — SHARTNOMALAR
//
//  IKKITA shartnoma: 2024/25 va 2025/26. Sabab — o'qish to'lovi
//  oshgan, `generate_invoices` esa faqat FAOL shartnomani ko'radi.
//  Shuning uchun sikl ikki bosqichga bo'linadi va o'rtada shartnoma
//  almashtiriladi.
// =====================================================================

async function createContracts(schoolId, students, secondChild, discounts, prefix, plans) {
  const rows = [];

  students.forEach((s, i) => {
    const planId = plans.find((p) => p.grade_from <= s.grade && s.grade <= p.grade_to)?.id ?? null;
    const base = TUITION[s.grade];
    // 30% oila 9 oylik shartnoma tanlaydi — yozda to'lov yo'q.
    s.billing_months = chance(0.20) ? 9 : 12;
    s.due_day = pick([5, 5, 10, 10, 10, 15, 15, 20]);

    let disc = null;
    if (secondChild.has(i)) disc = discounts.second_child;
    else if (chance(0.03)) disc = discounts.staff_child;
    else if (chance(0.02)) disc = discounts.privileged;
    s.discount_id = disc;

    const num2 = `SH-${prefix}-${String(i + 1).padStart(3, '0')}`;
    const raised = base;
    s.tuition2 = raised;

    // BIRINCHI shartnoma faqat 2024/25 da o'qiganlarga. Ikkinchi
    // yildan kelgan bolaga uni ochib bo'lmaydi: `starts_on` qabul
    // sanasi, `ends_on` esa 2025-08-31 — bunday shartnoma o'zidan
    // oldin tugab qolardi (`contracts_period_valid` cheklovi).
    s.hasFirst = false;

    // Ikkinchi shartnoma hammaga. Keyinroq kelgan bola uchun u qabul
    // sanasidan boshlanadi va DARHOL faol bo'ladi.
    const start2 = s.hasFirst ? '2025-09-01' : s.enrolled_on;
    const signed2 = s.hasFirst ? '2025-08-20' : s.enrolled_on;

    rows.push(`(${q(schoolId)}, ${q(s.id)}, ${q(num2)}, ${d(signed2)},
                ${d(start2)}, null, ${n(raised)},
                ${disc ? q(disc) : 'null'}, ${n(s.due_day)},
                ${n(s.billing_months)}, true, ${q(planId)})`);
  });

  await sql(`
    insert into public.contracts
      (school_id, student_id, number, signed_on, starts_on, ends_on,
       tuition_amount, discount_type_id, due_day, billing_months, is_active, tuition_plan_id)
    values ${rows.join(',\n           ')};
  `);
}

/** A bosqichdan B ga o'tish: eski shartnoma yopiladi, yangisi ochiladi. */
async function switchContracts(schoolId) {
  await sql(`
    update public.contracts set is_active = false
     where school_id = ${q(schoolId)} and number like 'SH-2024-%';
    update public.contracts set is_active = true
     where school_id = ${q(schoolId)} and number like 'SH-2025-%';
  `);
}

// =====================================================================
//  B9 — CHIQIB KETGANLAR
//
//  `generate_invoices` da `status = 'active'` sharti bor: chiqib
//  ketgan o'quvchiga UMUMAN hisoblanma qurilmaydi, o'tgan oylarga
//  ham. Shuning uchun ikki qadam:
//
//    1. `left_on` sikldan OLDIN qo'yiladi — oxirgi oy qisman chiqadi;
//    2. `status` sikldan KEYIN o'zgartiriladi.
// =====================================================================

function pickLeavers(students) {
  const order = shuffle(students.map((_, i) => i));
  const leavers = [];
  const onLeave = [];

  for (const i of order) {
    if (leavers.length >= 8) break;
    // Faqat 2024-yilda kelganlar chiqishi mantiqiy.
    if (students[i].enrolled_on >= '2025-01-01') continue;
    const month = rint(3, 20);   // FIRST dan keyin
    const day = new Date(Date.UTC(2024, 8 + month, rint(10, 27)));
    leavers.push({ index: i, left_on: iso(day) });
  }

  for (const i of order) {
    if (onLeave.length >= 3) break;
    if (leavers.some((l) => l.index === i)) continue;
    onLeave.push(i);
  }

  return { leavers, onLeave };
}

async function markLeftOn(students, leavers) {
  if (leavers.length === 0) return;
  await sql(`
    update public.students as s set left_on = v.d::date
      from (values ${leavers.map((l) =>
        `(${q(students[l.index].id)}::uuid, ${q(l.left_on)})`).join(', ')}
      ) as v(id, d)
     where s.id = v.id;
  `);
}

async function markLeavers(students, leavers, onLeave) {
  if (leavers.length) {
    await sql(`
      update public.students set status = 'expelled'
       where id in (${leavers.map((l) => q(students[l.index].id)).join(', ')});
    `);
  }
  if (onLeave.length) {
    await sql(`
      update public.students set status = 'academic_leave'
       where id in (${onLeave.map((i) => q(students[i].id)).join(', ')});
    `);
  }
}

// =====================================================================
//  B8 — 24 OYLIK SIKL
//
//  Har oy uchun BITTA `DO` bloki. Nega bitta: 152 o'quvchi × 24 oy
//  degani minglab yozuv. Ularni bittalab API orqali yuborish soatlab
//  davom etardi. Blok ichida hammasi serverda bajariladi — 24 ta
//  so'rov, 3000 ta emas.
//
//  TARTIB MUHIM:
//    attendance_checks → absences → lessons → generate → finalize
//    → approve → to'lovlar → xarajat → oylik
//
//  `attendance_checks` birinchi bo'lishi shart: `finalize_invoices`
//  `app.absence_gaps` ni tekshiradi va yo'qlik qayd etilmagan ish
//  kuni bo'lsa "qayd etuv to'liq emas" deb to'xtaydi.
// =====================================================================

/**
 * `auth.uid()` ni to'ldirish.
 *
 * `role = 'service_role'` — `app.is_service_context()` rost qaytaradi
 * va huquq tekshiruvlari o'tkazib yuboriladi. `sub` esa `auth.uid()`
 * ni beradi, ya'ni audit jurnalida va `created_by` da HAQIQIY odam
 * ko'rinadi — "Tizim" emas. Kassa kvitansiyasida kassir ismi chiqadi.
 */
function actAs(userId) {
  return `perform set_config('request.jwt.claims',
      json_build_object('sub', ${q(userId)}, 'role', 'service_role')::text, true);`;
}

/** Oy qanchalik eski bo'lsa, shunchalik to'liq yig'ilgan. */
function collectionProfile(monthIndex) {
  const fromEnd = MONTHS - 1 - monthIndex;
  if (fromEnd >= 2) return { full: 0.95, partial: 0.03 };
  if (fromEnd >= 1) return { full: 0.89, partial: 0.06 };
  return { full: 0.58, partial: 0.11 };
}

const EXPENSES = [
  { code: 'rent',       min: 12_000_000, max: 12_000_000, note: 'Bino ijarasi' },
  { code: 'utilities',  min: 2_400_000,  max: 5_800_000,  note: 'Kommunal to‘lovlar' },
  { code: 'internet',   min: 850_000,    max: 950_000,    note: 'Internet va aloqa' },
  { code: 'kitchen',    min: 8_500_000,  max: 14_000_000, note: 'Oshxona mahsulotlari' },
  { code: 'stationery', min: 900_000,    max: 3_200_000,  note: 'Kanselyariya va sarf materiallari' },
  { code: 'transport',  min: 3_200_000,  max: 4_600_000,  note: 'Avtobus yoqilg‘isi va xizmati' },
  { code: 'marketing',  min: 0,          max: 6_000_000,  note: 'Reklama va targ‘ibot' },
  { code: 'repair',     min: 0,          max: 9_000_000,  note: 'Ta‘mirlash ishlari' },
  { code: 'taxes',      min: 4_200_000,  max: 6_800_000,  note: 'Soliq va majburiy to‘lovlar' },
];

/**
 * Bir oylik to'liq sikl.
 *
 * Tasodifiy qarorlar (kim to'ladi, qaysi kanal bilan) SERVER TOMONDA
 * qabul qilinadi: minglab qiymatni SQL matniga tiqishtirish so'rovni
 * megabaytlarga chiqarardi. Node tomonda faqat parametrlar.
 */
async function runMonth({
  schoolId, branchId, period, monthIndex, accountantId, directorId,
  cashierIds, categories, absenceReasons, teacherCount, payroll = true,
}) {
  const p = iso(period);
  const isCurrent = p === iso(CURRENT);
  //  Joriy oyda davomat/dars/xarajat FAQAT BUGUNGACHA.
  const end = isCurrent ? iso(TODAY) : iso(monthEnd(period));
  const prof = collectionProfile(monthIndex);

  // --- 1. Yo'qlik qayd etuvi va yo'qliklar --------------------------
  await sql(`
do $seed$
declare
  v_day  date;
  v_cls  record;
  v_st   record;
  v_reason uuid;
begin
  ${actAs(cashierIds.duty)}

  -- Har ish kuni × har sinf uchun qayd etuv. Busiz yakunlash
  -- "qayd etuv to'liq emas" deb to'xtaydi (app.absence_gaps).
  for v_day in
    select g::date from generate_series(${d(p)}, ${d(end)}, interval '1 day') g
     where app.working_days(${q(schoolId)}, ${q(branchId)}, g::date, g::date) = 1
  loop
    -- MUHIM: qabul sanasi bo'yicha FILTRLANMAYDI. app.absence_gaps
    -- sinflarni butun oy bo'yicha oladi (xizmatga yozilish oy bilan
    -- kesishsa yetarli), kunma-kun emas. Agar bu yerda kunga qarab
    -- filtrlansa, oyning boshida hali o'quvchisi yo'q sinf uchun
    -- qayd etuv yaratilmay qoladi va yakunlash "qayd etuv to'liq
    -- emas" deb to'xtaydi. Ortiqcha qator zarar qilmaydi.
    for v_cls in
      select distinct class_name from public.students
       where branch_id = ${q(branchId)} and class_name is not null
         and status = 'active'
    loop
      insert into public.attendance_checks
        (school_id, branch_id, day, class_name, absent_count, marked_by)
      values (${q(schoolId)}, ${q(branchId)}, v_day, v_cls.class_name, 0,
              ${q(cashierIds.duty)})
      on conflict do nothing;
    end loop;

    -- Har kuni o'quvchilarning ~5% i kelmaydi.
    for v_st in
      select id, branch_id from public.students
       where branch_id = ${q(branchId)} and status = 'active'
         and enrolled_on <= v_day and (left_on is null or left_on >= v_day)
         and random() < 0.05
    loop
      select id into v_reason from public.absence_reasons
       where school_id = ${q(schoolId)} and is_active
       order by case when random() < 0.55 then 0 else 1 end, random() limit 1;

      insert into public.absences
        (school_id, branch_id, student_id, day, reason_id, marked_by)
      values (${q(schoolId)}, v_st.branch_id, v_st.id, v_day, v_reason,
              ${q(cashierIds.duty)})
      on conflict do nothing;
    end loop;
  end loop;

  -- Qayd etuvdagi yo'qlik sonini haqiqiy songa keltiramiz.
  update public.attendance_checks ac
     set absent_count = coalesce((
       select count(*) from public.absences a
        join public.students s on s.id = a.student_id
       where a.day = ac.day and s.class_name = ac.class_name
         and a.school_id = ac.school_id), 0)
   where ac.branch_id = ${q(branchId)}
     and ac.day between ${d(p)} and ${d(end)};
end $seed$;
  `);

  // --- 2. Darslar (oylik uchun soat) --------------------------------
  await sql(`
do $seed$
declare v_t record; v_day date;
begin
  ${actAs(directorId)}
  for v_t in
    select t.id from public.teachers t
      join public.teacher_branches tb on tb.teacher_id = t.id and tb.branch_id = ${q(branchId)}
     where t.school_id = ${q(schoolId)} and t.is_active
  loop
    for v_day in
      select g::date from generate_series(${d(p)}, ${d(end)}, interval '1 day') g
       where app.working_days(${q(schoolId)}, ${q(branchId)}, g::date, g::date) = 1
    loop
      -- Kuniga 3–5 soat, 8% hollarda dars o'tilmagan yoki almashtirilgan.
      insert into public.lessons
        (school_id, branch_id, teacher_id, day, hours, kind, created_by)
      values (${q(schoolId)}, ${q(branchId)}, v_t.id, v_day,
              (3 + floor(random() * 3))::numeric,
              (case when random() < 0.05 then 'substituted'
                   when random() < 0.08 then 'not_held'
                   else 'held' end)::public.lesson_kind,
              ${q(directorId)});
    end loop;
  end loop;
end $seed$;
  `);

  // --- 3. Hisoblanma: qurish → yakunlash → tasdiqlash ---------------
  await sql(`
do $seed$
begin
  ${actAs(accountantId)}
  perform public.generate_invoices(${q(branchId)}, ${d(p)});
  ${isCurrent ? '' : `perform public.finalize_invoices(${q(branchId)}, ${d(p)});
  perform public.approve_invoices(${q(branchId)}, ${d(p)});`}
end $seed$;
  `);

  // --- 4. To'lovlar --------------------------------------------------
  await sql(`
do $seed$
declare
  v_inv    record;
  v_amount numeric(14,2);
  v_paid   date;
  v_roll   numeric;
  v_chan   numeric;
  v_proof  uuid;
  v_parent uuid;
begin
  for v_inv in
    select t.invoice_id, t.student_id, t.total, t.due_date, s.branch_id,
           s.enrolled_on
      from public.v_invoice_totals t
      join public.students s on s.id = t.student_id
     where t.period = ${d(p)} and t.status <> 'cancelled'
       and t.branch_id = ${q(branchId)} and t.total > 0
  loop
    v_roll := random();

    -- Qancha to'landi.
    if v_roll < ${n(prof.full)} then
      v_amount := v_inv.total;
    elsif v_roll < ${n(prof.full + prof.partial)} then
      v_amount := round((v_inv.total * (0.3 + random() * 0.5))::numeric, -3);
    else
      continue;   -- to'lanmagan
    end if;

    -- Qachon to'landi: 40% muddatgacha, 45% keyin 1–10 kun,
    -- 15% ancha kech. Shundagina "muddati o'tgan" ma'noli bo'ladi.
    v_roll := random();
    if v_roll < 0.40 then
      v_paid := v_inv.due_date - (floor(random() * 8))::int;
    elsif v_roll < 0.85 then
      v_paid := v_inv.due_date + (1 + floor(random() * 10))::int;
    else
      v_paid := v_inv.due_date + (11 + floor(random() * 18))::int;
    end if;

    -- Davrdan chiqib ketmasin.
    if v_paid < ${d(p)} then v_paid := ${d(p)}; end if;
    if v_paid > current_date then v_paid := current_date; end if;

    -- QABUL SANASIDAN OLDIN bo'lmasin. Muddat oyning 5-sanasi, bola
    -- esa 12-sanada kelgan bo'lsa, "muddatgacha to'lash" hisobi
    -- to'lovni bola hali maktabda yo'q kunga qo'yib yuborardi.
    if v_paid < v_inv.enrolled_on then v_paid := v_inv.enrolled_on; end if;

    v_chan := random();

    if v_chan < 0.45 then
      -- KASSA: haqiqiy raqamlangan kvitansiya bilan (TZ 4.7.1.2).
      ${actAs(accountantId)}
      perform public.register_cash_payment(
        v_inv.student_id, v_amount, v_paid, 'Kassa orqali');

    elsif v_chan < 0.80 then
      -- BANK: vypiska orqali kelgan to'lov.
      insert into public.payments
        (school_id, branch_id, student_id, amount, channel, status,
         paid_on, note, created_by)
      values (${q(schoolId)}, v_inv.branch_id, v_inv.student_id, v_amount,
              'bank', 'confirmed', v_paid, 'Bank o''tkazmasi',
              ${q(accountantId)});

    else
      -- CHEK: ota-ona Telegram orqali yuborgan.
      select sp.parent_id into v_parent
        from public.student_parents sp
        join public.parents pr on pr.id = sp.parent_id
       where sp.student_id = v_inv.student_id and pr.telegram_id is not null
       limit 1;

      if v_parent is null then
        -- Botga ulanmagan oila — bankka o'tkazamiz.
        insert into public.payments
          (school_id, branch_id, student_id, amount, channel, status,
           paid_on, note, created_by)
        values (${q(schoolId)}, v_inv.branch_id, v_inv.student_id, v_amount,
                'bank', 'confirmed', v_paid, 'Bank o''tkazmasi',
                ${q(accountantId)});
      else
        insert into public.payment_proofs
          (school_id, branch_id, student_id, parent_id, file_path,
           amount_claimed, status, submitted_at)
        values (${q(schoolId)}, v_inv.branch_id, v_inv.student_id, v_parent,
                ${q(schoolId)} || '/' || v_inv.student_id || '/' ||
                  to_char(v_paid, 'YYYYMMDD') || '.jpg',
                v_amount, 'pending', v_paid::timestamptz + interval '10 hours')
        returning id into v_proof;

        v_roll := random();
        ${actAs(accountantId)}
        if v_roll < 0.85 then
          perform public.confirm_payment_proof(v_proof, v_amount, v_paid);
        elsif v_roll < 0.95 then
          null;   -- kutilmoqda
        else
          perform public.reject_payment_proof(v_proof,
            'Chekda summa ko''rinmayapti, qayta yuboring');
        end if;
      end if;
    end if;
  end loop;
end $seed$;
  `);

  // --- 5. Xarajatlar --------------------------------------------------
  const expRows = [];
  for (const e of EXPENSES) {
    // Marketing va ta'mir har oy bo'lmaydi.
    if (e.min === 0 && chance(0.6)) continue;
    const amount = Math.round(rint(e.min, e.max) / 10000) * 10000;
    if (amount === 0) continue;
    const dayNum = isCurrent ? rint(1, Math.max(1, TODAY.getUTCDate())) : rint(2, 26);
    const day = iso(new Date(Date.UTC(
      period.getUTCFullYear(), period.getUTCMonth(), dayNum)));
    expRows.push(
      `(${q(schoolId)}, ${q(branchId)}, ${q(categories[e.code])}, ${n(amount)},
        ${d(day)}, ${q(chance(0.4) ? 'cash' : 'bank')}, ${q(e.note)},
        ${q(accountantId)})`);
  }

  await sql(`
do $seed$
begin
  ${actAs(accountantId)}
  insert into public.expenses
    (school_id, branch_id, category_id, amount, spent_on, payment_method,
     note, created_by)
  values ${expRows.join(',\n         ')};
end $seed$;
  `);

  // --- 6. Oylik (joriy oyda hali hisoblanmaydi) ------------------------
  if (!isCurrent && payroll) await sql(`
do $seed$
declare v_run record;
begin
  ${actAs(directorId)}

  -- Butun maktab uchun bir chaqiruv. Har bir o'qituvchini alohida
  -- aylantirish shart emas: calc_payroll_batch shuni o'zi qiladi
  -- va bittasi yiqilsa qolganini to'xtatmaydi.
  perform public.calc_payroll_batch(${d(p)});

  for v_run in
    select id from public.payroll_runs
     where school_id = ${q(schoolId)} and period = ${d(p)}
       and status <> 'approved'
  loop
    perform public.approve_payroll(v_run.id);
  end loop;
end $seed$;
  `);
}

// =====================================================================
//  B10 — MUROJAATLAR
// =====================================================================

async function createLeads(schoolId, branchId, managerId, students) {
  const sources = await sql(`
    select name from public.lookups
     where school_id = ${q(schoolId)} and kind = 'lead_source' and is_active;
  `);
  const srcNames = sources.map((s) => s.name);

  const classes = await sql(`
    select name from public.classes
     where branch_id = ${q(branchId)} and academic_year = ${q(YEAR)}
     order by grade_level, name;
  `);

  const rows = [];
  const statuses = [
    ...Array(12).fill('accepted'),
    ...Array(5).fill('visited'),
    ...Array(3).fill('contacted'),
    ...Array(5).fill('new'),
    ...Array(3).fill('rejected'),
  ];

  // Qabul qilinganlar haqiqiy o'quvchiga bog'lanadi — "murojaatdan
  // o'quvchiga" yo'li ko'rinsin.
  const converted = shuffle(students.filter((s) => s.enrolled_on >= '2026-09-06'))
    .slice(0, 12);

  statuses.forEach((status, i) => {
    const female = chance(0.5);
    const sur = pick(SURNAMES);
    const name = female
      ? `${feminize(sur)} ${pick(FEMALE_NAMES)}`
      : `${sur} ${pick(MALE_NAMES)}`;

    const created = iso(addDays(new Date(), -rint(1, 120)));
    const next = ['new', 'contacted', 'visited'].includes(status)
      ? iso(addDays(new Date(), rint(-6, 12)))
      : null;

    const studentId = status === 'accepted' && converted[i]
      ? converted[i].id : null;

    rows.push(`(${q(schoolId)}, ${q(branchId)}, ${q(name)}, ${q(phone())},
                ${q(pick(classes).name)}, ${q(pick(srcNames))}, ${q(status)},
                ${next ? d(next) : 'null'},
                ${studentId ? q(studentId) : 'null'},
                ${q(managerId)}, ${d(created)}::timestamptz)`);
  });

  await sql(`
    insert into public.leads
      (school_id, branch_id, full_name, phone, target_class, source, status,
       next_contact_on, student_id, created_by, created_at)
    values ${rows.join(',\n           ')};
  `);

  return rows.length;
}

// =====================================================================
//  B10b — DAVR QULFI
//
//  ENG OXIRIDA. Qulf yopilgandan keyin o'sha davrga hech narsa
//  yozib bo'lmaydi — erta qo'yilsa butun sikl yiqilardi.
// =====================================================================

async function lockPeriods(schoolId, branchId, directorId) {
  // Uch oydan eski davrlar yopiladi — buxgalteriyada odatiy amaliyot.
  const locked = [];
  for (let i = 0; i < MONTHS - 3; i++) {
    locked.push(iso(addMonths(FIRST, i)));
  }

  await sql(`
do $seed$
declare v_p date;
begin
  ${actAs(directorId)}
  foreach v_p in array array[${locked.map((x) => d(x)).join(', ')}]
  loop
    perform public.lock_period(v_p, ${q(branchId)}, 'Oylik hisobot topshirildi');
  end loop;
end $seed$;
  `);

  return locked.length;
}

// =====================================================================
//  YAKUNIY HISOBOT
// =====================================================================

async function summary(schoolId) {
  const [c] = await sql(`
    select
      (select count(*) from public.students where school_id = ${q(schoolId)}) as oquvchi,
      (select count(*) from public.students where school_id = ${q(schoolId)} and status = 'active') as faol,
      (select count(*) from public.classes  where school_id = ${q(schoolId)}) as sinf,
      (select count(*) from public.teachers where school_id = ${q(schoolId)}) as oqituvchi,
      (select count(*) from public.parents  where school_id = ${q(schoolId)}) as ota_ona,
      (select count(*) from public.invoices where school_id = ${q(schoolId)}) as hisoblanma,
      (select count(*) from public.invoice_lines where school_id = ${q(schoolId)}) as qator,
      (select count(*) from public.payments where school_id = ${q(schoolId)}) as tolov,
      (select count(*) from public.cash_receipts where school_id = ${q(schoolId)}) as kvitansiya,
      (select count(*) from public.payment_proofs where school_id = ${q(schoolId)}) as chek,
      (select count(*) from public.expenses where school_id = ${q(schoolId)}) as xarajat,
      (select count(*) from public.payroll_runs where school_id = ${q(schoolId)}) as oylik,
      (select count(*) from public.absences where school_id = ${q(schoolId)}) as yoqlik,
      (select count(*) from public.lessons where school_id = ${q(schoolId)}) as dars,
      (select count(*) from public.leads where school_id = ${q(schoolId)}) as murojaat,
      (select count(*) from public.audit_log where school_id = ${q(schoolId)}) as jurnal,
      (select count(*) from public.message_queue where school_id = ${q(schoolId)}) as xabar
  `);

  return { c, f: {} };
}

const som = (v) =>
  new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 })
    .format(Math.round(Number(v ?? 0))).replace(/ /g, ' ');

// =====================================================================
//  ASOSIY OQIM
// =====================================================================

const TOTAL_STEPS = 12;

async function main() {
  const confirmed = process.argv.includes('--confirm');
  const total = BRANCHES.reduce((a, b) => a + b.size, 0);

  console.log('');
  console.log(`  ${SCHOOL} — namuna maktab: ${BRANCHES.length} filial, ${total} o'quvchi`);
  console.log(`  Davr: ${iso(FIRST)} … bugun (${iso(TODAY)}), keyingi oy hisoblanmasi bilan`);
  console.log('');
  if (!confirmed) {
    console.log('  Faqat shu nomdagi maktab qayta quriladi. Davom etish: --confirm');
    return;
  }

  const t0 = Date.now();
  reseed();

  step(1, 8, 'Eski namuna (bo‘lsa) tozalanmoqda…');
  await wipe();

  step(2, 8, 'Maktab, 3 filial, kalendar…');
  const { school_id: schoolId, branch_ids: branchIds } = await createSchool();
  for (const b of branchIds) await fillCalendar(schoolId, b);

  step(3, 8, 'Xodimlar va o‘qituvchilar…');
  const staff = await createStaff(schoolId);
  const directorId = staff.find((x) => x.role === 'director').id;
  const accountantId = staff.find((x) => x.login === 'buxgalter').id;
  const managerId = staff.find((x) => x.role === 'manager').id;
  const dutyId = staff.find((x) => x.role === 'duty').id;

  const tariffs = await sql(`
    insert into public.tuition_plans (school_id, name, academic_year, grade_from, grade_to, monthly_amount, sort_order)
    values ${PLANS.map((p) => `(${q(schoolId)}, ${q(p.name)}, ${q(YEAR)}, ${p.from}, ${p.to}, ${p.amount}, ${p.from})`).join(', ')}
    returning id, grade_from, grade_to;
  `);

  const discList = await sql(`select id, code from public.discount_types where school_id = ${q(schoolId)};`);
  const discounts = Object.fromEntries(discList.map((x) => [x.code, x.id]));
  const catList = await sql(`select id, code from public.expense_categories where school_id = ${q(schoolId)};`);
  const categories = Object.fromEntries(catList.map((x) => [x.code, x.id]));

  const per = [];
  let allTeachers = [];
  let allClasses = [];
  for (let bi = 0; bi < BRANCHES.length; bi++) {
    const B = BRANCHES[bi];
    const branchId = branchIds[bi];
    step(4, 8, `${B.name}: o‘qituvchilar, sinflar, ${B.size} o‘quvchi…`);
    const plan = planFor(B.size);
    const teachers = await createTeachers(schoolId, branchId, staff, Math.round(B.size / 11), bi === 0);
    const classes = await createClasses(schoolId, branchId, teachers, plan);
    const svc = await createServices(schoolId, branchId, accountantId);
    const { students, secondChild } = await createStudents(schoolId, branchId, classes, plan);
    await assignServices(schoolId, students, svc);
    await createContracts(schoolId, students, secondChild, discounts, `${2026}${bi + 1}`, tariffs);
    allTeachers = allTeachers.concat(teachers);
    allClasses = allClasses.concat(classes);
    per.push({ branchId, students });
  }

  step(5, 8, 'Oylik sozlamasi va ustamalar…');
  await configurePayroll(schoolId, allTeachers, allClasses);

  step(6, 8, `${MONTHS} oylik sikl (oxirgisi — joriy oy, bugungacha)…`);
  for (let i = 0; i < MONTHS; i++) {
    const period = addMonths(FIRST, i);
    for (let bi = 0; bi < per.length; bi++) {
      const t = Date.now();
      await runMonth({
        schoolId, branchId: per[bi].branchId, period, monthIndex: i,
        accountantId, directorId,
        cashierIds: { duty: dutyId, accountant: accountantId },
        categories, teacherCount: allTeachers.length,
        payroll: bi === per.length - 1,
      });
      console.log(`        ${iso(period).slice(0, 7)}  ${BRANCHES[bi].name.padEnd(20)} ${((Date.now() - t) / 1000).toFixed(1)}s`);
    }
  }

  step(7, 8, 'Keyingi oy: hisoblanma va oldindan to‘lovlar…');
  const next = iso(addMonths(CURRENT, 1));
  for (const { branchId } of per) {
    await sql(`
do $seed$
declare r record;
begin
  ${actAs(accountantId)}
  perform public.generate_invoices(${q(branchId)}, ${d(next)});
  -- ~9% oila keyingi oyni ham oldindan to'laydi.
  for r in
    select t.student_id, t.total from public.v_invoice_totals t
     where t.branch_id = ${q(branchId)} and t.period = ${d(next)}
       and t.status <> 'cancelled' and t.total > 0 and random() < 0.12
       and (select coalesce(sum(x.total), 0) from public.v_invoice_totals x
             where x.student_id = t.student_id and x.period < ${d(next)} and x.status <> 'cancelled')
           <= (select coalesce(sum(pm.amount), 0) from public.payments pm
             where pm.student_id = t.student_id and pm.status = 'confirmed')
  loop
    perform public.register_cash_payment(r.student_id, r.total,
      current_date - (floor(random() * 6))::int, 'Dekabr uchun oldindan');
  end loop;
end $seed$;
    `);
  }

  step(8, 8, 'Murojaatlar…');
  for (const { branchId, students } of per) {
    await createLeads(schoolId, branchId, managerId, students);
  }

  const { c } = await summary(schoolId);
  console.log('');
  console.log(`  TAYYOR — ${((Date.now() - t0) / 60000).toFixed(1)} daqiqa`);
  console.log(`  O'quvchi ${c.oquvchi}, sinf ${c.sinf}, o'qituvchi ${c.oqituvchi}, hisoblanma ${c.hisoblanma}, to'lov ${c.tolov}`);
  console.log('');
  console.log('  KIRISH MA\'LUMOTLARI');
  for (const x of staff) {
    console.log(`  ${x.email.padEnd(28)} ${x.password.padEnd(16)} ${x.title}`);
  }
}

main().catch((e) => {
  console.error(`\n  XATO: ${e.message}\n`);
  process.exit(1);
});
