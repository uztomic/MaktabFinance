// =====================================================================
//  O'QITUVCHILARGA TIZIMGA KIRISH HISOBI
//
//  Odatda login — TELEFON raqami: o'qituvchi va navbatchi shunday
//  kiradi. Bu ro'yxatda esa raqamlar yo'q, shuning uchun login ism
//  asosida quriladi: `akbarova.mastura@turon.local`.
//
//  Bu vaqtinchalik yechim va shunday deb belgilanadi. Telefon raqami
//  ma'lum bo'lganda hisobni telefon bilan qayta yaratish kerak —
//  o'qituvchiga o'z raqamini eslash `@turon.local` manzilni eslashdan
//  ancha oson.
//
//  Parol serverda yaratiladi va HECH QAYERDA saqlanmaydi. Shuning
//  uchun u bir marta faylga yoziladi — `backups/` papkasiga, git ga
//  kirmaydigan joyga.
//
//    node scripts/create-teacher-logins.mjs "Turon Ilm Xazinasi" --dry
//    node scripts/create-teacher-logins.mjs "Turon Ilm Xazinasi"
// =====================================================================

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SCHOOL = process.argv[2];
const DRY = process.argv.includes('--dry');

if (!SCHOOL) {
  console.error('Maktab nomini ko\'rsating');
  process.exit(1);
}

function env() {
  const out = { ...process.env };
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i < 1 || line.trimStart().startsWith('#')) continue;
    out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
  }
  return out;
}

const E = env();
const URL = E.VITE_SUPABASE_URL;
const KEY = E.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('VITE_SUPABASE_URL yoki SERVICE_ROLE_KEY yo\'q');

const sql = (q) => JSON.parse(execFileSync('node', ['scripts/db.mjs', 'sql', q], {
  encoding: 'utf8', maxBuffer: 64e6,
}));
const qq = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

/** O'zbek harflarini lotin ASCII ga keltiradi. */
function slug(name) {
  return name.toLowerCase()
    .replace(/[''''`ʻʼ‘’]/g, '')
    .replace(/o'/g, 'o').replace(/g'/g, 'g')
    .replace(/[^a-z\s]/g, '')
    .trim().split(/\s+/).slice(0, 2).join('.');
}

/**
 *  Chalkashtiruvchi belgilarsiz parol.
 *
 *  0/O va 1/I/l olib tashlangan: parol qog'ozga yozib beriladi va
 *  o'qituvchi uni klaviaturadan teradi — o'sha yerda adashish eng
 *  ko'p uchraydi.
 */
function password(len = 10) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const a = 'abcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const all = A + a + d;
  let out = A[Math.floor(Math.random() * A.length)]
    + a[Math.floor(Math.random() * a.length)]
    + d[Math.floor(Math.random() * d.length)];
  while (out.length < len) out += all[Math.floor(Math.random() * all.length)];
  return out.split('').sort(() => Math.random() - 0.5).join('');
}

// --- Kimga kerak --------------------------------------------------------
const teachers = sql(`
  select t.id, t.full_name, t.phone, b.id as branch_id, s.id as school_id
    from public.teachers t
    join public.schools s on s.id = t.school_id
    join public.branches b on b.school_id = s.id
   where s.name = ${qq(SCHOOL)}
     and t.deleted_at is null
     and t.is_active
     and t.user_id is null
   order by t.full_name`);

console.log(`${SCHOOL}: hisobsiz o'qituvchi — ${teachers.length} ta\n`);
if (teachers.length === 0) process.exit(0);

//  Bir xil login bo'lmasin: ismlar takrorlanishi mumkin.
const used = new Set(
  sql(`select lower(email) as email from public.app_users where email is not null`)
    .map((r) => r.email),
);

const plan = teachers.map((t) => {
  let login = `${slug(t.full_name)}@turon.local`;
  let n = 1;
  while (used.has(login)) login = `${slug(t.full_name)}${++n}@turon.local`;
  used.add(login);
  return { ...t, login, password: password() };
});

for (const p of plan) console.log(`  ${p.full_name.padEnd(32)} ${p.login}`);

if (DRY) {
  console.log('\n(quruq yugurish — hech narsa yaratilmadi)');
  process.exit(0);
}

// --- Yaratish -------------------------------------------------------------
const created = [];
for (const p of plan) {
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify({
      email: p.login,
      password: p.password,
      email_confirm: true,
      user_metadata: { full_name: p.full_name },
    }),
  });

  const body = await r.json();
  if (!r.ok || !body.id) {
    console.error(`  XATO ${p.full_name}: ${body.msg ?? body.message ?? r.status}`);
    continue;
  }

  //  Auth yozuvi bor, endi ilova tomoni. Ikkalasi ham bo'lmasa
  //  odam kira oladi-yu, hech narsa ko'rmaydi.
  sql(`
    insert into public.app_users
      (id, school_id, role, full_name, email, is_active, all_branches, lang)
    values
      (${qq(body.id)}, ${qq(p.school_id)}, 'teacher', ${qq(p.full_name)},
       ${qq(p.login)}, true, false, 'uz');

    insert into public.user_branches (user_id, branch_id)
    values (${qq(body.id)}, ${qq(p.branch_id)});

    update public.teachers set user_id = ${qq(body.id)} where id = ${qq(p.id)};`);

  created.push(p);
  console.log(`  ✓ ${p.full_name}`);
}

// --- Parollarni faylga ------------------------------------------------------
mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = `backups/logins-${SCHOOL.replace(/[^\w]+/g, '-')}-${stamp}.txt`;

writeFileSync(file,
  `${SCHOOL} — o'qituvchi hisoblari\n`
  + `${new Date().toISOString()}\n\n`
  + `Parol qayta ko'rsatilmaydi. Tarqatgandan keyin bu faylni o'chiring.\n\n`
  + created.map((p) =>
    `${p.full_name}\n  login: ${p.login}\n  parol: ${p.password}\n`).join('\n'));

console.log(`\nYaratildi: ${created.length} ta`);
console.log(`Parollar: ${file}`);
console.log('Tarqatgandan keyin faylni o\'chiring — parol boshqa ko\'rsatilmaydi.');
