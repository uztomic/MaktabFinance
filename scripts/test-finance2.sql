-- =====================================================================
--  SINOV — 2-QISM
--  Yo'qlik, qayta hisoblash, kassa, oylik, davr qulfi.
--  Identifikatorlar nom bo'yicha topiladi (sessiya o'zgaruvchisi emas).
-- =====================================================================

do $$
declare
  sA uuid; bA uuid; sB uuid;
  st1 uuid; st2 uuid;
  sv_meal uuid;
  t1 uuid;
  v_period date := date_trunc('month', current_date)::date;
  v_month_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_res jsonb;
  v_wd int;
  v_total numeric;
  v_lines int;
  v_lines2 int;
  v_day date;
  v_reason uuid;
  v_run uuid;
  v_exp numeric;
  v_receipt1 bigint; v_receipt2 bigint;
begin
  select id into sA from public.schools where name = 'SINOV Maktab A';
  select id into sB from public.schools where name = 'SINOV Maktab B';
  select id into bA from public.branches where school_id = sA limit 1;
  select id into st1 from public.students where school_id = sA and full_name = 'Aliyev Alisher';
  select id into st2 from public.students where school_id = sA and full_name = 'Aliyeva Malika';
  select id into sv_meal from public.services where school_id = sA and code = 'meals';
  select id into t1 from public.teachers where school_id = sA limit 1;

  v_wd := app.working_days(sA, bA, v_period, v_month_end);
  raise notice '--- Davrdagi ish kunlari: % ---', v_wd;

  -- =================================================================
  --  SINOV 1: To'liq oy hisoblanmasi (TZ 4.6.2)
  -- =================================================================
  select count(*) into v_lines from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where i.student_id = st1 and i.period = v_period;

  select total into v_total from public.v_invoice_totals
   where student_id = st1 and period = v_period;

  raise notice 'Alisher: % ta qator, jami %', v_lines, v_total;
  -- Kutilgan: 800000 (o'qish) + 300000 (transport) + ish_kunlari*25000
  if v_total <> 800000 + 300000 + (v_wd * 25000) then
    raise exception 'XATO: Alisher jami % kutilgan % emas',
      v_total, 800000 + 300000 + (v_wd * 25000);
  end if;
  raise notice 'OK — o''qish + transport + ovqatlanish to''g''ri';

  select total into v_total from public.v_invoice_totals
   where student_id = st2 and period = v_period;
  if v_total <> 800000 + (v_wd * 25000) - 100000 then
    raise exception 'XATO: Malika (chegirma bilan) jami %', v_total;
  end if;
  raise notice 'OK — chegirma to''g''ri qo''llandi (2-farzand)';

  -- =================================================================
  --  SINOV 2: Idempotentlik (TZ 4.6.8)
  -- =================================================================
  perform public.generate_invoices(bA, v_period);
  perform public.generate_invoices(bA, v_period);

  select count(*) into v_lines2 from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
   where i.student_id = st1 and i.period = v_period;

  if v_lines2 <> v_lines then
    raise exception 'XATO: takroriy shakllantirish dublikat yaratdi (% → %)',
      v_lines, v_lines2;
  end if;

  if (select count(*) from public.invoices
       where student_id = st1 and period = v_period and status <> 'cancelled') <> 1 then
    raise exception 'XATO: bir davrda bir nechta hisoblanma yaratildi';
  end if;
  raise notice 'OK — TZ 4.6.8: uch marta shakllantirildi, dublikat yo''q';

  -- =================================================================
  --  SINOV 3: Yo'qlik va qayta hisoblash (TZ 4.6.1, 8.4)
  -- =================================================================

  -- Avval qayd etuv to'liq emas — finalize TO'XTASHI kerak.
  begin
    perform public.finalize_invoices(bA, v_period);
    raise exception 'XATO: yo''qlik to''liq emas, lekin finalize ishladi!';
  exception when sqlstate '23514' then
    raise notice 'OK — TZ 4.6.1.2: qayd etuv to''liq emas, qayta hisoblash to''xtatildi';
  end;

  -- Barcha ish kunlarini "ko'rib chiqilgan" deb belgilaymiz.
  for v_day in
    select g.day::date from generate_series(v_period, v_month_end, interval '1 day') g(day)
     where app.working_days(sA, bA, g.day::date, g.day::date) = 1
  loop
    insert into public.attendance_checks (school_id, branch_id, day, class_name, absent_count)
    values (sA, bA, v_day, '5-A', 0)
    on conflict do nothing;
  end loop;

  -- Alisher 3 kun kelmadi (kasallik — pul olinmaydi).
  select id into v_reason from public.absence_reasons
   where school_id = sA and code = 'sick';

  insert into public.absences (school_id, branch_id, student_id, day, reason_id, marked_by)
  select sA, bA, st1, g.day::date, v_reason, null
    from generate_series(v_period, v_month_end, interval '1 day') g(day)
   where app.working_days(sA, bA, g.day::date, g.day::date) = 1
   limit 3
  on conflict do nothing;

  v_res := public.finalize_invoices(bA, v_period);
  raise notice 'finalize: %', v_res;

  select total into v_total from public.v_invoice_totals
   where student_id = st1 and period = v_period;

  if v_total <> 800000 + 300000 + ((v_wd - 3) * 25000) then
    raise exception 'XATO: qayta hisoblashdan keyin jami % kutilgan %',
      v_total, 800000 + 300000 + ((v_wd - 3) * 25000);
  end if;
  raise notice 'OK — TZ 8.4: 3 kun yo''qlik hisobdan chiqdi (% kun × 25000)', v_wd - 3;

  -- Dastlabki qator qolmasligi kerak.
  if exists (select 1 from public.invoice_lines l
               join public.invoices i on i.id = l.invoice_id
              where i.branch_id = bA and i.period = v_period and l.is_preliminary) then
    raise exception 'XATO: yakuniy hisoblanmada dastlabki qator qoldi';
  end if;
  raise notice 'OK — barcha kunlik qatorlar yakuniy holatga o''tdi';

  -- =================================================================
  --  SINOV 4: Kassa kvitansiyasi ketma-ketligi (TZ 4.7.1.5)
  -- =================================================================
  v_res := public.register_cash_payment(st1, 500000, current_date, 'Sinov to''lovi 1');
  v_receipt1 := (v_res ->> 'receipt_no')::bigint;
  v_res := public.register_cash_payment(st2, 300000, current_date, 'Sinov to''lovi 2');
  v_receipt2 := (v_res ->> 'receipt_no')::bigint;

  if v_receipt2 <> v_receipt1 + 1 then
    raise exception 'XATO: kvitansiya ketma-ketligi uzildi (% → %)', v_receipt1, v_receipt2;
  end if;
  raise notice 'OK — TZ 4.7.1.5: kvitansiya raqamlari uzluksiz (%, %)', v_receipt1, v_receipt2;

  -- Balans to'lovdan keyin kamayishi kerak.
  select balance into v_total from public.v_student_balances where student_id = st1;
  if v_total <> (800000 + 300000 + ((v_wd - 3) * 25000)) - 500000 then
    raise exception 'XATO: to''lovdan keyin balans %', v_total;
  end if;
  raise notice 'OK — TZ 4.8.1: qarzdorlik = hisoblanma − to''lov = %', v_total;

  -- =================================================================
  --  SINOV 5: Chek qarzdorlikni YOPMASLIGI (TZ 4.7.3)
  -- =================================================================
  insert into public.payment_proofs
    (school_id, branch_id, student_id, amount_claimed, status)
  values (sA, bA, st1, 200000, 'pending');

  select balance into v_total from public.v_student_balances where student_id = st1;
  if v_total <> (800000 + 300000 + ((v_wd - 3) * 25000)) - 500000 then
    raise exception 'XATO: tasdiqlanmagan chek qarzdorlikni o''zgartirdi!';
  end if;
  raise notice 'OK — TZ 4.7.3: tasdiqlanmagan chek qarzdorlikka TA''SIR QILMADI';

  -- =================================================================
  --  SINOV 6: Oylik hisobi (TZ 4.11)
  -- =================================================================

  -- Sozlamalarni to'ldiramiz (buxgalter shu kabi qiladi).
  update public.payroll_settings set value = '12'::jsonb
   where school_id = sA and key = 'deductions';
  update public.payroll_settings
     set value = '[{"code":"income_tax","name":"Daromad solig''i","type":"percent","value":12}]'::jsonb
   where school_id = sA and key = 'deductions';
  update public.payroll_settings
     set value = '[{"code":"class_teacher","name":"Sinf rahbarligi","type":"percent","value":15},{"code":"notebooks","name":"Daftar tekshirish","type":"fixed","value":200000}]'::jsonb
   where school_id = sA and key = 'allowances';

  insert into public.teacher_allowances (school_id, teacher_id, code, starts_on)
  values (sA, t1, 'class_teacher', v_period - 30),
         (sA, t1, 'notebooks', v_period - 30)
  on conflict do nothing;

  insert into public.teacher_advances (school_id, branch_id, teacher_id, period, amount, paid_on)
  values (sA, bA, t1, v_period, 2000000, v_period + 14);

  v_res := public.calc_payroll(t1, v_period);
  raise notice 'Oylik: %', v_res;

  -- Kutilgan: 5 000 000 (qat'iy)
  --         + 750 000 (sinf rahbarligi 15%)
  --         + 200 000 (daftar tekshirish)
  --         = 5 950 000 jami
  --         − 714 000 (soliq 12%)
  --         − 2 000 000 (avans)
  --         = 3 236 000 → 1000 gacha yaxlitlangan
  if (v_res ->> 'gross')::numeric <> 5950000 then
    raise exception 'XATO: oylik jami (gross) % kutilgan 5950000', v_res ->> 'gross';
  end if;
  if (v_res ->> 'net')::numeric <> 3236000 then
    raise exception 'XATO: oylik sof (net) % kutilgan 3236000', v_res ->> 'net';
  end if;
  raise notice 'OK — TZ 4.11: ustama + ushlanma + avans + yaxlitlash to''g''ri';

  select count(*) into v_lines from public.payroll_lines
   where payroll_run_id = (v_res ->> 'payroll_run_id')::uuid;
  raise notice 'OK — TZ 4.11.7: qaydnomada % ta qator (har biri source bilan)', v_lines;

  -- --- Tasdiqlash → avtomatik xarajat (TZ 4.11.9) -------------------
  v_run := (v_res ->> 'payroll_run_id')::uuid;
  v_res := public.approve_payroll(v_run);

  select sum(amount) into v_exp from public.expenses where payroll_run_id = v_run;
  if v_exp <> 3236000 then
    raise exception 'XATO: avtomatik xarajat % kutilgan 3236000', v_exp;
  end if;
  raise notice 'OK — TZ 4.11.9/4.10.2: oylik avtomatik xarajat bo''ldi (%)', v_exp;

  -- Avtomatik xarajatni qo'lda o'zgartirib bo'lmasligi.
  begin
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated')::text, true);
    update public.expenses set amount = 1 where payroll_run_id = v_run;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'XATO: avtomatik xarajat qo''lda o''zgartirildi!';
  exception when sqlstate '42501' then
    perform set_config('request.jwt.claims', '', true);
    raise notice 'OK — TZ 4.10.2: avtomatik xarajat qo''lda o''zgarmaydi';
  end;

  -- =================================================================
  --  SINOV 7: Davr qulfi (TZ 5.4.9)
  -- =================================================================
  insert into public.closed_periods (school_id, period, branch_id)
  values (sA, v_period, null) on conflict do nothing;

  begin
    insert into public.payments (school_id, branch_id, student_id, amount,
                                 channel, status, paid_on)
    values (sA, bA, st1, 1000, 'cash', 'confirmed', v_period + 5);
    raise exception 'XATO: yopilgan davrga to''lov kiritildi!';
  exception when sqlstate '42501' then
    raise notice 'OK — TZ 5.4.9: yopilgan davrga yozib bo''lmaydi';
  end;

  delete from public.closed_periods where school_id = sA and period = v_period;

  -- =================================================================
  --  SINOV 8: Audit jurnali (TZ 5.4.10)
  -- =================================================================
  select count(*) into v_lines from public.audit_log where school_id = sA;
  if v_lines = 0 then
    raise exception 'XATO: audit jurnali bo''sh';
  end if;
  raise notice 'OK — TZ 5.4.10: audit jurnalida % ta yozuv', v_lines;

  raise notice '';
  raise notice '=========== BARCHA MOLIYAVIY SINOVLAR O''TDI ===========';
end $$;

-- Yakuniy hisoblanma ko'rinishi
select s.full_name as oquvchi, l.kind as tur, l.description as izoh,
       l.quantity as miqdor, l.unit_price as birlik, l.amount as summa
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  join public.students s on s.id = i.student_id
  join public.schools sc on sc.id = i.school_id
 where sc.name = 'SINOV Maktab A'
   and i.period = date_trunc('month', current_date)::date
 order by s.full_name, l.sort_order;
