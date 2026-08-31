-- =====================================================================
--  59 — `anon` CHAQIRA OLADIGAN FUNKSIYALARNI YOPISH
--
--  MUAMMO. `npm run audit:security` 15 ta funksiyani ko'rsatdi:
--  ularni KIRMAGAN foydalanuvchi (`anon` roli) chaqira oladi.
--  Ular orasida `set_user_permission`, `user_permission_matrix`,
--  `delete_teacher`, `register_split_payment` ham bor.
--
--  SABAB — PostgreSQL ning standart xatti-harakati. `create function`
--  yangi funksiyaga `EXECUTE` huquqini `PUBLIC` ga BERADI, `PUBLIC`
--  esa `anon` ni ham o'z ichiga oladi. Migratsiya 10 dagi
--  `revoke all on all functions ... from anon` faqat O'SHA PAYTDAGI
--  funksiyalarga tegdi; keyin yaratilganlari yana ochiq bo'lib
--  keldi.
--
--  DIQQAT — `revoke ... from anon` BU YERDA ISHLAMAYDI. Huquq
--  `anon` ga to'g'ridan-to'g'ri berilmagan, u `PUBLIC` orqali
--  keladi. `anon` dan olib tashlash mavjud bo'lmagan grantni
--  o'chirishga urinish — buyruq xatosiz o'tadi va HECH NARSA
--  o'zgarmaydi. Bu yozilayotganda aynan shunday bo'ldi: revoke
--  bajarildi, keyin tekshiruv o'sha 15 tani yana topdi.
--
--  Shuning uchun `PUBLIC` dan olinadi va kerakli rollarga QAYTA
--  beriladi.
--
--  Uy qoidasi har bir yangi funksiyada `revoke ... from anon`
--  yozishni talab qiladi (TZ 2.5 §9), lekin qoida QO'LDA bajariladi
--  va 15 marta unutilgan. Unutilishi mumkin bo'lgan qoida — ertami
--  kechmi unutiladi.
--
--  HAQIQIY XAVF O'LCHANDI. Anon kalit bilan chaqirib ko'rildi:
--
--    user_permission_matrix (haqiqiy direktor id si) → []
--    report_by_class                                 → 42501
--    report_attendance_today                         → 42501
--    school_setup_issues                             → []
--
--  Ya'ni MA'LUMOT CHIQMADI: funksiyalar `app.school_id()` ga
--  tayanadi, u esa tokensiz null. Lekin himoya HAR BIR FUNKSIYANING
--  ichki tekshiruviga bog'lanib qolgan. Kimdir tekshiruvni unutgan
--  bitta funksiya yozsa, u `anon` ga tekin ochiq bo'ladi.
--
--  YECHIM IKKI QISM.
--
--  1) Hozirgi 15 tasi yopiladi.
--
--  2) KELAJAKDAGILARI ham yopiladi — `alter default privileges`
--     bilan. Bu qoidani odam xotirasidan bazaga ko'chiradi: endi
--     yangi funksiya `PUBLIC` ga huquq bilan tug'ilmaydi.
--
--  2-QISM NIMANI BUZISHI MUMKIN. `PUBLIC` dan olib tashlash
--  `authenticated` ga ham tegadi — ya'ni bundan keyin har bir yangi
--  funksiyada `grant execute ... to authenticated` YOZILISHI SHART.
--  Uy qoidasi allaqachon shuni talab qiladi, shuning uchun to'g'ri
--  yozilgan migratsiya hech narsa sezmaydi. Noto'g'ri yozilgani esa
--  BALAND OVOZDA yiqiladi (`permission denied`) — jimgina `anon` ga
--  ochiq qolgandan ming marta yaxshi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HOZIRGILARI
--
--  `PUBLIC` dan olinadi, keyin `authenticated` va `service_role` ga
--  qaytariladi — ya'ni panel ishlashda davom etadi, kirmagan
--  foydalanuvchi esa yo'qotadi.
--
--  Ro'yxatdagi o'n beshtasi ham PANEL funksiyasi: oylik, davomat,
--  hisobot, o'qituvchi, huquq. Platforma amali (`provision_school`
--  kabi) ular orasida yo'q — migratsiya 24 uni allaqachon yopgan va
--  bu yerda u qayta ochilmasligi kerak. Shuning uchun sikl faqat
--  HOZIR `anon` ga ochiq bo'lganlarni oladi.
-- ---------------------------------------------------------------------

do $do$
declare
  r     record;
  v_n   int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    v_n := v_n + 1;
  end loop;

  raise notice '% ta funksiya PUBLIC dan yopildi va rollarga qaytarildi', v_n;
end $do$;

-- ---------------------------------------------------------------------
-- 2. KELAJAKDAGILARI
--
--  `alter default privileges` faqat uni BAJARGAN rol yaratadigan
--  obyektlarga ta'sir qiladi. Migratsiyalar `postgres` sifatida
--  bajariladi, shuning uchun `for role postgres` aniq yoziladi —
--  aks holda qoida jimgina ishlamay qolishi mumkin.
-- ---------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

-- ---------------------------------------------------------------------
-- 3. TEKSHIRUV
-- ---------------------------------------------------------------------

do $do$
declare v_bad text; v_n int;
begin
  -- --- 3a. Bironta funksiya anon ga ochiq qolmadimi ----------------
  select string_agg(n.nspname || '.' || p.proname, ', '), count(*)
    into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute');

  if v_n > 0 then
    raise exception 'Hamon % ta funksiya anon ga ochiq: %', v_n, v_bad;
  end if;
  raise notice 'Tekshiruv: anon hech qanday funksiyani chaqira olmaydi';

  -- --- 3b. Panel ishlatadigan funksiyalar authenticated da qoldimi -
  --     Eng muhim tekshiruv: revoke ortiqcha keng ketmaganmi.
  select string_agg(p.proname, ', '), count(*)
    into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('report_pnl', 'report_debts', 'register_cash_payment',
                       'approve_invoices', 'calc_payroll', 'report_by_class',
                       'set_user_permission', 'user_permission_matrix',
                       'report_attendance_today', 'school_setup_issues')
     and not has_function_privilege('authenticated', p.oid, 'execute');

  if v_n > 0 then
    raise exception
      'REVOKE ORTIQCHA KETDI — panel funksiyalari authenticated dan '
      'yopilib qoldi (% ta): %', v_n, v_bad;
  end if;
  raise notice 'Tekshiruv: panel funksiyalari authenticated uchun ochiq';
end $do$;
