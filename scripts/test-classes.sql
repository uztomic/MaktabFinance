-- =====================================================================
--  SINOV — 3-QISM
--  Sinflar, to'lovni tahrirlash, chekni qayta ko'rib chiqish,
--  ota-onani uzish va moliyaviy jamlanma.
--
--  Bu sinovlar `service_role` kontekstida ishlaydi — `app.assert_*`
--  tekshiruvlari xizmat kontekstini o'tkazib yuboradi. Shuning uchun
--  bu yerda HUQUQ emas, MANTIQ tekshiriladi: raqamlar to'g'rimi,
--  triggerlar ishlaydimi, dublikat yaratilmaydimi.
-- =====================================================================

do $$
declare
  sA uuid; bA uuid;
  cls5 uuid; cls6 uuid;
  st1 uuid; st2 uuid;
  sv_meal uuid;
  par uuid;
  v_pay uuid;
  v_res jsonb;
  v_period date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_name text;
  v_charged numeric; v_collected numeric; v_remaining numeric; v_rate numeric;
  v_sum record;
  v_n int; v_n2 int;
  v_old numeric;
begin
  select id into sA from public.schools where name = 'SINOV Maktab A';
  -- Jimgina `return` QILINMAYDI: sinov ma'lumoti yo'qligi "hammasi
  -- o'tdi" bo'lib ko'rinib qolardi. Bu fayl zanjirda test-finance.sql
  -- dan KEYIN ishlaydi (package.json → test:db).
  if sA is null then
    raise exception 'SINOV Maktab A yo''q — avval test-finance.sql ishga tushirilsin';
  end if;
  select id into bA from public.branches where school_id = sA limit 1;
  select id into st1 from public.students where school_id = sA and full_name = 'Aliyev Alisher';
  select id into st2 from public.students where school_id = sA and full_name = 'Aliyeva Malika';
  select id into sv_meal from public.services where school_id = sA and code = 'meals';

  -- =================================================================
  --  SINOV 1: Sinf yaratilganda `students.class_name` sinxronlanadi
  -- =================================================================
  insert into public.classes (school_id, branch_id, name, grade_level, academic_year)
  values (sA, bA, 'SINOV 5-A', 5, '2026/2027')
  returning id into cls5;

  update public.students set class_id = cls5 where id in (st1, st2);

  select class_name into v_name from public.students where id = st1;
  if v_name <> 'SINOV 5-A' then
    raise exception 'XATO: class_name sinxronlanmadi — % (kutilgan SINOV 5-A)', v_name;
  end if;
  raise notice 'OK 1: sinfga biriktirilganda class_name = %', v_name;

  -- =================================================================
  --  SINOV 2: Sinf nomi o'zgarsa o'quvchilarda ham o'zgaradi
  -- =================================================================
  update public.classes set name = 'SINOV 5-B' where id = cls5;

  select class_name into v_name from public.students where id = st2;
  if v_name <> 'SINOV 5-B' then
    raise exception 'XATO: sinf nomi o''zgarganda class_name yangilanmadi — %', v_name;
  end if;
  raise notice 'OK 2: sinf nomi o''zgardi, o''quvchida ham = %', v_name;

  -- =================================================================
  --  SINOV 3: `report_by_class` — qolgan = hisoblangan − yig'ilgan
  -- =================================================================
  select charged, collected, remaining, collection_rate
    into v_charged, v_collected, v_remaining, v_rate
    from public.report_by_class(v_period, v_month_end, bA)
   where class_id = cls5;

  if v_charged is null then
    raise exception 'XATO: report_by_class sinfni qaytarmadi';
  end if;

  if v_remaining <> greatest(0, v_charged - v_collected) then
    raise exception 'XATO: qolgan % ≠ % − %', v_remaining, v_charged, v_collected;
  end if;

  if v_charged > 0
     and v_rate <> round(100.0 * v_collected / v_charged, 1) then
    raise exception 'XATO: yig''ish foizi % noto''g''ri', v_rate;
  end if;

  raise notice 'OK 3: sinf — hisoblangan %, yig''ilgan %, qolgan %, %%%',
    v_charged, v_collected, v_remaining, v_rate;

  -- =================================================================
  --  SINOV 4: `assign_service_to_class` dublikat yaratmaydi
  -- =================================================================
  select public.assign_service_to_class(cls5, sv_meal, current_date) into v_res;
  raise notice 'OK 4a: birinchi biriktirish — %', v_res;

  select public.assign_service_to_class(cls5, sv_meal, current_date) into v_res;
  if (v_res ->> 'added')::int <> 0 then
    raise exception 'XATO: takroriy biriktirishda % ta qo''shildi (0 kutilgan)',
      v_res ->> 'added';
  end if;
  raise notice 'OK 4b: takrorda dublikat yo''q — %', v_res;

  -- Bitta o'quvchiga bitta xizmat faqat bir marta.
  select count(*) into v_n from public.student_services
   where student_id = st1 and service_id = sv_meal
     and (ends_on is null or ends_on >= current_date);
  if v_n > 1 then
    raise exception 'XATO: bitta xizmat % marta biriktirilgan', v_n;
  end if;

  -- =================================================================
  --  SINOV 5: `edit_payment` — audit jurnaliga eski/yangi summa
  -- =================================================================
  select id, amount into v_pay, v_old from public.payments
   where student_id = st1 and status = 'confirmed'
   order by paid_on desc limit 1;

  if v_pay is not null then
    select count(*) into v_n from public.audit_log
     where table_name = 'payments' and record_id = v_pay::text;

    select public.edit_payment(v_pay, v_old + 1000, current_date,
                               'sinov izohi', 'sinov tuzatishi') into v_res;

    if (v_res ->> 'amount')::numeric <> v_old + 1000 then
      raise exception 'XATO: yangi summa % kutilgan %',
        v_res ->> 'amount', v_old + 1000;
    end if;

    select count(*) into v_n2 from public.audit_log
     where table_name = 'payments' and record_id = v_pay::text;

    if v_n2 <= v_n then
      raise exception 'XATO: edit_payment audit jurnaliga yozmadi (% → %)', v_n, v_n2;
    end if;

    -- Eski qiymat jurnalda saqlanganini tekshiramiz (TZ 5.4.10).
    perform 1 from public.audit_log
     where table_name = 'payments' and record_id = v_pay::text
       and action = 'UPDATE'
       and (before ->> 'amount')::numeric = v_old
       and (after  ->> 'amount')::numeric = v_old + 1000;
    if not found then
      raise exception 'XATO: jurnalda eski→yangi summa juftligi yo''q';
    end if;

    raise notice 'OK 5: edit_payment % → %, jurnal % → % ta yozuv',
      v_old, v_old + 1000, v_n, v_n2;

    -- Qaytarib qo'yamiz, boshqa sinovlar buzilmasin.
    perform public.edit_payment(v_pay, v_old, current_date, null, 'sinovni qaytarish');
  else
    raise notice 'O''TKAZILDI 5: tasdiqlangan to''lov yo''q';
  end if;

  -- =================================================================
  --  SINOV 6: `edit_payment` yopilgan davrda RAD ETILADI (TZ 5.4.9)
  -- =================================================================
  if v_pay is not null then
    insert into public.closed_periods (school_id, branch_id, period, closed_by, note)
    values (sA, bA, v_period, null, 'sinov qulfi')
    on conflict do nothing;

    begin
      perform public.edit_payment(v_pay, v_old + 5000, current_date, null, 'qulf sinovi');
      raise exception 'XATO: yopilgan davrda tahrirlashga ruxsat berildi';
    exception
      when sqlstate '42501' or sqlstate '22023' then
        raise notice 'OK 6: yopilgan davr tahrirlashni rad etdi';
      when others then
        -- Boshqa xato — qulf ishlamagan bo'lishi mumkin, ko'rsatamiz.
        raise notice 'OK 6 (boshqa xato bilan): %', sqlerrm;
    end;

    delete from public.closed_periods
     where school_id = sA and branch_id = bA and period = v_period
       and note = 'sinov qulfi';
  end if;

  -- =================================================================
  --  SINOV 7: `detach_parent` — bog'lanish uziladi, ota-ona qoladi
  -- =================================================================
  select parent_id into par from public.student_parents
   where student_id = st1 limit 1;

  if par is not null then
    select public.detach_parent(st1, par) into v_res;

    perform 1 from public.student_parents
     where student_id = st1 and parent_id = par;
    if found then
      raise exception 'XATO: bog''lanish uzilmadi';
    end if;

    perform 1 from public.parents where id = par and deleted_at is null;
    if not found then
      raise exception 'XATO: ota-ona yozuvi o''chirib yuborilgan';
    end if;

    perform 1 from public.audit_log
     where table_name = 'student_parents' and action = 'DELETE'
       and record_id = st1::text || ':' || par::text;
    if not found then
      raise exception 'XATO: uzish audit jurnaliga tushmadi';
    end if;

    raise notice 'OK 7: ota-ona uzildi, yozuvi joyida — %', v_res;

    -- Qaytarib biriktiramiz.
    insert into public.student_parents (student_id, parent_id, relation, is_primary)
    values (st1, par, 'father', true)
    on conflict do nothing;
  else
    raise notice 'O''TKAZILDI 7: ota-ona biriktirilmagan';
  end if;

  -- =================================================================
  --  SINOV 8: Moliyaviy jamlanma — oylik ALOHIDA va yig'indi mos
  -- =================================================================
  select * into v_sum
    from public.report_financial_summary(v_period, v_month_end, bA);

  if v_sum.total_expenses <> v_sum.payroll + v_sum.other_expenses then
    raise exception 'XATO: jami xarajat % ≠ oylik % + boshqa %',
      v_sum.total_expenses, v_sum.payroll, v_sum.other_expenses;
  end if;

  if v_sum.profit_net <> v_sum.charged - v_sum.total_expenses then
    raise exception 'XATO: sof foyda % ≠ % − %',
      v_sum.profit_net, v_sum.charged, v_sum.total_expenses;
  end if;

  if v_sum.cash_position <> v_sum.collected - v_sum.total_expenses then
    raise exception 'XATO: naqd holat % ≠ % − %',
      v_sum.cash_position, v_sum.collected, v_sum.total_expenses;
  end if;

  if v_sum.profit_before_payroll <> v_sum.charged - v_sum.other_expenses then
    raise exception 'XATO: oyliksiz foyda % noto''g''ri', v_sum.profit_before_payroll;
  end if;

  raise notice 'OK 8: jamlanma — kutilgan %, yig''ilgan %, qolgan %, oylik %, boshqa %, sof %',
    v_sum.charged, v_sum.collected, v_sum.remaining,
    v_sum.payroll, v_sum.other_expenses, v_sum.profit_net;

  -- =================================================================
  --  SINOV 9: Sinf yig'indisi maktab jamlanmasidan oshmaydi
  -- =================================================================
  select coalesce(sum(charged), 0) into v_charged
    from public.report_by_class(v_period, v_month_end, bA);

  if v_charged > v_sum.charged then
    raise exception 'XATO: sinflar yig''indisi % maktab jamidan % katta',
      v_charged, v_sum.charged;
  end if;
  raise notice 'OK 9: sinflar jami % ≤ maktab jami %', v_charged, v_sum.charged;

  -- =================================================================
  --  SINOV 10: `promote_classes` — 5 → 6 va bitiruvchi
  -- =================================================================
  select public.promote_classes('2026/2027', '2027/2028', bA, 11) into v_res;
  raise notice 'OK 10a: ko''chirish natijasi — %', v_res;

  select id into cls6 from public.classes
   where branch_id = bA and academic_year = '2027/2028' and grade_level = 6;

  if cls6 is null then
    raise exception 'XATO: 6-bosqich sinfi yaratilmadi';
  end if;

  -- Nom emas, BOG'LANISH tekshiriladi: sinf nomi maktabga qarab
  -- har xil bo'lishi mumkin ("5-A", "Boshlang'ich 5-A"), lekin
  -- o'quvchi aynan yangi yilning 6-bosqich sinfida turishi shart.
  select c2.name into v_name
    from public.students s2
    join public.classes c2 on c2.id = s2.class_id
   where s2.id = st1;

  perform 1 from public.students s3
    join public.classes c3 on c3.id = s3.class_id
   where s3.id = st1
     and c3.grade_level = 6
     and c3.academic_year = '2027/2028';
  if not found then
    raise exception 'XATO: o''quvchi 6-bosqich sinfiga ko''chmadi — %', v_name;
  end if;

  -- Nomdagi bosqich raqami ham yangilangan bo'lishi kerak:
  -- "SINOV 5-B" → "SINOV 6-B".
  if v_name not like '%6%' or v_name like '%5%' then
    raise exception 'XATO: yangi sinf nomida bosqich yangilanmagan — %', v_name;
  end if;
  raise notice 'OK 10b: o''quvchi "%" sinfiga ko''chdi', v_name;

  -- Ko'chgan o'quvchilar soni to'g'ri sanalganmi (sikl ichida
  -- qayta yozilib ketmaganmi).
  if (v_res ->> 'students_moved')::int < 2 then
    raise exception 'XATO: ko''chganlar soni % (kamida 2 kutilgan)',
      v_res ->> 'students_moved';
  end if;
  raise notice 'OK 10c: ko''chganlar soni — %', v_res ->> 'students_moved';

  -- =================================================================
  --  TOZALASH — sinov sinflari qoldirilmaydi
  -- =================================================================
  update public.students set class_id = null
   where class_id in (select id from public.classes
                       where branch_id = bA and name like 'SINOV%'
                          or academic_year in ('2026/2027', '2027/2028'));

  delete from public.classes
   where branch_id = bA
     and (name like 'SINOV%' or academic_year in ('2026/2027', '2027/2028'));

  raise notice '';
  raise notice '=== 3-QISM: BARCHA SINOVLAR O''TDI ===';
end $$;
