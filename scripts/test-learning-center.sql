-- =====================================================================
--  O'QUV MARKAZI SINOVI
--
--  Tekshiriladi:
--    · guruh yaratilganda xizmat avtomatik ochiladi
--    · guruh narxi tarix bilan (oy boshidan)
--    · guruhga yozilish → hisoblanma (to'liq oy va proporsional)
--    · sinov darsi hisoblanmaga TUSHMAYDI
--    · guruh sig'imi oshib ketmaydi
--    · darslar jadvaldan yaratiladi (bayram o'tkazib yuboriladi)
--    · davomat va o'qituvchining guruhdan foiz haqi → oylik qatori
--    · muzlatish: o'sha kunlar hisoblanmaydi
--    · guruhdan chiqish va boshqa guruhga o'tkazish
--    · jadval to'qnashuvi (xona / o'qituvchi)
--    · boshqa tashkilot guruhlarni KO'RMAYDI (RLS)
--    · tashkilot turini faqat direktor o'zgartiradi
--
--  Idempotent: o'z sinov ma'lumotini tozalab qaytadan quradi.
-- =====================================================================

-- --- Tozalash ---------------------------------------------------------
do $$
declare s uuid;
begin
  for s in select id from public.schools where name like 'SINOVLC %' loop
    delete from public.session_attendance where school_id = s;
    delete from public.group_sessions where school_id = s;
    delete from public.group_freezes  where school_id = s;
    delete from public.group_members  where school_id = s;
    delete from public.payroll_lines  where school_id = s;
    delete from public.payroll_runs   where school_id = s;
    delete from public.expenses       where school_id = s;
    delete from public.invoice_lines  where school_id = s;
    delete from public.invoices       where school_id = s;
    delete from public.student_services where school_id = s;
    delete from public.study_groups   where school_id = s;
    delete from public.service_prices where school_id = s;
    delete from public.services       where school_id = s;
    delete from public.rooms          where school_id = s;
    delete from public.courses        where school_id = s;
    delete from public.contract_versions where school_id = s;
    delete from public.contracts      where school_id = s;
    delete from public.leads          where school_id = s;
    delete from public.students       where school_id = s;
    delete from public.teacher_branches where teacher_id in
      (select id from public.teachers where school_id = s);
    delete from public.teachers       where school_id = s;
    delete from public.calendar_days  where school_id = s;
    delete from public.audit_log      where school_id = s;
    delete from public.user_branches  where user_id in
      (select id from public.app_users where school_id = s);
    delete from auth.users where id in (select id from public.app_users where school_id = s);
    delete from public.app_users      where school_id = s;
    delete from public.school_settings where school_id = s;
    delete from public.payroll_settings where school_id = s;
    delete from public.discount_types where school_id = s;
    delete from public.absence_reasons where school_id = s;
    delete from public.expense_categories where school_id = s;
    delete from public.counters       where school_id = s;
    delete from public.school_subscriptions where school_id = s;
    delete from public.platform_log   where school_id = s;
    delete from public.branches       where school_id = s;
    delete from public.schools        where id = s;
  end loop;
end $$;

-- --- Ikki tashkilot va foydalanuvchilar -------------------------------
do $$
declare
  vA jsonb; vB jsonb;
  sA uuid; bA uuid; sB uuid; bB uuid;
  uDir uuid := gen_random_uuid();
  uMgr uuid := gen_random_uuid();
  uB   uuid := gen_random_uuid();
  uT   uuid := gen_random_uuid();
begin
  vA := public.provision_school('SINOVLC Markaz A', 'Markaz', 'basic', 30);
  vB := public.provision_school('SINOVLC Markaz B', 'B', 'basic', 30);
  sA := (vA ->> 'school_id')::uuid;  bA := (vA ->> 'branch_id')::uuid;
  sB := (vB ->> 'school_id')::uuid;  bB := (vB ->> 'branch_id')::uuid;

  insert into auth.users (id, email) values
    (uDir, 'dir@lcA.uz'), (uMgr, 'mgr@lcA.uz'), (uB, 'dir@lcB.uz'), (uT, 'teach@lcA.uz');
  insert into public.app_users (id, school_id, role, full_name, all_branches) values
    (uDir, sA, 'director', 'Direktor A', true),
    (uMgr, sA, 'manager',  'Menejer A',  true),
    (uB,   sB, 'director', 'Direktor B', true),
    (uT,   sA, 'teacher',  'Ustoz A',    false);
  insert into public.user_branches (user_id, branch_id) values (uT, bA);

  perform set_config('lc.school_a', sA::text, false);
  perform set_config('lc.branch_a', bA::text, false);
  perform set_config('lc.branch_b', bB::text, false);
  perform set_config('lc.dir', uDir::text, false);
  perform set_config('lc.mgr', uMgr::text, false);
  perform set_config('lc.dir_b', uB::text, false);
  perform set_config('lc.teacher_user', uT::text, false);
end $$;

-- =====================================================================
--  1. TASHKILOT TURI
-- =====================================================================
do $$
declare v_ok boolean := false;
begin
  -- Menejer o'zgartira olmaydi.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.mgr'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.set_org_type('learning_center');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '1: menejer tashkilot turini o''zgartirdi!'; end if;

  -- Direktor o'zgartiradi.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  perform public.set_org_type('learning_center');
  if (select org_type from public.schools where id = current_setting('lc.school_a')::uuid)
       <> 'learning_center' then
    raise exception '1: tur o''zgarmadi';
  end if;
  raise notice 'OK 1 — tashkilot turini faqat direktor o''zgartiradi';
end $$;

-- =====================================================================
--  2. KURS, XONA, O'QITUVCHI, GURUH — direktor sifatida
-- =====================================================================
do $$
declare
  sA uuid := current_setting('lc.school_a')::uuid;
  bA uuid := current_setting('lc.branch_a')::uuid;
  v_period date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_course uuid; v_room uuid; v_teacher uuid; v_group uuid; v_group2 uuid;
  v_service uuid; v_price numeric;
  st1 uuid; st2 uuid; st3 uuid; st4 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid;
  v_n int; v_expected int; v_ok boolean;
  v_total numeric; v_days int; v_exp numeric;
  v_sess uuid; v_res jsonb; v_amount numeric;
  d date;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into public.courses (school_id, name, level, default_price, lesson_minutes)
  values (sA, 'Ingliz tili', 'Beginner', 500000, 90) returning id into v_course;

  insert into public.rooms (school_id, branch_id, name, capacity)
  values (sA, bA, '101-xona', 12) returning id into v_room;

  insert into public.teachers (school_id, full_name, user_id, base_type, base_salary)
  values (sA, 'Ustoz A', current_setting('lc.teacher_user')::uuid, 'fixed', 0)
  returning id into v_teacher;
  insert into public.teacher_branches (teacher_id, branch_id, load_share) values (v_teacher, bA, 1);

  insert into public.study_groups
    (school_id, branch_id, course_id, name, teacher_id, room_id, days,
     start_time, end_time, starts_on, capacity, teacher_pay_kind, teacher_pay_value)
  values
    (sA, bA, v_course, 'ENG-1 (D/Ch/J 14:00)', v_teacher, v_room, '{1,3,5}',
     '14:00', '15:30', v_period - 30, 2, 'percent', 40)
  returning id, service_id into v_group, v_service;

  if v_service is null then raise exception '2: guruh xizmati yaratilmadi'; end if;
  if (select billing_type from public.services where id = v_service) <> 'monthly_fixed' then
    raise exception '2: xizmat turi noto''g''ri';
  end if;
  raise notice 'OK 2a — guruh bilan oylik xizmat avtomatik yaratildi';

  perform public.set_group_price(v_group, 500000, v_period);
  v_price := app.group_price(v_group, v_period + 3);
  if v_price <> 500000 then raise exception '2: narx % (500000 kutilgan)', v_price; end if;

  -- Keyingi oydan narx oshdi — o'tgan oy narxi o'zgarmaydi.
  perform public.set_group_price(v_group, 550000, (v_period + interval '1 month')::date);
  if app.group_price(v_group, v_period + 3) <> 500000
     or app.group_price(v_group, (v_period + interval '1 month')::date + 3) <> 550000 then
    raise exception '2: narx tarixi buzildi';
  end if;
  raise notice 'OK 2b — narx tarixi: o''tgan oy 500 000, keyingi oy 550 000';

  -- --- O'quvchilar -------------------------------------------------------
  insert into public.students (school_id, branch_id, full_name, enrolled_on)
  values (sA, bA, 'Aliyev Ali',  v_period - 30) returning id into st1;
  insert into public.students (school_id, branch_id, full_name, enrolled_on)
  values (sA, bA, 'Botirova Bona', v_period - 30) returning id into st2;
  insert into public.students (school_id, branch_id, full_name, enrolled_on)
  values (sA, bA, 'Sinov Sardor', v_period - 30) returning id into st3;
  insert into public.students (school_id, branch_id, full_name, enrolled_on)
  values (sA, bA, 'Ortiqcha Odil', v_period - 30) returning id into st4;

  m1 := public.enroll_to_group(v_group, st1, v_period, false);
  m2 := public.enroll_to_group(v_group, st2, v_period + 15, false);  -- oy o'rtasida
  m3 := public.enroll_to_group(v_group, st3, v_period + 2, true);    -- sinov darsi

  -- Sig'im: 2 o'rin band — to'rtinchisi faol bo'lib kira olmaydi.
  v_ok := false;
  begin
    perform public.enroll_to_group(v_group, st4, v_period, false);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '2: guruh sig''imidan oshib ketdi'; end if;

  -- Ikki marta yozib bo'lmaydi.
  v_ok := false;
  begin
    perform public.enroll_to_group(v_group, st1, v_period, false);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '2: bir o''quvchi guruhga ikki marta yozildi'; end if;

  if (select count(*) from public.contracts where student_id in (st1, st2) and is_active) <> 2 then
    raise exception '2: avtomatik shartnoma ochilmadi';
  end if;
  if exists (select 1 from public.contracts where student_id = st3) then
    raise exception '2: sinov darsiga shartnoma ochilmasligi kerak edi';
  end if;
  raise notice 'OK 2c — yozilish, sinov, sig''im va dublikat tekshiruvi';

  -- =================================================================
  --  3. HISOBLANMA
  -- =================================================================
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  perform public.generate_invoices(bA, v_period);

  select coalesce(sum(il.amount), 0) into v_total
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.student_id = st1 and i.period = v_period;
  if v_total <> 500000 then
    raise exception '3: to''liq oy % (500000 kutilgan)', v_total;
  end if;

  v_days := extract(day from (v_period + interval '1 month - 1 day'))::int;
  v_exp := round(500000.0 * (v_days - 15) / v_days, 2);
  select coalesce(sum(il.amount), 0) into v_total
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.student_id = st2 and i.period = v_period;
  if v_total <> v_exp then
    raise exception '3: proporsional % (% kutilgan)', v_total, v_exp;
  end if;

  if exists (select 1 from public.invoices where student_id = st3) then
    raise exception '3: sinov darsi hisoblanmaga tushdi!';
  end if;
  raise notice 'OK 3 — hisoblanma: to''liq oy 500 000, oy o''rtasidan %, sinov — 0', v_exp;

  -- =================================================================
  --  4. DARSLAR JADVALDAN (bayram o'tkazib yuboriladi)
  -- =================================================================
  reset role;
  -- Oyning birinchi dushanbasini bayram qilamiz.
  d := v_period;
  while extract(isodow from d) <> 1 loop d := d + 1; end loop;
  insert into public.calendar_days (school_id, day, day_type, name)
  values (sA, d, 'holiday', 'Sinov bayrami');
  set local role authenticated;

  v_n := public.generate_group_sessions(v_group, v_period, (v_period + interval '1 month - 1 day')::date);
  select count(*) - 1 into v_expected
    from generate_series(v_period, (v_period + interval '1 month - 1 day')::date, '1 day') g(x)
   where extract(isodow from g.x) in (1, 3, 5);
  if v_n <> v_expected then
    raise exception '4: % ta dars yaratildi, % kutilgan', v_n, v_expected;
  end if;
  -- Idempotent.
  if public.generate_group_sessions(v_group, v_period, (v_period + interval '1 month - 1 day')::date) <> 0 then
    raise exception '4: qayta ishga tushirganda dublikat yaratildi';
  end if;
  raise notice 'OK 4 — % ta dars (D/Ch/J), bayram o''tkazib yuborildi, dublikat yo''q', v_n;

  -- =================================================================
  --  5. DAVOMAT (o'qituvchi o'zi belgilaydi) VA O'QITUVCHI HAQI
  -- =================================================================
  select id into v_sess from public.group_sessions
   where group_id = v_group and day >= v_period + 15 order by day limit 1;
  reset role;
  perform set_config('lc.session', v_sess::text, false);
  perform set_config('lc.group', v_group::text, false);
  perform set_config('lc.group_service', v_service::text, false);
  perform set_config('lc.teacher', v_teacher::text, false);
  perform set_config('lc.member1', m1::text, false);
  perform set_config('lc.member2', m2::text, false);
  perform set_config('lc.st1', st1::text, false);
  perform set_config('lc.st2', st2::text, false);
  perform set_config('lc.room', v_room::text, false);
  perform set_config('lc.period', v_period::text, false);
end $$;

-- O'qituvchi sifatida davomat (eski dars bo'lsa 7 kunlik cheklov
-- tufayli rad etiladi — shuning uchun sinovda direktor nomidan).
do $$
declare
  v_res jsonb; v_cnt int;
  v_ok boolean := false;
begin
  -- Boshqa tashkilot direktori davomat qila olmaydi.
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir_b'), 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.mark_session_attendance(current_setting('lc.session')::uuid,
      jsonb_build_array(jsonb_build_object('student_id', current_setting('lc.st1'), 'status', 'present')));
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '5: begona tashkilot davomat belgiladi!'; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  v_res := public.mark_session_attendance(
    current_setting('lc.session')::uuid,
    jsonb_build_array(
      jsonb_build_object('student_id', current_setting('lc.st1'), 'status', 'present', 'grade', 90),
      jsonb_build_object('student_id', current_setting('lc.st2'), 'status', 'absent')),
    'Present Simple', 'Ex. 1-5');

  select count(*) into v_cnt from public.session_attendance
   where session_id = current_setting('lc.session')::uuid;
  if v_cnt <> 2 then raise exception '5: davomat yozilmadi (%)', v_cnt; end if;
  if (select status from public.group_sessions where id = current_setting('lc.session')::uuid) <> 'held' then
    raise exception '5: dars "o''tdi" holatiga o''tmadi';
  end if;
  if (select count(*) from public.session_roster(current_setting('lc.session')::uuid)) < 2 then
    raise exception '5: ro''yxat noto''g''ri';
  end if;
  raise notice 'OK 5a — davomat va baho yozildi, begona tashkilot rad etildi';
end $$;

do $$
declare
  v_period date := current_setting('lc.period')::date;
  v_charged numeric; v_amount numeric; v_line numeric; v_res jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  select sum(il.amount) into v_charged
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where il.service_id = current_setting('lc.group_service')::uuid and i.period = v_period;

  select sum(amount) into v_amount from public.report_group_earnings(v_period)
   where group_id = current_setting('lc.group')::uuid;
  if v_amount <> round(v_charged * 0.40, 2) then
    raise exception '5: guruhdan foiz % (% kutilgan)', v_amount, round(v_charged * 0.40, 2);
  end if;

  v_res := public.calc_payroll(current_setting('lc.teacher')::uuid, v_period);
  select sum(amount) into v_line from public.payroll_lines
   where payroll_run_id = (v_res ->> 'payroll_run_id')::uuid and source_kind = 'groups';
  if v_line <> v_amount then
    raise exception '5: oylikda guruh qatori % (% kutilgan)', v_line, v_amount;
  end if;
  raise notice 'OK 5b — o''qituvchi haqi: % × 40%% = % oylikka tushdi', v_charged, v_amount;
end $$;

-- =====================================================================
--  6. MUZLATISH, CHIQISH, O'TKAZISH
-- =====================================================================
do $$
declare
  sA uuid := current_setting('lc.school_a')::uuid;
  bA uuid := current_setting('lc.branch_a')::uuid;
  v_next date := (current_setting('lc.period')::date + interval '1 month')::date;
  v_days int; v_total numeric; v_exp numeric; v_group2 uuid; v_new uuid;
  v_conf int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1-o'quvchi keyingi oyning 11–20 kunlarida muzlatiladi.
  perform public.freeze_group_member(current_setting('lc.member1')::uuid,
                                     v_next + 10, v_next + 19, 'Safar');
  perform public.generate_invoices(bA, v_next);

  v_days := extract(day from (v_next + interval '1 month - 1 day'))::int;
  v_exp := round(550000.0 * 10 / v_days, 2) + round(550000.0 * (v_days - 20) / v_days, 2);
  select coalesce(sum(il.amount), 0) into v_total
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.student_id = current_setting('lc.st1')::uuid and i.period = v_next;
  if v_total <> v_exp then
    raise exception '6: muzlatilgan oy % (% kutilgan)', v_total, v_exp;
  end if;
  raise notice 'OK 6a — muzlatish: 10 kun hisoblanmadi, % so''m', v_total;

  -- Ikkinchi guruh — o'sha xona, o'sha vaqtda: to'qnashuv chiqishi kerak.
  select count(*) into v_conf from public.group_conflicts(
    bA, '{1}'::smallint[], '15:00', '16:00', null,
    current_setting('lc.room')::uuid, null);
  if v_conf <> 1 then raise exception '6: xona to''qnashuvi topilmadi (%)', v_conf; end if;

  select count(*) into v_conf from public.group_conflicts(
    bA, '{2}'::smallint[], '15:00', '16:00', null,
    current_setting('lc.room')::uuid, null);
  if v_conf <> 0 then raise exception '6: soxta to''qnashuv (%)', v_conf; end if;
  raise notice 'OK 6b — jadval to''qnashuvi aniqlanadi';

  insert into public.study_groups (school_id, branch_id, name, days, start_time, end_time, starts_on)
  values (sA, bA, 'ENG-2', '{2,4}', '10:00', '11:30', v_next - 40)
  returning id into v_group2;
  perform public.set_group_price(v_group2, 400000, v_next);

  -- 2-o'quvchi keyingi oyning 16-sanasidan ENG-2 ga o'tadi.
  v_new := public.transfer_group_member(current_setting('lc.member2')::uuid, v_group2, v_next + 15);
  if (select status from public.group_members where id = current_setting('lc.member2')::uuid) <> 'left' then
    raise exception '6: eski a''zolik yopilmadi';
  end if;

  perform public.generate_invoices(bA, v_next);
  v_exp := round(550000.0 * 15 / v_days, 2) + round(400000.0 * (v_days - 15) / v_days, 2);
  select coalesce(sum(il.amount), 0) into v_total
    from public.invoice_lines il join public.invoices i on i.id = il.invoice_id
   where i.student_id = current_setting('lc.st2')::uuid and i.period = v_next;
  if v_total <> v_exp then
    raise exception '6: o''tkazilgan oy % (% kutilgan)', v_total, v_exp;
  end if;
  raise notice 'OK 6c — guruhdan guruhga o''tkazish: ikki guruh ulushi bilan %', v_total;
end $$;

-- =====================================================================
--  7. AJRATILISH (RLS)
-- =====================================================================
do $$
declare v_n int; v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', current_setting('lc.dir_b'), 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.study_groups;
  if v_n <> 0 then raise exception '7: B tashkiloti A guruhlarini ko''rdi (%)', v_n; end if;
  select count(*) into v_n from public.group_members;
  if v_n <> 0 then raise exception '7: B tashkiloti A a''zolarini ko''rdi'; end if;
  select count(*) into v_n from public.courses;
  if v_n <> 0 then raise exception '7: B tashkiloti A kurslarini ko''rdi'; end if;
  select count(*) into v_n from public.session_attendance;
  if v_n <> 0 then raise exception '7: B tashkiloti A davomatini ko''rdi'; end if;

  begin
    perform public.enroll_to_group(current_setting('lc.group')::uuid,
                                   current_setting('lc.st1')::uuid, current_date, true);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception '7: B tashkiloti A guruhiga o''quvchi yozdi!'; end if;

  begin
    update public.study_groups set name = 'BUZILDI' where id = current_setting('lc.group')::uuid;
  end;
  if exists (select 1 from public.study_groups where name = 'BUZILDI') then
    raise exception '7: B tashkiloti A guruhini o''zgartirdi!';
  end if;
  raise notice 'OK 7 — boshqa tashkilot guruh, a''zo, kurs, davomatni ko''rmaydi va o''zgartirmaydi';
end $$;

-- Xavfsizlik invariantlari.
select tekshiruv, holat from app.security_invariants();

select 'O''QUV MARKAZI SINOVI TUGADI — xato bo''lmasa hammasi o''tdi' as natija;
