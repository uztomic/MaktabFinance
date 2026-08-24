-- =====================================================================
--  demo-data.sql — "Namuna maktabi" ga real ko'rinishdagi ma'lumot.
--
--  Maqsad: panelga birinchi marta kirganda tizim BO'SH ko'rinmasin va
--  har bir modul ishlayotgani ko'rinsin.
--
--  Bu ma'lumot ISHLAB CHIQARISHGA emas, ko'rsatish va o'rganish uchun.
--  Haqiqiy maktab uchun `scripts/new-school.mjs` bilan toza maktab
--  yarating.
--
--  Ishga tushirish:
--    node scripts/db.mjs file scripts/demo-data.sql
-- =====================================================================

-- --- Avval sinov maktablarini tozalaymiz ----------------------------
do $$
declare s uuid;
begin
  for s in select id from public.schools where name like 'SINOV %' loop
    delete from public.payroll_lines      where school_id = s;
    delete from public.payroll_runs       where school_id = s;
    delete from public.teacher_advances   where school_id = s;
    delete from public.teacher_allowances where school_id = s;
    delete from public.expenses           where school_id = s;
    delete from public.lessons            where school_id = s;
    delete from public.teacher_branches   where teacher_id in
      (select id from public.teachers where school_id = s);
    delete from public.teachers           where school_id = s;
    delete from public.cash_receipts      where school_id = s;
    delete from public.payment_proofs     where school_id = s;
    delete from public.payments           where school_id = s;
    delete from public.invoice_lines      where school_id = s;
    delete from public.invoices           where school_id = s;
    delete from public.attendance_checks  where school_id = s;
    delete from public.absences           where school_id = s;
    delete from public.student_services   where school_id = s;
    delete from public.service_prices     where school_id = s;
    delete from public.services           where school_id = s;
    delete from public.contract_versions  where school_id = s;
    delete from public.contracts          where school_id = s;
    delete from public.student_parents    where student_id in
      (select id from public.students where school_id = s);
    delete from public.students           where school_id = s;
    delete from public.parents            where school_id = s;
    delete from public.closed_periods     where school_id = s;
    delete from public.audit_log          where school_id = s;
    delete from public.message_queue      where school_id = s;
    delete from auth.users where id in
      (select id from public.app_users where school_id = s);
    delete from public.app_users          where school_id = s;
    delete from public.school_settings    where school_id = s;
    delete from public.payroll_settings   where school_id = s;
    delete from public.discount_types     where school_id = s;
    delete from public.absence_reasons    where school_id = s;
    delete from public.expense_categories where school_id = s;
    delete from public.calendar_days      where school_id = s;
    delete from public.counters           where school_id = s;
    delete from public.school_subscriptions where school_id = s;
    delete from public.platform_log       where school_id = s;
    delete from public.branches           where school_id = s;
    delete from public.schools            where id = s;
  end loop;
  raise notice 'Sinov maktablari tozalandi.';
end $$;

-- =====================================================================
--  NAMUNA MA'LUMOTLARI
-- =====================================================================

do $$
declare
  sid uuid; bid uuid; uid uuid;
  v_period date := date_trunc('month', current_date)::date;
  sv_meal uuid; sv_bus uuid;
  disc2 uuid;
  st uuid; par uuid; te uuid;
  names text[] := array[
    'Aliyev Sardor','Karimova Nilufar','Rahimov Bekzod','Yusupova Malika',
    'Toshmatov Jasur','Ergasheva Zilola','Nazarov Otabek','Sultonova Dilnoza',
    'Qodirov Shohrux','Ibrohimova Sevara','Mirzayev Aziz','Xolmatova Gulnora'
  ];
  classes text[] := array['5-A','5-A','5-A','5-A','5-A','5-A',
                          '6-B','6-B','6-B','6-B','6-B','6-B'];
  i int;
  v_tuition numeric;
begin
  select id into sid from public.schools where name = 'Namuna maktabi';
  if sid is null then
    raise exception 'Avval maktab yarating: node scripts/new-school.mjs "Namuna maktabi" direktor@namuna.uz';
  end if;

  select id into bid from public.branches where school_id = sid limit 1;
  select id into uid from public.app_users where school_id = sid limit 1;

  -- Takroriy ishga tushirishda eski namuna ma'lumotini tozalaymiz.
  delete from public.payroll_lines    where school_id = sid;
  delete from public.payroll_runs     where school_id = sid;
  delete from public.expenses         where school_id = sid;
  delete from public.lessons          where school_id = sid;
  delete from public.teacher_branches where teacher_id in
    (select id from public.teachers where school_id = sid);
  delete from public.teachers         where school_id = sid;
  delete from public.cash_receipts    where school_id = sid;
  delete from public.payments         where school_id = sid;
  delete from public.invoice_lines    where school_id = sid;
  delete from public.invoices         where school_id = sid;
  delete from public.attendance_checks where school_id = sid;
  delete from public.absences         where school_id = sid;
  delete from public.student_services where school_id = sid;
  delete from public.service_prices   where school_id = sid;
  delete from public.services         where school_id = sid;
  delete from public.contract_versions where school_id = sid;
  delete from public.contracts        where school_id = sid;
  delete from public.student_parents  where student_id in
    (select id from public.students where school_id = sid);
  delete from public.students         where school_id = sid;
  delete from public.parents          where school_id = sid;

  -- --- Xizmatlar (TZ 4.4) ------------------------------------------
  insert into public.services (school_id, branch_id, code, name, billing_type, sort_order)
  values (sid, bid, 'meals', 'Ovqatlanish', 'daily', 10)
  returning id into sv_meal;

  insert into public.services (school_id, branch_id, code, name, billing_type, sort_order)
  values (sid, bid, 'transport', 'Transport', 'monthly_fixed', 20)
  returning id into sv_bus;

  insert into public.service_prices (school_id, service_id, price, valid_from, created_by)
  values (sid, sv_meal, 25000, v_period - 400, uid),
         (sid, sv_bus, 300000, v_period - 400, uid);

  -- --- Chegirma turi ------------------------------------------------
  select id into disc2 from public.discount_types
   where school_id = sid and code = 'second_child';

  -- --- O'quvchilar, ota-onalar, shartnomalar -----------------------
  for i in 1 .. array_length(names, 1) loop
    insert into public.students
      (school_id, branch_id, full_name, class_name, grade_level, enrolled_on)
    values
      (sid, bid, names[i], classes[i],
       case when classes[i] like '5%' then 5 else 6 end,
       v_period - 300)
    returning id into st;

    -- Ota-ona
    insert into public.parents (school_id, full_name, phone)
    values (sid,
            split_part(names[i], ' ', 1) || ' ota-onasi',
            '9989' || lpad((10000000 + i * 137)::text, 8, '0'))
    returning id into par;

    insert into public.student_parents (student_id, parent_id, relation, is_primary)
    values (st, par, 'ota', true);

    -- Shartnoma. Har xil summa — hisobot rang-barang chiqsin.
    v_tuition := 800000 + (i % 3) * 100000;

    insert into public.contracts
      (school_id, student_id, number, starts_on, tuition_amount,
       due_day, billing_months, discount_type_id)
    values
      (sid, st, 'SH-' || lpad(i::text, 3, '0'), v_period - 300, v_tuition,
       10, 12,
       -- Har uchinchisiga 2-farzand chegirmasi
       case when i % 3 = 0 then disc2 else null end);

    -- Xizmatlar: hammasi ovqatlanadi, yarmi transportdan foydalanadi.
    insert into public.student_services
      (school_id, student_id, service_id, starts_on, created_by)
    values (sid, st, sv_meal, v_period - 300, uid);

    if i % 2 = 0 then
      insert into public.student_services
        (school_id, student_id, service_id, starts_on, created_by)
      values (sid, st, sv_bus, v_period - 300, uid);
    end if;
  end loop;

  -- --- O'qituvchilar (TZ 4.11) -------------------------------------
  for i in 1 .. 3 loop
    insert into public.teachers
      (school_id, full_name, category, rate_factor, base_salary,
       weekly_hours, hired_on)
    values
      (sid,
       (array['Sobirov Anvar','Yo''ldosheva Kamola','Nurmatov Rustam'])[i],
       (array['oliy','birinchi','ikkinchi'])[i],
       (array[1.0, 0.5, 1.0])[i],
       (array[6000000, 6000000, 4500000])[i],
       (array[24, 12, 20])[i],
       v_period - 500)
    returning id into te;

    insert into public.teacher_branches (teacher_id, branch_id, load_share)
    values (te, bid, 1.0);

    -- Sinf rahbarligi ustamasi — birinchi ikkitasiga.
    if i <= 2 then
      insert into public.teacher_allowances
        (school_id, teacher_id, code, starts_on)
      values (sid, te, 'class_teacher', v_period - 300);
    end if;

    -- Darslar: shu oyning ish kunlarida.
    insert into public.lessons
      (school_id, branch_id, teacher_id, day, hours, kind, subject, created_by)
    select sid, bid, te, g.day::date,
           (array[2, 1, 2])[i],
           'held',
           (array['Matematika','Ona tili','Fizika'])[i],
           uid
      from generate_series(
             v_period,
             least(current_date, (v_period + interval '1 month - 1 day')::date),
             interval '1 day') g(day)
     where app.working_days(sid, bid, g.day::date, g.day::date) = 1;
  end loop;

  -- --- Oylik formulasini to'ldiramiz --------------------------------
  --  Bu VAQTINCHALIK namuna qiymatlari. Haqiqiy formula buxgalter
  --  bilan kelishilgach Sozlamalar bo'limidan kiritiladi (TZ 7.1).
  update public.payroll_settings set value = '"fixed"'::jsonb
   where school_id = sid and key = 'base_type';

  update public.payroll_settings
     set value = '[{"code":"class_teacher","name":"Sinf rahbarligi","type":"percent","value":15},{"code":"notebooks","name":"Daftar tekshirish","type":"fixed","value":200000},{"code":"club","name":"To''garak","type":"fixed","value":0}]'::jsonb
   where school_id = sid and key = 'allowances';

  update public.payroll_settings
     set value = '[{"code":"income_tax","name":"Daromad solig''i","type":"percent","value":12}]'::jsonb
   where school_id = sid and key = 'deductions';

  -- --- Xarajatlar ---------------------------------------------------
  insert into public.expenses
    (school_id, branch_id, category_id, amount, spent_on, payment_method, note, created_by)
  select sid, bid, c.id, x.amount, v_period + x.day_offset, x.method, x.note, uid
    from (values
      ('rent',       12000000, 2,  'bank', 'Oylik ijara'),
      ('utilities',   2400000, 4,  'bank', 'Elektr va suv'),
      ('internet',     450000, 5,  'bank', 'Internet'),
      ('kitchen',     3800000, 7,  'cash', 'Oshxona mahsulotlari'),
      ('stationery',   620000, 9,  'cash', 'Kanselyariya')
    ) as x(code, amount, day_offset, method, note)
    join public.expense_categories c
      on c.school_id = sid and c.code = x.code;

  raise notice 'Namuna ma''lumotlari yaratildi.';
end $$;

-- =====================================================================
--  HISOBLANMA, TO'LOV VA OYLIKNI SHAKLLANTIRAMIZ
-- =====================================================================

do $$
declare
  sid uuid; bid uuid;
  v_period date := date_trunc('month', current_date)::date;
  r record; i int := 0;
  v_res jsonb;
begin
  select id into sid from public.schools where name = 'Namuna maktabi';
  select id into bid from public.branches where school_id = sid limit 1;

  -- Hisoblanma (TZ 4.6)
  v_res := public.generate_invoices(bid, v_period);
  raise notice 'Hisoblanma: %', v_res;

  -- To'lovlar: o'quvchilarning bir qismi to'lagan — qarzdorlik
  -- ro'yxati bo'sh bo'lmasin, lekin hammasi qarzdor ham bo'lmasin.
  for r in
    select i2.student_id, t.total
      from public.invoices i2
      join public.v_invoice_totals t on t.invoice_id = i2.id
     where i2.branch_id = bid and i2.period = v_period
     order by i2.created_at
  loop
    i := i + 1;
    if i % 3 = 0 then
      continue;                                   -- to'lamagan
    elsif i % 3 = 1 then
      perform public.register_cash_payment(
        r.student_id, round(r.total), current_date, 'Namuna: to''liq to''lov');
    else
      perform public.register_cash_payment(
        r.student_id, round(r.total * 0.6), current_date, 'Namuna: qisman to''lov');
    end if;
  end loop;

  -- Oylik hisobi (TZ 4.11)
  for r in select id from public.teachers where school_id = sid loop
    perform public.calc_payroll(r.id, v_period);
  end loop;

  raise notice 'To''lovlar va oylik hisoblari yaratildi.';
end $$;

-- --- Natija -----------------------------------------------------------
select
  (select count(*) from public.students s
     join public.schools sc on sc.id = s.school_id
    where sc.name = 'Namuna maktabi')                        as oquvchilar,
  (select count(*) from public.invoices i
     join public.schools sc on sc.id = i.school_id
    where sc.name = 'Namuna maktabi')                        as hisoblanmalar,
  (select count(*) from public.payments p
     join public.schools sc on sc.id = p.school_id
    where sc.name = 'Namuna maktabi')                        as tolovlar,
  (select count(*) from public.payroll_runs pr
     join public.schools sc on sc.id = pr.school_id
    where sc.name = 'Namuna maktabi')                        as oylik_hisoblari,
  (select round(sum(v.balance)) from public.v_student_balances v
     join public.schools sc on sc.id = v.school_id
    where sc.name = 'Namuna maktabi' and v.balance > 0)      as jami_qarzdorlik;
