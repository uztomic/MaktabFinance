import { execFileSync } from 'node:child_process';
import { GROUPS } from './turon-data.mjs';

const norm = (n) => n.toLowerCase()
  .replace(/[''''`\u02bb\u02bc\u2018\u2019]/g, '')
  .replace(/x/g, 'h').replace(/q/g, 'k')
  .replace(/ch/g, 'c').replace(/sh/g, 's')
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const out = execFileSync('node', ['scripts/db.mjs', 'sql', `
  select st.full_name, st.class_name,
         (select c.tuition_amount::bigint from public.contracts c
           where c.student_id=st.id and c.is_active) as narx
    from public.students st
    join public.branches b on b.id=st.branch_id
    join public.schools s on s.id=b.school_id
   where s.name='Turon Ilm Xazinasi' and st.deleted_at is null`],
  { encoding: 'utf8', maxBuffer: 32e6 });
const db = JSON.parse(out);

//  Bazadagi ismlarni soddalashtirilgan shaklda indekslash.
const byNorm = new Map();
for (const r of db) {
  const k = norm(r.full_name);
  if (!byNorm.has(k)) byNorm.set(k, []);
  byNorm.get(k).push(r);
}

for (const g of GROUPS) {
  const inDb = db.filter((r) => r.class_name === g.name).length;
  if (inDb === g.students.length) continue;

  console.log(`\n### ${g.name}: manbada ${g.students.length}, bazada ${inDb}\n`);
  for (const [name, price] of g.students) {
    const hit = byNorm.get(norm(name)) ?? [];
    const here = hit.find((r) => r.class_name === g.name);
    if (here) continue;
    if (hit.length === 0) {
      console.log(`   YO'Q         ${name} (${price ?? '—'})`);
    } else {
      for (const h of hit) {
        console.log(`   BOSHQA SINF  ${name} (manba ${price ?? '—'})`
          + `  →  ${h.full_name} [${h.class_name}] ${h.narx ?? 'shartnomasiz'}`);
      }
    }
  }
}
