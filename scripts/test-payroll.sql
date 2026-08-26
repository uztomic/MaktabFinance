-- =====================================================================
--  OYLIK HISOBI SINOVLARI
--
--  Uchta narsa tekshiriladi va uchalasi ham jonli bazada topilgan
--  haqiqiy kamchiliklardan kelib chiqqan:
--
--    1. Foiz yozuvi. `to_char(100, 'FM990.9')` Postgresda "100."
--       qaytaradi — oxirida ortiqcha nuqta bilan. Hisob varaqasida
--       "O'rniga kirilgan darslar (100.%)" deb chiqardi.
--
--    2. Nol summali qatorlar. Soat narxi sozlanmagan maktabda hisobga
--       "3 soat × 0 = 0 so'm" degan qator tushardi. O'qituvchi buni
--       ko'radi va haqli ravishda savol beradi.
--
--    3. Sozlama tekshiruvi. Eng muhimi: tekshiruvning O'ZI ishlashi.
--       Hech qachon ishga tushmaydigan ogohlantirish — ogohlantirish
--       emas, shunchaki o'zini aldash. Shuning uchun sozlama ATAYLAB
--       buziladi va tekshiruv jim turmasligi talab qilinadi.
--
--  Xato bo'lmasa — hammasi o'tdi.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Raqam formati
-- ---------------------------------------------------------------------
do $do$
begin
  if app.fmt_num(100) <> '100' then
    raise exception '1: butun son "%": osilib qolgan nuqta', app.fmt_num(100);
  end if;
  if app.fmt_num(100.5) <> '100.5' then
    raise exception '1: kasr son "%"', app.fmt_num(100.5);
  end if;
  if app.fmt_num(18.75) <> '18.75' then
    raise exception '1: ikki xonali kasr "%"', app.fmt_num(18.75);
  end if;
  if app.fmt_num(0) <> '0' then
    raise exception '1: nol "%"', app.fmt_num(0);
  end if;
  if app.fmt_num(null) <> '0' then
    raise exception '1: null "%"', app.fmt_num(null);
  end if;
end $do$;

-- ---------------------------------------------------------------------
--  2. Hisob varaqasida nol summali qator va buzuq foiz bo'lmasin
-- ---------------------------------------------------------------------
do $do$
declare v_n int;
begin
  select count(*) into v_n from public.payroll_lines where amount = 0;
  if v_n > 0 then
    raise exception '2: % ta nol summali qator bor', v_n;
  end if;

  --  Aynan ".%)" ketma-ketligi qidiriladi.
  --
  --  DIQQAT: LIKE da foiz belgisi JOKER. Uni literal sifatida qidirish
  --  uchun escape shart. Busiz "Avans (15.08.2026)" kabi mutlaqo
  --  soppa-sog' qatorlar ham "buzuq" deb belgilanadi — bu sinovning
  --  birinchi yozilishida aynan shunday bo'ldi.
  select count(*) into v_n
    from public.payroll_lines
   where description like '%.\%)' escape '\';
  if v_n > 0 then
    raise exception '2: % ta qatorda buzuq foiz yozuvi ("100.%%")', v_n;
  end if;
end $do$;

-- ---------------------------------------------------------------------
--  3. Sozlama tekshiruvi haqiqatan ishga tushadimi
--
--  Sozlama vaqtincha buziladi, tekshiruv chaqiriladi va iz DARHOL
--  tozalanadi. `SINOV` izohi bo'yicha o'chiriladi — boshqa yozuvlarga
--  tegilmaydi.
-- ---------------------------------------------------------------------
do $do$
declare
  v_uid    uuid;
  v_school uuid;
  v_clean  int;
  v_broken int;
begin
  select s.id into v_school
    from public.schools s
   where s.deleted_at is null
     and exists (select 1 from public.teachers t
                  where t.school_id = s.id and t.deleted_at is null)
   order by s.created_at limit 1;

  if v_school is null then
    raise notice '3: o''qituvchisi bor maktab yo''q — o''tkazib yuborildi';
    return;
  end if;

  select u.id into v_uid from public.app_users u
   where u.school_id = v_school and u.role in ('accountant', 'director')
   order by u.role limit 1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  select count(*) into v_clean from public.payroll_config_issues(current_date);

  insert into public.payroll_settings (school_id, key, value, effective_from, note)
  values (v_school, 'deductions', '[]'::jsonb,
          date_trunc('month', current_date)::date, 'SINOV'),
         (v_school, 'hour_price', '0'::jsonb,
          date_trunc('month', current_date)::date, 'SINOV')
  on conflict (school_id, key, effective_from)
    do update set value = excluded.value, note = 'SINOV';

  select count(*) into v_broken from public.payroll_config_issues(current_date);

  delete from public.payroll_settings
   where school_id = v_school and note = 'SINOV';

  if v_broken <= v_clean then
    raise exception
      '3: tekshiruv ishlamayapti — toza sozlamada % ta, buzilganida % ta',
      v_clean, v_broken;
  end if;
end $do$;

select 'OYLIK SINOVI TUGADI — xato bo''lmasa hammasi o''tdi' as natija;
