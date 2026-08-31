// =====================================================================
//  Shartnomasiz qolgan o'quvchilar DUBLIKATMI?
//
//  Import ikki ro'yxatni birlashtirgan: narxli ro'yxat va to'liq
//  ism-sharifli rasmiy ro'yxat. Ikkinchisi AYNAN o'sha bolalar edi,
//  lekin ismlar boshqacha yozilgan. Moslashtirish qoidasi ataylab
//  qattiq qilingan — xato birlashtirish xato ajratishdan yomonroq.
//
//  Natijada bir qism bola ajralib qolgan bo'lishi mumkin: shartnomasi
//  yo'q, chunki narx narxli ro'yxatdagi nusxasiga yozilgan.
//
//  Bu skript HECH NARSA YOZMAYDI. U faqat shartnomasiz har bir
//  o'quvchi uchun o'sha sinfdagi eng o'xshash shartnomali bolani
//  topib beradi — qarorni odam qabul qiladi.
// =====================================================================

import { GROUPS, REGISTER } from './turon-data.mjs';

function normalize(name) {
  return name.toLowerCase()
    .replace(/[''''`\u02bb\u02bc]/g, '')
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

/** 0 = aynan, kattaroq = uzoqroq. */
function score(a, b) {
  const [sa, na] = parts(a), [sb, nb] = parts(b);
  const ds = distance(sa, sb);
  const short = na.length <= nb.length ? na : nb;
  const long  = na.length <= nb.length ? nb : na;
  const dn = (short && long.startsWith(short)) ? 0 : distance(na, nb);
  return { ds, dn, total: ds * 2 + dn };
}

//  Rasmiy ro'yxatda bor ismlar — dublikat gumoni faqat shularga tegishli.
const inRegister = new Set(REGISTER.map(([c, n]) => `${c}|${normalize(n)}`));
const inPriced = new Set();
for (const g of GROUPS) {
  for (const [n] of g.students) inPriced.add(`${g.name}|${normalize(n)}`);
}

const rows = JSON.parse(process.argv[2]);

const byClass = new Map();
for (const r of rows) {
  const k = r.class_name ?? '(sinfsiz)';
  if (!byClass.has(k)) byClass.set(k, { with: [], without: [] });
  byClass.get(k)[r.has_contract ? 'with' : 'without'].push(r.full_name);
}

let dup = 0, fresh = 0;

for (const [cls, g] of [...byClass].sort()) {
  const rowsOut = [];
  for (const name of g.without.sort()) {
    let best = null;
    for (const other of g.with) {
      const s = score(name, other);
      if (!best || s.total < best.s.total) best = { other, s: s };
    }
    const src = inPriced.has(`${cls}|${normalize(name)}`) ? 'narxli'
      : inRegister.has(`${cls}|${normalize(name)}`) ? 'rasmiy' : '?';
    const close = best && best.s.ds <= 2 && best.s.dn <= 3;
    if (close) dup++; else fresh++;
    rowsOut.push({ name, src, best, close });
  }
  if (!rowsOut.length) continue;
  console.log(`\n=== ${cls} ===`);
  for (const r of rowsOut) {
    const b = r.best;
    console.log(
      `${r.close ? 'GUMON' : '  yangi'}  ${r.name}  [${r.src}]`
      + (b ? `\n          eng yaqini: ${b.other}  (familiya farqi ${b.s.ds}, ism farqi ${b.s.dn})` : ''),
    );
  }
}

console.log(`\nJami: ${dup} ta gumonli, ${fresh} ta yangi ko'rinadi.`);
