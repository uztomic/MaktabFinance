// =====================================================================
//  TURON — o'quvchi ikki marta kiritilganmi?
//
//  Ro'yxat ikki manbadan birlashtirilgan: narxli ro'yxat (qisqa ism)
//  va rasmiy ro'yxat (to'liq ism-sharif). Bir bola ikkala joyda ham
//  bor, lekin YOZILISHI boshqacha:
//
//      Azimhadjayev Ismoil  ↔  Azimxodjayev Ismoilxon Akmal o'g'li
//
//  Shuning uchun oddiy "bir xil matn" tekshiruvi yetarli emas.
//  O'zbek yozuvidagi variantlar bir shaklga keltiriladi (x↔h, q↔k,
//  sh→s, ch→c), qo'shimchalar ("o'g'li", "qizi") kesiladi.
//
//  Skript HECH NARSA O'ZGARTIRMAYDI. Egizaklar va bir xil familiyali
//  aka-uka ko'p — qarorni faqat odam qabul qila oladi.
// =====================================================================

import { execFileSync } from 'node:child_process';

function normalize(name) {
  return name.toLowerCase()
    .replace(/[''''`\u02bb\u02bc\u2018\u2019]/g, '')
    .replace(/x/g, 'h').replace(/q/g, 'k')
    .replace(/ch/g, 'c').replace(/sh/g, 's')
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parts(name) {
  const w = normalize(name).split(' ')
    .filter((x) => !['ogli', 'qizi', 'kizi', 'ugli', 'oglі'].includes(x));
  return [w[0] ?? '', w.slice(1).join('')];
}

function distance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

const SQL = `select st.id, st.full_name, st.class_name, st.birth_date,
       st.payment_code, st.enrolled_on,
       (select c.tuition_amount::bigint from public.contracts c
         where c.student_id = st.id and c.is_active) as narx
  from public.students st
  join public.branches b on b.id = st.branch_id
  join public.schools  s on s.id = b.school_id
 where s.name = 'Turon Ilm Xazinasi'
   and st.deleted_at is null
 order by st.full_name`;

const out = execFileSync('node', ['scripts/db.mjs', 'sql', SQL], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
});
const rows = JSON.parse(out);
console.log(`Tekshirilyapti: ${rows.length} ta o'quvchi\n`);

// --- 1. Aynan bir xil yozilgan ismlar --------------------------------
const exact = new Map();
for (const r of rows) {
  const k = normalize(r.full_name);
  if (!exact.has(k)) exact.set(k, []);
  exact.get(k).push(r);
}
const exactDups = [...exact.values()].filter((g) => g.length > 1);

// --- 2. To'lov kodi takrorlanganmi -----------------------------------
const codes = new Map();
for (const r of rows) {
  if (!r.payment_code) continue;
  if (!codes.has(r.payment_code)) codes.set(r.payment_code, []);
  codes.get(r.payment_code).push(r);
}
const codeDups = [...codes.values()].filter((g) => g.length > 1);

// --- 3. O'xshash ismlar ----------------------------------------------
//  Har bir juftlik uchun familiya va ism farqi alohida o'lchanadi.
const pairs = [];
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const [sa, na] = parts(a.full_name);
    const [sb, nb] = parts(b.full_name);
    if (!sa || !sb) continue;

    const ds = distance(sa, sb);
    if (ds > 2) continue;                    // familiya butunlay boshqa

    const short = na.length <= nb.length ? na : nb;
    const long  = na.length <= nb.length ? nb : na;
    //  "Ismoil" → "Ismoilxon": to'liq boshlanish mos kelsa juda yaqin.
    const prefix = short.length >= 4 && long.startsWith(short);
    const dn = prefix ? 0 : distance(na, nb);
    if (dn > 3) continue;                    // ism butunlay boshqa

    pairs.push({ a, b, ds, dn, prefix, rank: ds * 3 + dn });
  }
}
pairs.sort((x, y) => x.rank - y.rank);

// --- Hisobot ----------------------------------------------------------
function show(r) {
  return `${r.full_name} [${r.class_name ?? 'sinfsiz'}]`
    + (r.narx ? ` ${Number(r.narx).toLocaleString('ru-RU')}` : ' SHARTNOMASIZ')
    + (r.birth_date ? ` tug'.${r.birth_date}` : '');
}

if (exactDups.length) {
  console.log(`### AYNAN BIR XIL ISM — ${exactDups.length} ta guruh\n`);
  for (const g of exactDups) {
    for (const r of g) console.log('   ' + show(r));
    console.log();
  }
} else {
  console.log("### Aynan bir xil yozilgan ism yo'q\n");
}

if (codeDups.length) {
  console.log(`### TO'LOV KODI TAKRORLANGAN — ${codeDups.length} ta\n`);
  for (const g of codeDups) {
    console.log(`   kod ${g[0].payment_code}:`);
    for (const r of g) console.log('      ' + show(r));
  }
  console.log();
} else {
  console.log("### To'lov kodi takrorlanmagan\n");
}

const same = pairs.filter((p) => p.a.class_name === p.b.class_name);
const cross = pairs.filter((p) => p.a.class_name !== p.b.class_name);

for (const [title, list] of [
  ['BIR SINFDA o\'xshash', same],
  ['BOSHQA-BOSHQA SINFDA o\'xshash', cross],
]) {
  console.log(`### ${title} — ${list.length} ta juftlik\n`);
  for (const p of list) {
    const tag = p.ds === 0 && p.dn === 0 ? 'AYNAN'
      : p.ds === 0 && p.prefix ? 'JUDA YAQIN'
      : p.ds <= 1 && p.dn <= 1 ? 'YAQIN' : 'uzoqroq';
    console.log(`   [${tag}] familiya farqi ${p.ds}, ism farqi ${p.dn}`);
    console.log(`      ${show(p.a)}`);
    console.log(`      ${show(p.b)}`);
    console.log();
  }
}
