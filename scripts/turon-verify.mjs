// =====================================================================
//  TURON — bazadagi har bir o'quvchi ro'yxatda bormi?
//
//  Farhodjon ikkita ro'yxat yuborgan:
//    GROUPS   — narxi bilan, qisqa ism
//    REGISTER — narxsiz, to'liq ism-sharif
//
//  Import ularni birlashtirgan. Moslashtirish to'liq bo'lmagani
//  uchun bazada ro'yxatdagidan ko'proq yozuv bor. Savol shu:
//
//    · qaysi yozuv ro'yxatning HECH QAYERIDA yo'q?   → ortiqcha
//    · ro'yxatda bor, bazada yo'q?                    → yo'qolgan
//    · bitta bola ikki marta kirganmi?                → dublikat
//
//  Skript HECH NARSA O'ZGARTIRMAYDI — faqat ro'yxat chiqaradi.
// =====================================================================

import { execFileSync } from 'node:child_process';
import { GROUPS, REGISTER } from './turon-data.mjs';

function normalize(name) {
  return name.toLowerCase()
    .replace(/[''''`ʻʼ‘’]/g, '')
    .replace(/x/g, 'h').replace(/q/g, 'k')
    .replace(/ch/g, 'c').replace(/sh/g, 's')
    .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function parts(name) {
  const w = normalize(name).split(' ')
    .filter((x) => !['ogli', 'qizi', 'kizi', 'ugli'].includes(x));
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

/**
 *  Ikki ism bir odamnikimi?
 *
 *  Bu yerda qoida IMPORTDAGIDAN BO'SHROQ — ataylab. Import xato
 *  birlashtirmaslik uchun qattiq edi. Bu yerda esa savol boshqa:
 *  "shu yozuv ro'yxatdan kelganmi?". Agar bo'sh qoida bilan ham
 *  topilmasa, demak u ro'yxatda umuman yo'q.
 */
function sameName(a, b) {
  const [sa, na] = parts(a);
  const [sb, nb] = parts(b);
  if (!sa || !sb) return false;
  if (distance(sa, sb) > 2) return false;

  if (!na || !nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  if (short.length >= 4 && long.startsWith(short)) return true;
  return distance(na, nb) <= 2;
}

const out = execFileSync('node', ['scripts/db.mjs', 'sql', `
  select st.id, st.full_name, st.class_name,
         (select c.tuition_amount::bigint from public.contracts c
           where c.student_id = st.id and c.is_active) as narx
    from public.students st
    join public.branches b on b.id = st.branch_id
    join public.schools  s on s.id = b.school_id
   where s.name = 'Turon Ilm Xazinasi' and st.deleted_at is null
   order by st.class_name, st.full_name`],
  { encoding: 'utf8', maxBuffer: 32e6 });
const db = JSON.parse(out);

//  Manba yozuvlari bitta ro'yxatga.
const source = [];
for (const g of GROUPS) {
  for (const [name, price] of g.students) {
    source.push({ cls: g.name, name, price, from: 'narxli', taken: null });
  }
}
for (const [cls, name] of REGISTER) {
  source.push({ cls, name, price: null, from: 'rasmiy', taken: null });
}

//  Har bir bazadagi yozuvga manbadan mos keluvchi topamiz.
//  Avval SHU SINFDAN, keyin boshqa sinfdan — chunki import ba'zi
//  bolani boshqa guruhdan olib kelgan (Lager ↔ 2-B).
const extra = [];
for (const r of db) {
  let hit = source.find((s) => !s.taken && s.cls === r.class_name
    && sameName(s.name, r.full_name));
  if (!hit) {
    hit = source.find((s) => !s.taken && sameName(s.name, r.full_name));
  }
  if (hit) hit.taken = r;
  else extra.push(r);
}

const lost = source.filter((s) => !s.taken);

const fmt = (r) => `${r.full_name} [${r.class_name ?? 'sinfsiz'}]`
  + (r.narx ? ` ${Number(r.narx).toLocaleString('ru-RU')}` : ' shartnomasiz');

console.log(`Bazada ${db.length} ta, manbada ${source.length} ta yozuv\n`);

console.log(`### RO'YXATDA YO'Q — ${extra.length} ta\n`);
for (const r of extra) console.log('   ' + fmt(r));

console.log(`\n### MANBADA BOR, BAZAGA TUSHMAGAN — ${lost.length} ta\n`);
for (const s of lost) {
  console.log(`   ${s.name} [${s.cls}] (${s.from}${s.price ? ', ' + s.price : ''})`);
}
