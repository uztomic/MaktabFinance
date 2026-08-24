-- =====================================================================
--  MA'LUMOTLAR AJRATILISHI SINOVI (TZ 8.9, 5.5.7)
--
--  "Ikkinchi maktab hisobidan birinchi maktab ma'lumotiga murojaat
--   qilib bo'lmaydi."
--
--  Bu eng muhim sinov: agar u yiqilsa, tizimni ishga tushirib
--  bo'lmaydi. Sinov HAQIQIY RLS orqali o'tkaziladi — `authenticated`
--  roliga o'tib, JWT claim'ini A maktabining buxgalteriga qo'yamiz va
--  B maktabining ma'lumotini so'raymiz.
-- =====================================================================

begin;

do $$
declare
  sA uuid; sB uuid; uidA uuid;
  v_students int; v_invoices int; v_payments int; v_schools int;
  v_branches int; v_audit int; v_teachers int;
  v_bal int; v_platform int;
  v_school_seen uuid;
begin
  select id into sA from public.schools where name = 'SINOV Maktab A';
  select id into sB from public.schools where name = 'SINOV Maktab B';
  select id into uidA from public.app_users where school_id = sA limit 1;

  if uidA is null then
    raise exception 'Sinov ma''lumoti yo''q — avval test-finance.sql ni ishga tushiring';
  end if;

  -- --- A maktabi buxgalteri sifatida kiramiz ------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', uidA::text, 'role', 'authenticated')::text, true);

  set local role authenticated;

  -- --- Kontekst funksiyalari to'g'ri ishlayaptimi -------------------
  if app.school_id() <> sA then
    raise exception 'app.school_id() noto''g''ri: % (kutilgan %)', app.school_id(), sA;
  end if;
  raise notice 'OK — kontekst: app.school_id() = A maktabi';

  -- =================================================================
  --  1. O'QUVCHILAR — faqat A maktabiniki ko'rinishi kerak
  -- =================================================================
  select count(*) into v_students from public.students;
  if v_students <> 2 then
    raise exception 'XATO: % ta o''quvchi ko''rindi, 2 ta kutilgan edi', v_students;
  end if;

  if exists (select 1 from public.students where school_id = sB) then
    raise exception 'JIDDIY XATO: B maktabining o''quvchisi KO''RINDI!';
  end if;
  raise notice 'OK — TZ 8.9: B maktabining o''quvchilari ko''rinmaydi';

  -- To'g'ridan-to'g'ri ID bo'yicha so'rasa ham ko'rinmasligi kerak.
  if exists (
    select 1 from public.students
     where id = (select id from public.students s2 where s2.school_id = sB limit 1)
  ) then
    raise exception 'JIDDIY XATO: B o''quvchisi ID bo''yicha ochildi!';
  end if;
  raise notice 'OK — ID bo''yicha to''g''ridan-to''g''ri murojaat ham bloklandi';

  -- =================================================================
  --  2. MOLIYAVIY JADVALLAR
  -- =================================================================
  select count(*) into v_invoices from public.invoices where school_id = sB;
  if v_invoices <> 0 then
    raise exception 'JIDDIY XATO: B maktabining hisoblanmalari ko''rindi!';
  end if;

  select count(*) into v_payments from public.payments where school_id = sB;
  if v_payments <> 0 then
    raise exception 'JIDDIY XATO: B maktabining to''lovlari ko''rindi!';
  end if;

  select count(*) into v_teachers from public.teachers where school_id = sB;
  if v_teachers <> 0 then
    raise exception 'JIDDIY XATO: B maktabining o''qituvchilari ko''rindi!';
  end if;
  raise notice 'OK — hisoblanma, to''lov va o''qituvchi jadvallari ajratilgan';

  -- =================================================================
  --  3. KO'RINISHLAR (VIEW) — security_invoker tekshiruvi
  --
  --  Bu alohida muhim: PostgreSQL 15+ da ko'rinish STANDART holatda
  --  EGASI huquqi bilan ishlaydi va RLS ni chetlab o'tadi. Agar
  --  security_invoker qo'yilmagan bo'lsa, shu yerda yiqiladi.
  -- =================================================================
  select count(*) into v_bal from public.v_student_balances where school_id = sB;
  if v_bal <> 0 then
    raise exception 'JIDDIY XATO: v_student_balances RLS ni CHETLAB O''TDI!';
  end if;

  if exists (select 1 from public.v_invoice_totals where school_id = sB) then
    raise exception 'JIDDIY XATO: v_invoice_totals RLS ni CHETLAB O''TDI!';
  end if;

  if exists (select 1 from public.v_payroll_totals where school_id = sB) then
    raise exception 'JIDDIY XATO: v_payroll_totals RLS ni CHETLAB O''TDI!';
  end if;
  raise notice 'OK — ko''rinishlar security_invoker bilan ishlayapti';

  -- =================================================================
  --  4. HISOBOT FUNKSIYALARI — ular ham RLS ostida bo'lishi kerak
  -- =================================================================
  if exists (
    select 1 from public.report_pnl(current_date - 60, current_date) r
     where r.branch_id in (select id from public.branches b where b.school_id = sB)
  ) then
    raise exception 'JIDDIY XATO: report_pnl B maktabining filialini ko''rsatdi!';
  end if;

  if exists (
    select 1 from public.report_debts() d
     where d.branch_id in (select id from public.branches b where b.school_id = sB)
  ) then
    raise exception 'JIDDIY XATO: report_debts B maktabini ko''rsatdi!';
  end if;
  raise notice 'OK — hisobot funksiyalari RLS ostida (security invoker)';

  -- =================================================================
  --  5. MAKTABLAR VA FILIALLAR
  -- =================================================================
  select count(*) into v_schools from public.schools;
  if v_schools <> 1 then
    raise exception 'XATO: % ta maktab ko''rindi, 1 ta kutilgan', v_schools;
  end if;

  select id into v_school_seen from public.schools;
  if v_school_seen <> sA then
    raise exception 'XATO: noto''g''ri maktab ko''rindi';
  end if;

  select count(*) into v_branches from public.branches where school_id = sB;
  if v_branches <> 0 then
    raise exception 'JIDDIY XATO: B maktabining filiali ko''rindi!';
  end if;
  raise notice 'OK — maktab va filiallar ajratilgan';

  -- =================================================================
  --  6. AUDIT JURNALI
  -- =================================================================
  select count(*) into v_audit from public.audit_log where school_id = sB;
  if v_audit <> 0 then
    raise exception 'JIDDIY XATO: B maktabining audit jurnali ko''rindi!';
  end if;
  raise notice 'OK — audit jurnali ajratilgan';

  -- =================================================================
  --  7. PLATFORMA JADVALLARI (TZ 5.4.11)
  -- =================================================================
  select count(*) into v_platform from public.platform_admins;
  if v_platform <> 0 then
    raise exception 'JIDDIY XATO: maktab xodimi platform_admins ni ko''rdi!';
  end if;

  if exists (select 1 from public.platform_log) then
    raise exception 'JIDDIY XATO: maktab xodimi platforma jurnalini ko''rdi!';
  end if;
  raise notice 'OK — TZ 5.4.11: platforma jadvallari maktabga ko''rinmaydi';

  -- =================================================================
  --  8. YOZUV URINISHLARI — boshqa maktabga yozib bo'lmasligi
  -- =================================================================
  begin
    insert into public.students (school_id, branch_id, full_name)
    values (sB, (select id from public.branches b where b.school_id = sB limit 1),
            'Buzg''unchi yozuv');
    raise exception 'JIDDIY XATO: B maktabiga o''quvchi YOZILDI!';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'OK — B maktabiga yozish bloklandi';
    when others then
      if sqlstate = '42501' then
        raise notice 'OK — B maktabiga yozish bloklandi (RLS)';
      else
        raise notice 'OK — B maktabiga yozish bloklandi (%)', sqlstate;
      end if;
  end;

  -- =================================================================
  --  9. MOLIYAVIY JADVALGA TO'G'RIDAN-TO'G'RI YOZISH (TZ 5.4.6)
  --
  --  "Moliyaviy amallar FAQAT SERVER TOMONDA bajariladi" —
  --  ya'ni PostgREST orqali to'lov yozib bo'lmasligi kerak.
  -- =================================================================
  begin
    insert into public.payments (school_id, branch_id, student_id, amount,
                                 channel, status, paid_on)
    values (sA, (select id from public.branches where school_id = sA limit 1),
            (select id from public.students limit 1), 999999, 'cash', 'confirmed',
            current_date);
    raise exception 'JIDDIY XATO: mijoz to''g''ridan-to''g''ri TO''LOV YOZDI!';
  exception
    when insufficient_privilege then
      raise notice 'OK — TZ 5.4.6: mijoz to''lov jadvaliga yoza olmaydi';
    when others then
      if sqlstate in ('42501', '23514') then
        raise notice 'OK — TZ 5.4.6: mijoz to''lov jadvaliga yoza olmaydi';
      else
        raise;
      end if;
  end;

  begin
    insert into public.invoices (school_id, branch_id, student_id, period, due_date)
    values (sA, (select id from public.branches where school_id = sA limit 1),
            (select id from public.students limit 1),
            date_trunc('month', current_date)::date, current_date);
    raise exception 'JIDDIY XATO: mijoz to''g''ridan-to''g''ri HISOBLANMA YOZDI!';
  exception
    when insufficient_privilege then
      raise notice 'OK — TZ 5.4.6: mijoz hisoblanma jadvaliga yoza olmaydi';
    when others then
      if sqlstate in ('42501', '23514') then
        raise notice 'OK — TZ 5.4.6: mijoz hisoblanma jadvaliga yoza olmaydi';
      else
        raise;
      end if;
  end;

  -- =================================================================
  --  10. AUDIT JURNALINI O'ZGARTIRISH (TZ 5.4.13, 4.13.7)
  -- =================================================================
  begin
    update public.audit_log set action = 'SOXTA' where school_id = sA;
    raise exception 'JIDDIY XATO: audit jurnali O''ZGARTIRILDI!';
  exception
    when insufficient_privilege then
      raise notice 'OK — TZ 5.4.13: audit jurnalini o''zgartirib bo''lmaydi';
    when others then
      if sqlstate in ('42501', '23514') then
        raise notice 'OK — TZ 5.4.13: audit jurnalini o''zgartirib bo''lmaydi';
      else
        raise;
      end if;
  end;

  begin
    delete from public.audit_log where school_id = sA;
    raise exception 'JIDDIY XATO: audit jurnali O''CHIRILDI!';
  exception
    when insufficient_privilege then
      raise notice 'OK — TZ 4.13.7: audit jurnalini o''chirib bo''lmaydi';
    when others then
      if sqlstate in ('42501', '23514') then
        raise notice 'OK — TZ 4.13.7: audit jurnalini o''chirib bo''lmaydi';
      else
        raise;
      end if;
  end;

  raise notice '';
  raise notice '======= MA''LUMOTLAR AJRATILISHI SINOVI TO''LIQ O''TDI =======';
end $$;

reset role;
select set_config('request.jwt.claims', '', true);

rollback;

select 'IZOLYATSIYA SINOVI TUGADI — xato bo''lmasa hammasi o''tdi' as natija;
