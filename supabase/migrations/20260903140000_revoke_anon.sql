-- =====================================================================
--  ANON UCHUN YOPILADI
--
--  PostgreSQL yangi funksiyaga EXECUTE huquqini `public` roliga
--  O'ZI beradi. `anon` esa `public` a'zosi — ya'ni har bir yangi
--  funksiya, hech kim so'ramasa ham, kirmagan odam uchun ochiq
--  bo'lib qoladi.
--
--  `grant execute ... to authenticated` yozilgani buni to'xtatmaydi:
--  u qo'shimcha huquq, avvalgisini olib tashlamaydi.
--
--  Ko'pchiligi baribir ishlamas edi — `app.school_id()` bo'sh
--  qaytadi va funksiya xato beradi. Lekin bu tasodif, himoya emas.
--  TZ 5.5.7 va `app.security_invariants()` INVARIANT 2 aniq talab
--  qiladi: `anon` roliga hech qanday huquq berilmaydi.
--
--  Quyidagilar so'nggi kunlarda qo'shilgan funksiyalar — o'shanda
--  `revoke` yozilmagan edi. Audit topdi.
-- =====================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'add_invoice_discount', 'remove_invoice_discount',
         'delete_calendar_day', 'delete_class', 'delete_student',
         'my_classes', 'remove_absences',
         'set_teacher_branches', 'set_user_branches',
         'stale_invoices')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;
