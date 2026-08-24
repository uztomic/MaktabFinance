-- =====================================================================
--  MOLIYAVIY DVIGATEL SINOVI (TZ 8-bo'limi)
--
--  Ikkita sinov maktabi yaratiladi va quyidagilar tekshiriladi:
--    · hisoblanma qatorlari va jami (TZ 8.2 uslubida)
--    · kunlik xizmatni yo'qlik asosida qayta hisoblash (TZ 8.4)
--    · takroriy shakllantirishda dublikat yo'qligi (TZ 4.6.8)
--    · kassa kvitansiyasi ketma-ketligi (TZ 4.7.1.5)
--    · oylik hisobi va avtomatik xarajat (TZ 4.11.9)
--    · MA'LUMOTLAR AJRATILISHI (TZ 8.9) — eng muhim sinov
--
--  Skript idempotent: qayta ishga tushirsa avvalgi sinov ma'lumotini
--  o'chiradi va qaytadan quradi.
-- =====================================================================

-- --- Eski sinov ma'lumotini tozalash ---------------------------------
do $$
declare s uuid;
begin
  for s in select id from public.schools where name like 'SINOV %' loop
    delete from public.payroll_lines  where school_id = s;
    delete from public.payroll_runs   where school_id = s;
    delete from public.teacher_advances where school_id = s;
    delete from public.teacher_allowances where school_id = s;
    delete from public.expenses       where school_id = s;
    delete from public.lessons        where school_id = s;
    delete from public.teacher_branches where teacher_id in
      (select id from public.teachers where school_id = s);
    delete from public.teachers       where school_id = s;
    delete from public.cash_receipts  where school_id = s;
    delete from public.payments       where school_id = s;
    delete from public.invoice_lines  where school_id = s;
    delete from public.invoices       where school_id = s;
    delete from public.attendance_checks where school_id = s;
    delete from public.absences       where school_id = s;
    delete from public.student_services where school_id = s;
    delete from public.service_prices where school_id = s;
    delete from public.services       where school_id = s;
    delete from public.contract_versions where school_id = s;
    delete from public.contracts      where school_id = s;
    delete from public.student_parents where student_id in
      (select id from public.students where school_id = s);
    delete from public.students       where school_id = s;
    delete from public.classes        where school_id = s;
    delete from public.parents        where school_id = s;
    delete from public.closed_periods where school_id = s;
    delete from public.audit_log      where school_id = s;
    delete from public.message_queue  where school_id = s;
    delete from public.user_branches  where user_id in
      (select id from public.app_users where school_id = s);
    -- auth.users o'chirilsa app_users CASCADE bilan ketadi.
    delete from auth.users where id in (select id from public.app_users where school_id = s);
    delete from public.app_users      where school_id = s;
    delete from public.school_settings where school_id = s;
    delete from public.payroll_settings where school_id = s;
    delete from public.discount_types where school_id = s;
    delete from public.absence_reasons where school_id = s;
    delete from public.expense_categories where school_id = s;
    delete from public.calendar_days  where school_id = s;
    delete from public.counters       where school_id = s;
    delete from public.school_subscriptions where school_id = s;
    delete from public.platform_log   where school_id = s;
    delete from public.branches       where school_id = s;
    delete from public.schools        where id = s;
  end loop;
end $$;

-- =====================================================================
--  1-QADAM: IKKITA MAKTAB YARATISH
-- =====================================================================

do $$
declare
  vA jsonb; vB jsonb;
  sA uuid; bA uuid; sB uuid; bB uuid;
  v_period date := date_trunc('month', current_date)::date;
  v_uid uuid;
  st1 uuid; st2 uuid; stB uuid;
  c1 uuid; c2 uuid;
  sv_trans uuid; sv_meal uuid;
  p1 uuid;
  t1 uuid;
  disc uuid;
begin
  vA := public.provision_school('SINOV Maktab A', 'A-filial', 'basic', 30);
  vB := public.provision_school('SINOV Maktab B', 'B-filial', 'basic', 30);

  sA := (vA ->> 'school_id')::uuid;  bA := (vA ->> 'branch_id')::uuid;
  sB := (vB ->> 'school_id')::uuid;  bB := (vB ->> 'branch_id')::uuid;

  raise notice 'Maktab A: %  filial: %', sA, bA;
  raise notice 'Maktab B: %  filial: %', sB, bB;

  -- --- Maktab A buxgalteri --------------------------------------------
  v_uid := gen_random_uuid();
  insert into auth.users (id, instance_id, aud, role, email,
                          encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'buxgalter@sinovA.uz', crypt('sinov12345', gen_salt('bf')),
          now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
          now(), now());

  insert into public.app_users (id, school_id, role, full_name, email, all_branches)
  values (v_uid, sA, 'accountant', 'Sinov Buxgalter A', 'buxgalter@sinovA.uz', true);

  perform set_config('sinov.user_a', v_uid::text, false);
  perform set_config('sinov.school_a', sA::text, false);
  perform set_config('sinov.branch_a', bA::text, false);
  perform set_config('sinov.school_b', sB::text, false);
  perform set_config('sinov.branch_b', bB::text, false);

  -- --- Xizmatlar (TZ 4.4) ---------------------------------------------
  insert into public.services (school_id, branch_id, code, name, billing_type, sort_order)
  values (sA, bA, 'transport', 'Transport', 'monthly_fixed', 10)
  returning id into sv_trans;

  insert into public.services (school_id, branch_id, code, name, billing_type, sort_order)
  values (sA, bA, 'meals', 'Ovqatlanish', 'daily', 20)
  returning id into sv_meal;

  -- Narxlar (TZ 4.4.5 — amal qilish davri bilan)
  insert into public.service_prices (school_id, service_id, price, valid_from)
  values (sA, sv_trans, 300000, v_period - 365),
         (sA, sv_meal,   25000, v_period - 365);

  -- --- O'quvchilar ------------------------------------------------------
  insert into public.students (school_id, branch_id, full_name, class_name, grade_level, enrolled_on)
  values (sA, bA, 'Aliyev Alisher', '5-A', 5, v_period - 60) returning id into st1;
  insert into public.students (school_id, branch_id, full_name, class_name, grade_level, enrolled_on)
  values (sA, bA, 'Aliyeva Malika', '5-A', 5, v_period - 60) returning id into st2;

  insert into public.students (school_id, branch_id, full_name, class_name, grade_level, enrolled_on)
  values (sB, bB, 'Boshqa Maktab O''quvchisi', '1-A', 1, v_period - 60) returning id into stB;

  perform set_config('sinov.student1', st1::text, false);
  perform set_config('sinov.student2', st2::text, false);
  perform set_config('sinov.student_b', stB::text, false);

  -- --- Ota-ona ----------------------------------------------------------
  insert into public.parents (school_id, full_name, phone, telegram_id)
  values (sA, 'Aliyev Vali', '998901112233', 111222333) returning id into p1;
  insert into public.student_parents (student_id, parent_id, relation, is_primary)
  values (st1, p1, 'ota', true), (st2, p1, 'ota', true);

  -- --- Shartnomalar (TZ 4.3) -------------------------------------------
  insert into public.contracts (school_id, student_id, number, starts_on,
                                tuition_amount, due_day, billing_months)
  values (sA, st1, 'SH-001', v_period - 60, 800000, 10, 12)
  returning id into c1;

  -- Ikkinchi farzand — chegirma bilan (TZ 4.3.3)
  select id into disc from public.discount_types
   where school_id = sA and code = 'second_child';
  update public.discount_types set kind = 'amount', value = 100000 where id = disc;

  insert into public.contracts (school_id, student_id, number, starts_on,
                                tuition_amount, due_day, billing_months,
                                discount_type_id)
  values (sA, st2, 'SH-002', v_period - 60, 800000, 10, 12, disc)
  returning id into c2;

  -- --- Xizmatga yozilish ------------------------------------------------
  insert into public.student_services (school_id, student_id, service_id, starts_on)
  values (sA, st1, sv_trans, v_period - 60),
         (sA, st1, sv_meal,  v_period - 60),
         (sA, st2, sv_meal,  v_period - 60);

  perform set_config('sinov.service_meal', sv_meal::text, false);

  -- --- O'qituvchi (TZ 4.11) ---------------------------------------------
  insert into public.teachers (school_id, full_name, category, rate_factor,
                               base_salary, weekly_hours)
  values (sA, 'Karimov O''qituvchi', 'oliy', 1.0, 5000000, 24)
  returning id into t1;

  insert into public.teacher_branches (teacher_id, branch_id, load_share)
  values (t1, bA, 1.0);

  perform set_config('sinov.teacher', t1::text, false);
end $$;

-- =====================================================================
--  2-QADAM: HISOBLANMA SHAKLLANTIRISH (TZ 4.6)
-- =====================================================================

select '--- 2-QADAM: hisoblanma shakllantirish ---' as qadam;

select public.generate_invoices(
  current_setting('sinov.branch_a')::uuid,
  date_trunc('month', current_date)::date) as natija;

-- Qatorlarni ko'rish (TZ 4.6.2 — jami emas, QATORLAR)
select s.full_name         as oquvchi,
       l.kind              as tur,
       l.description       as izoh,
       l.quantity          as miqdor,
       l.unit_price        as birlik_narx,
       l.amount            as summa,
       l.is_preliminary    as dastlabki
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  join public.students s on s.id = i.student_id
 where i.branch_id = current_setting('sinov.branch_a')::uuid
   and i.period = date_trunc('month', current_date)::date
 order by s.full_name, l.sort_order;
