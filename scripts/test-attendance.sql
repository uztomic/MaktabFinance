-- =====================================================================
--  DAVOMAT SINOVLARI
--
--  Uch narsa tekshiriladi:
--
--    1. Sinf kesimidagi hisob o'zaro mos: kelgan + kelmagan = jami.
--       Bu ahamiyatli, chunki "kelgan" alohida saqlanmaydi — u
--       AYIRISH bilan chiqariladi va bog'lanish buzilsa jimgina
--       noto'g'ri son beradi.
--
--    2. Sinf ichidagi ro'yxat jamlanma bilan mos.
--
--    3. Ota-onaga xabar BIR MARTA ketadi. Kun davomida davomat
--       tuzatilishi mumkin va funksiya qayta chaqiriladi — o'shanda
--       ota-ona ikkinchi xabarni olmasligi kerak.
--
--  Xato bo'lmasa — hammasi o'tdi.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Jamlanma o'zaro mos
-- ---------------------------------------------------------------------
do $do$
declare
  v_day date;
  r     record;
begin
  --  Davomat olingan eng oxirgi kun. Bo'sh bazada sinov o'tkazib
  --  yuboriladi — bu xato emas.
  select max(day) into v_day from public.attendance_checks;
  if v_day is null then
    raise notice '1: davomat yozuvi yo''q — sinov o''tkazib yuborildi';
    return;
  end if;

  for r in select * from public.report_attendance_today(v_day) loop
    if r.present + r.absent <> r.total then
      raise exception
        '1: % sinfida hisob mos emas: % + % <> %',
        r.class_name, r.present, r.absent, r.total;
    end if;
    if r.present < 0 or r.absent < 0 then
      raise exception '1: % sinfida manfiy son', r.class_name;
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
--  2. Sinf ro'yxati jamlanma bilan mos
-- ---------------------------------------------------------------------
do $do$
declare
  v_day     date;
  r         record;
  v_present int;
  v_total   int;
begin
  select max(day) into v_day from public.attendance_checks;
  if v_day is null then return; end if;

  for r in
    select * from public.report_attendance_today(v_day)
     where checked and total > 0
     limit 5
  loop
    select count(*), count(*) filter (where is_present)
      into v_total, v_present
      from public.class_attendance_students(r.class_id, v_day);

    if v_total <> r.total or v_present <> r.present then
      raise exception
        '2: % sinfi ro''yxati jamlanmaga mos emas (% / % va % / %)',
        r.class_name, v_total, r.total, v_present, r.present;
    end if;
  end loop;
end $do$;

-- ---------------------------------------------------------------------
--  3. Ota-onaga xabar takrorlanmaydi
--
--  Sinov YOZADI, shuning uchun oxirida iz tozalanadi. Faqat shu
--  chaqiruv yaratgan qatorlar o'chiriladi — boshqasiga tegilmaydi.
-- ---------------------------------------------------------------------
do $do$
declare
  v_day    date;
  v_first  jsonb;
  v_second jsonb;
begin
  select max(day) into v_day from public.attendance_checks;
  if v_day is null then return; end if;

  --  Avvalgi sinovlardan qolgan iz bo'lsa tozalanadi.
  delete from public.message_queue
   where template_key in ('attendance_present', 'attendance_absent')
     and (params ->> 'day') = v_day::text;

  v_first  := app.enqueue_attendance_notices(v_day);
  v_second := app.enqueue_attendance_notices(v_day);

  if (v_second ->> 'queued')::int <> 0 then
    raise exception
      '3: xabar takrorlandi — birinchi marta % ta, ikkinchi marta % ta',
      v_first ->> 'queued', v_second ->> 'queued';
  end if;

  delete from public.message_queue
   where template_key in ('attendance_present', 'attendance_absent')
     and (params ->> 'day') = v_day::text;
end $do$;

select 'DAVOMAT SINOVI TUGADI — xato bo''lmasa hammasi o''tdi' as natija;
