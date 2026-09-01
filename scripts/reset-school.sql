-- =====================================================================
--  MAKTABNI YANGI OCHILGAN HOLATGA QAYTARISH
--
--  Direktordan boshqa hech narsa qolmaydi: o'quvchilar, sinflar,
--  shartnomalar, hisoblanmalar, to'lovlar, xodimlar va ularning
--  hisoblari — hammasi o'chadi.
--
--  QOLADIGANLARI va NEGA:
--    · maktabning o'zi va filiali — ularsiz kirish ham ishlamaydi
--    · direktor va uning hisobi — tizimga kiradigan odam kerak
--    · ma'lumotnomalar (to'lov usullari, yo'qlik sabablari, xarajat
--      turlari, oylik sozlamalari) — yangi ochilgan maktabda ham
--      ular tayyor holda beriladi
--    · obuna yozuvi — u platforma qismiga tegishli va to'lov tarixi
--      bilan bog'liq
--
--  ISHLATISHDAN OLDIN nusxa oling:
--      node scripts/backup-school.mjs "Turon Ilm Xazinasi"
--
--  Bu amal QAYTARIB BO'LMAYDI.
-- =====================================================================

do $$
declare
  v_school   uuid;
  v_director uuid;
  v_name     text := 'Turon Ilm Xazinasi';
begin
  select id into v_school from public.schools where name = v_name;
  if v_school is null then
    raise exception 'Maktab topilmadi: %', v_name;
  end if;

  --  Qoladigan odam: eng birinchi yaratilgan direktor.
  select id into v_director
    from public.app_users
   where school_id = v_school and role = 'director' and deleted_at is null
   order by created_at
   limit 1;

  if v_director is null then
    raise exception 'Direktor topilmadi — tozalashdan keyin kirish yo''li qolmaydi';
  end if;

  raise notice 'Maktab: %  direktor: %', v_school, v_director;

  -- --- Moliya (bog'liqlik tartibida) --------------------------------
  delete from public.invoice_lines   where school_id = v_school;
  delete from public.cash_receipts   where school_id = v_school;
  delete from public.payment_proofs  where school_id = v_school;
  delete from public.payments        where school_id = v_school;
  delete from public.invoices        where school_id = v_school;
  delete from public.bank_statement_rows where school_id = v_school;
  delete from public.bank_statements where school_id = v_school;
  delete from public.expenses        where school_id = v_school;
  delete from public.closed_periods  where school_id = v_school;

  -- --- Oylik ---------------------------------------------------------
  delete from public.payroll_lines     where school_id = v_school;
  delete from public.payroll_runs      where school_id = v_school;
  delete from public.teacher_advances  where school_id = v_school;
  delete from public.teacher_allowances where school_id = v_school;
  delete from public.lessons           where school_id = v_school;
  delete from public.teacher_branches
   where teacher_id in (select id from public.teachers where school_id = v_school);
  delete from public.teachers          where school_id = v_school;

  -- --- Kontingent ----------------------------------------------------
  delete from public.absences          where school_id = v_school;
  delete from public.attendance_checks where school_id = v_school;
  delete from public.student_services  where school_id = v_school;
  delete from public.student_parents
   where student_id in (select id from public.students where school_id = v_school);
  delete from public.contract_versions
   where contract_id in (select id from public.contracts where school_id = v_school);
  delete from public.contracts         where school_id = v_school;
  delete from public.students          where school_id = v_school;
  delete from public.parents           where school_id = v_school;
  delete from public.classes           where school_id = v_school;

  -- --- Murojaatlar va xabarlar ---------------------------------------
  delete from public.lead_events
   where lead_id in (select id from public.leads where school_id = v_school);
  delete from public.leads             where school_id = v_school;
  delete from public.message_queue     where school_id = v_school;
  delete from public.support_messages
   where thread_id in (select id from public.support_threads where school_id = v_school);
  delete from public.support_threads   where school_id = v_school;

  -- --- Xizmatlar (maktab o'zi qo'shgani) ------------------------------
  delete from public.service_prices
   where service_id in (select id from public.services where school_id = v_school);
  delete from public.services          where school_id = v_school;
  delete from public.discount_types    where school_id = v_school;

  -- --- Xodimlar: direktordan boshqasi ---------------------------------
  --  Shaxsiy huquqlar ham ketadi (CASCADE), lekin oldindan
  --  o'chiramiz — jadval yangi va CASCADE ga tayanmagan ma'qul.
  delete from public.user_permissions
   where user_id in (
     select id from public.app_users
      where school_id = v_school and id <> v_director);
  delete from public.user_branches
   where user_id in (
     select id from public.app_users
      where school_id = v_school and id <> v_director);
  delete from public.app_users
   where school_id = v_school and id <> v_director;

  -- --- Jurnal ---------------------------------------------------------
  --  "Yangi ochilgan maktab kabi" degani jurnal ham toza bo'lishi.
  --  Amalning O'ZI esa platforma jurnalida qoladi.
  delete from public.audit_log  where school_id = v_school;
  delete from public.counters   where school_id = v_school;

  raise notice 'Tozalandi.';
end $$;

--  Natija.
select 'oquvchi' as nima, count(*) from public.students st
  join public.schools s on s.id = st.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'sinf', count(*) from public.classes c
  join public.schools s on s.id = c.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'shartnoma', count(*) from public.contracts c
  join public.schools s on s.id = c.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'hisoblanma', count(*) from public.invoices i
  join public.schools s on s.id = i.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'tolov', count(*) from public.payments p
  join public.schools s on s.id = p.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'oqituvchi', count(*) from public.teachers t
  join public.schools s on s.id = t.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'foydalanuvchi', count(*) from public.app_users u
  join public.schools s on s.id = u.school_id where s.name = 'Turon Ilm Xazinasi'
union all select 'tolov_usuli', count(*) from public.payment_methods pm
  join public.schools s on s.id = pm.school_id where s.name = 'Turon Ilm Xazinasi'
order by 1;
