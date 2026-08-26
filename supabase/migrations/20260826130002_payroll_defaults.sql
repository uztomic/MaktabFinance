-- =====================================================================
--  40 — YANGI MAKTAB OYLIK SOZLAMASI ISHLAYDIGAN HOLATDA KELSIN
--
--  `provision_school` hozir oylik sozlamasini BO'SH qiymatlar bilan
--  yaratadi: ushlanmalar `[]`, toifa koeffitsienti `{}`, ustama
--  qiymatlari 0. Natijada yangi maktabda birinchi oylik hisoblanganda
--  soliq ushlab qolinmaydi va hech kim buni sezmaydi.
--
--  QAYSI QIYMATNI QO'YISH MUMKIN, QAYSINISINI YO'Q:
--
--    · Daromad solig'i — QONUN bilan belgilangan, maktab tanlamaydi.
--      Shuning uchun standart qiymat sifatida qo'yiladi.
--    · Toifa koeffitsienti — tuzilma, pul emas. Odatiy nisbat
--      qo'yiladi, maktab o'zgartiradi.
--    · Soat narxi va ustama miqdori — bu PUL va har maktabda boshqacha.
--      Ularni o'ylab topib qo'yish xavfli: hisob jim ravishda noto'g'ri
--      chiqadi. Nol bo'lib qoladi, lekin endi `payroll_config_issues`
--      buni ochiq ogohlantirish qilib ko'rsatadi (39-migratsiya).
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Mavjud maktablar: ushlanmalar bo'sh bo'lsa to'ldiriladi.
--
--  Tarix o'zgarmaydi — `effective_from` bugundan boshlanadi va
--  tasdiqlangan eski hisoblar o'z suratini (snapshot) saqlab qoladi.
-- ---------------------------------------------------------------------

insert into public.payroll_settings (school_id, key, value, effective_from, note)
select s.id, 'deductions',
       '[{"code":"income_tax","name":"Daromad solig''i (JShDS)","type":"percent","value":12}]'::jsonb,
       date_trunc('month', current_date)::date,
       'Standart: JShDS 12%. Buxgalter tekshirib o''zgartiradi.'
  from public.schools s
 where s.deleted_at is null
   and coalesce(
         (select ps.value from public.payroll_settings ps
           where ps.school_id = s.id and ps.key = 'deductions'
           order by ps.effective_from desc limit 1),
         '[]'::jsonb) = '[]'::jsonb
on conflict (school_id, key, effective_from) do nothing;

-- ---------------------------------------------------------------------
--  2. Toifa koeffitsienti — bo'sh bo'lsa odatiy nisbat.
--
--  Nomlar `lookups` dagi `teacher_category` ro'yxati bilan bir xil
--  yozilishi SHART, aks holda mos kelmaydi va koeffitsient 1 bo'lib
--  qoladi (jim xato).
-- ---------------------------------------------------------------------

insert into public.payroll_settings (school_id, key, value, effective_from, note)
select s.id, 'category_factors',
       '{"Oliy toifa":1.2,"Birinchi toifa":1.1,"Ikkinchi toifa":1.05,"Toifasiz":1,"Yosh mutaxassis":1}'::jsonb,
       date_trunc('month', current_date)::date,
       'Odatiy nisbat. Nomlar teacher_category ro''yxati bilan bir xil.'
  from public.schools s
 where s.deleted_at is null
   and coalesce(
         (select ps.value from public.payroll_settings ps
           where ps.school_id = s.id and ps.key = 'category_factors'
           order by ps.effective_from desc limit 1),
         '{}'::jsonb) = '{}'::jsonb
on conflict (school_id, key, effective_from) do nothing;

-- ---------------------------------------------------------------------
--  3. `provision_school` — yangi maktab uchun ham shunday.
-- ---------------------------------------------------------------------

do $do$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'provision_school';

  if v_src is null then
    raise notice 'provision_school topilmadi — o''tkazib yuborildi';
    return;
  end if;

  v_src := replace(v_src,
    '(p_school_id, ''deductions'', ''[]''::jsonb,',
    '(p_school_id, ''deductions'', ''[{"code":"income_tax","name":"Daromad solig''''i (JShDS)","type":"percent","value":12}]''::jsonb,');

  v_src := replace(v_src,
    '(p_school_id, ''category_factors'', ''{}''::jsonb,',
    '(p_school_id, ''category_factors'', ''{"Oliy toifa":1.2,"Birinchi toifa":1.1,"Ikkinchi toifa":1.05,"Toifasiz":1,"Yosh mutaxassis":1}''::jsonb,');

  execute v_src;
end $do$;
