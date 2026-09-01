// =====================================================================
//  O'ZBEKISTON BAYRAMLARINI KALENDARGA YUKLASH
//
//  Manba — Google ning O'zbekiston bayramlari kalendari (ochiq ICS
//  tasmasi). U ikki sababga ko'ra tanlandi:
//
//    · KO'CHIRILGAN dam olish kunlarini ham beradi ("Day off for
//      Nowruz"). Hukumat har yili bayram dam olishini ish kuniga
//      ko'chiradi va buni qo'lda kuzatib borish unutiladi.
//    · Ramazon va Qurbon hayiti sanasi har yili siljiydi — ular ham
//      shu tasmada.
//
//  Nager.Date va OpenHolidays O'zbekistonni QO'LLAMAYDI (tekshirildi:
//  Markaziy Osiyodan faqat Qozog'iston bor).
//
//  Skript FAQAT QO'SHADI. Qo'lda kiritilgan kunga tegmaydi: maktab
//  o'z ta'tilini belgilagan bo'lsa, u saqlanib qoladi.
//
//    node scripts/import-holidays.mjs 2026 --dry
//    node scripts/import-holidays.mjs 2026
//    node scripts/import-holidays.mjs 2026 "Turon Ilm Xazinasi"
// =====================================================================

import { execFileSync } from 'node:child_process';

const YEAR = Number(process.argv[2]) || new Date().getFullYear();
const DRY = process.argv.includes('--dry');
const SCHOOL = process.argv.find((a, i) => i > 2 && !a.startsWith('--'));

const FEED = 'https://calendar.google.com/calendar/ical/'
  + 'en.uz%23holiday%40group.v.calendar.google.com/public/basic.ics';

/** Ba'zi nomlarning o'zbekcha muqobili. Topilmasa asl nomi qoladi. */
const UZ = {
  'New Year': 'Yangi yil',
  'New Year Holiday': 'Yangi yil (dam olish)',
  'Defenders of the Motherland Day': 'Vatan himoyachilari kuni',
  "International Women's Day": 'Xotin-qizlar kuni',
  'Nowruz': 'Navro\'z',
  'Remembrance Day': 'Xotira va qadrlash kuni',
  'Independence Day': 'Mustaqillik kuni',
  'Teachers Day': 'O\'qituvchi va murabbiylar kuni',
  'Constitution Day': 'Konstitutsiya kuni',
  'Ramadan Eid': 'Ramazon hayiti',
  'Eid al-Fitr': 'Ramazon hayiti',
  'Kurban Eid': 'Qurbon hayiti',
  'Eid al-Adha': 'Qurbon hayiti',
  'Eid al-Adha Holiday': 'Qurbon hayiti (dam olish)',
  'Eid al-Fitr Holiday': 'Ramazon hayiti (dam olish)',
  'Independence Day Holiday': 'Mustaqillik kuni (dam olish)',
};

/**
 *  Dam olish kuni EMAS, shunchaki belgi.
 *
 *  Tasmada "Ramadan Start" kabi yozuvlar ham bor — ular ro'za
 *  boshlanishini bildiradi, ish kuni esa odatdagidek davom etadi.
 *  Ularni bayram deb belgilash butun maktabni bekorga uyga
 *  yuborardi.
 */
const NOT_A_DAY_OFF = [
  /^Ramadan Start/i,
  /^Ramadan End/i,
  /^March Equinox/i,
  /Solstice/i,
];

const uzName = (en) => {
  if (UZ[en]) return UZ[en];
  const m = en.match(/^Day off for (.+)$/);
  if (m) return `${UZ[m[1]] ?? m[1]} (dam olish)`;
  return en;
};

const sql = (q) => JSON.parse(execFileSync('node', ['scripts/db.mjs', 'sql', q], {
  encoding: 'utf8', maxBuffer: 32e6,
}));
const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

// --- Tasmani o'qish -------------------------------------------------------
const res = await fetch(FEED);
if (!res.ok) {
  console.error(`Tasma ochilmadi: ${res.status}`);
  process.exit(1);
}
const ics = await res.text();

//  ICS da uzun qator keyingi qatorga bo'sh joy bilan ko'chiriladi.
const flat = ics.replace(/\r?\n[ \t]/g, '');

const events = [...flat.matchAll(
  /BEGIN:VEVENT[\s\S]*?DTSTART;VALUE=DATE:(\d{8})[\s\S]*?SUMMARY:([^\r\n]+)[\s\S]*?END:VEVENT/g,
)].map((m) => ({
  day: `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`,
  name: uzName(m[2].trim()),
})).filter((e) => e.day.startsWith(String(YEAR)))
  .filter((e) => !NOT_A_DAY_OFF.some((re) => re.test(e.name)));

//  Bir kunda bir necha yozuv bo'lishi mumkin — nomlarini birlashtiramiz.
const byDay = new Map();
for (const e of events) {
  byDay.set(e.day, byDay.has(e.day) ? `${byDay.get(e.day)}, ${e.name}` : e.name);
}
const days = [...byDay.entries()].sort();

console.log(`${YEAR}-yil bayramlari: ${days.length} ta\n`);
for (const [d, n] of days) console.log(`  ${d}  ${n}`);

// --- Maktablar --------------------------------------------------------------
const schools = sql(`
  select id, name from public.schools
   where deleted_at is null
     ${SCHOOL ? `and name = ${q(SCHOOL)}` : ''}
   order by name`);

console.log(`\nMaktab: ${schools.length} ta`);

if (DRY) {
  console.log('\n(quruq yugurish — hech narsa yozilmadi)');
  process.exit(0);
}

// --- Yozish -------------------------------------------------------------------
//  `on conflict do nothing` — qo'lda kiritilgan kunga TEGILMAYDI.
//  Maktab o'z ta'tilini belgilagan bo'lsa, u saqlanib qoladi.
let total = 0;
for (const s of schools) {
  const values = days
    .map(([d, n]) => `(${q(s.id)}, null, ${q(d)}, 'holiday', ${q(n)})`)
    .join(',\n    ');

  const rows = sql(`
    insert into public.calendar_days (school_id, branch_id, day, day_type, name)
    values
      ${values}
    on conflict do nothing
    returning day`);

  console.log(`  ${s.name}: ${rows.length} ta yangi`);
  total += rows.length;
}

console.log(`\nJami qo'shildi: ${total}`);
console.log('Eslatma: hayit sanalari hukumat qarori bilan siljishi mumkin —');
console.log('e\'lon qilingandan keyin skriptni qayta yugurtiring.');
