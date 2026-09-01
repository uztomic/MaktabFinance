// =====================================================================
//  MAKTAB MA'LUMOTINI FAYLGA NUSXALASH
//
//  Tozalashdan OLDIN ishlatiladi. Ma'lumotni o'chirish qaytarib
//  bo'lmaydigan amal, shuning uchun undan oldin nusxa olinadi:
//  "adashib o'chirdik" degan holat har qanday tizimda bo'ladi va
//  o'sha paytda nusxa bo'lmasa, gapiradigan narsa qolmaydi.
//
//  Nusxa `backups/` papkasiga tushadi va git ga KIRMAYDI: ichida
//  bolalarning ismi, ota-onasining telefoni va to'lov summasi bor.
//
//    node scripts/backup-school.mjs "Turon Ilm Xazinasi"
// =====================================================================

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const school = process.argv[2];
if (!school) {
  console.error("Maktab nomini ko'rsating");
  process.exit(1);
}

function sql(q) {
  const out = execFileSync('node', ['scripts/db.mjs', 'sql', q], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const esc = school.replace(/'/g, "''");

//  Maktabga bog'liq jadvallar. Tartib muhim emas — bu faqat nusxa.
const TABLES = {
  schools:          `select * from public.schools where name = '${esc}'`,
  branches:         `select b.* from public.branches b join public.schools s on s.id=b.school_id where s.name='${esc}'`,
  app_users:        `select u.* from public.app_users u join public.schools s on s.id=u.school_id where s.name='${esc}'`,
  classes:          `select c.* from public.classes c join public.schools s on s.id=c.school_id where s.name='${esc}'`,
  students:         `select st.* from public.students st join public.schools s on s.id=st.school_id where s.name='${esc}'`,
  parents:          `select p.* from public.parents p join public.schools s on s.id=p.school_id where s.name='${esc}'`,
  student_parents:  `select sp.* from public.student_parents sp join public.students st on st.id=sp.student_id join public.schools s on s.id=st.school_id where s.name='${esc}'`,
  contracts:        `select c.* from public.contracts c join public.schools s on s.id=c.school_id where s.name='${esc}'`,
  services:         `select sv.* from public.services sv join public.schools s on s.id=sv.school_id where s.name='${esc}'`,
  student_services: `select ss.* from public.student_services ss join public.students st on st.id=ss.student_id join public.schools s on s.id=st.school_id where s.name='${esc}'`,
  invoices:         `select i.* from public.invoices i join public.schools s on s.id=i.school_id where s.name='${esc}'`,
  invoice_lines:    `select l.* from public.invoice_lines l join public.schools s on s.id=l.school_id where s.name='${esc}'`,
  payments:         `select p.* from public.payments p join public.schools s on s.id=p.school_id where s.name='${esc}'`,
  cash_receipts:    `select r.* from public.cash_receipts r join public.schools s on s.id=r.school_id where s.name='${esc}'`,
  teachers:         `select t.* from public.teachers t join public.schools s on s.id=t.school_id where s.name='${esc}'`,
  teacher_branches: `select tb.* from public.teacher_branches tb join public.teachers t on t.id=tb.teacher_id join public.schools s on s.id=t.school_id where s.name='${esc}'`,
  lessons:          `select l.* from public.lessons l join public.schools s on s.id=l.school_id where s.name='${esc}'`,
  payroll_runs:     `select pr.* from public.payroll_runs pr join public.schools s on s.id=pr.school_id where s.name='${esc}'`,
  payroll_lines:    `select pl.* from public.payroll_lines pl join public.schools s on s.id=pl.school_id where s.name='${esc}'`,
  expenses:         `select e.* from public.expenses e join public.schools s on s.id=e.school_id where s.name='${esc}'`,
  absences:         `select a.* from public.absences a join public.schools s on s.id=a.school_id where s.name='${esc}'`,
  school_settings:  `select ss.* from public.school_settings ss join public.schools s on s.id=ss.school_id where s.name='${esc}'`,
};

const dump = { school, taken_at: new Date().toISOString(), tables: {} };

for (const [name, q] of Object.entries(TABLES)) {
  try {
    const rows = sql(q);
    dump.tables[name] = rows;
    console.log(`  ${name.padEnd(18)} ${rows.length}`);
  } catch (e) {
    //  Jadval yo'q bo'lishi mumkin (platforma qismi boshqa repoda).
    console.log(`  ${name.padEnd(18)} — o'tkazib yuborildi`);
  }
}

mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const file = `backups/${school.replace(/[^\w]+/g, '-')}-${stamp}.json`;
writeFileSync(file, JSON.stringify(dump, null, 2));

const total = Object.values(dump.tables).reduce((s, r) => s + r.length, 0);
console.log(`\nNusxa: ${file}`);
console.log(`Jami ${total} ta yozuv`);
