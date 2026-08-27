-- =====================================================================
--  47 — MAKTAB BO'YICHA DAVOMAT VA OTA-ONAGA KUNDALIK XABAR
--
--  Sinf rahbari har kuni ertalab davomat oladi (migratsiya 37), lekin
--  natijasini FAQAT O'ZI ko'rardi. Direktor, navbatchi va buxgalter
--  uchun "bugun kim keldi" degan savolga javob yo'q edi — har bir
--  sinfni alohida ochib chiqishdan boshqa yo'l qolmasdi.
--
--  Bu yerda uchta narsa qo'shiladi:
--
--    1. `report_attendance_today` — butun maktab bo'yicha sinf kesimi:
--       qaysi sinfda davomat olingan, nechta bola kelgan, nechtasi yo'q.
--       Davomat OLINMAGAN sinf ham qatorda turadi va ko'zga tashlanadi —
--       aynan shu holat e'tibor talab qiladi.
--
--    2. `class_attendance_students` — bitta sinf ichida kim kelgani.
--
--    3. Ota-onaga kundalik xabar. Soat 10:00 da (Toshkent) o'sha kuni
--       davomat olingan sinflar bo'yicha har bir farzand uchun bitta
--       xabar ketadi: keldi yoki kelmadi, sababi bilan.
--
--  NEGA 10:00: davomat ertalab birinchi darsdan oldin olinadi. Soat
--  10 gacha kechikib kelgan bola ham ro'yxatga tushib ulguradi va
--  rahbar tuzatish kiritishi mumkin. Bundan erta yuborilsa ota-ona
--  "kelmadi" degan xabar oladi, holbuki bola maktabda bo'ladi.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. MAKTAB BO'YICHA KUNLIK DAVOMAT
--
--  Kelganlar soni AYIRISH bilan chiqariladi: sinfdagi faol o'quvchilar
--  minus o'sha kuni yo'qlik belgilanganlar. Chunki tizim KELMAGANLARNI
--  yozadi (TZ 4.5) — kelganlar alohida saqlanmaydi.
-- ---------------------------------------------------------------------

create or replace function public.report_attendance_today(
  p_day       date default current_date,
  p_branch_id uuid default null
)
returns table (
  class_id     uuid,
  class_name   text,
  grade_level  smallint,
  teacher_name text,
  branch_id    uuid,
  total        integer,
  present      integer,
  absent       integer,
  checked      boolean,
  marked_at    timestamptz
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    c.grade_level,
    t.full_name,
    c.branch_id,
    count(st.id)::integer                                    as total,
    (count(st.id) - count(ab.student_id))::integer           as present,
    count(ab.student_id)::integer                            as absent,
    ac.day is not null                                       as checked,
    ac.marked_at
  from public.classes c
  left join public.teachers t
         on t.id = c.teacher_id and t.deleted_at is null
  left join public.students st
         on st.class_id = c.id
        and st.deleted_at is null
        and st.status = 'active'
        --  Qabul sanasidan oldingi kunlarda bola hali maktabda emas.
        and (st.enrolled_on is null or st.enrolled_on <= p_day)
        and (st.left_on is null or st.left_on >= p_day)
  left join public.absences ab
         on ab.student_id = st.id and ab.day = p_day
  left join public.attendance_checks ac
         on ac.branch_id = c.branch_id
        and ac.class_name = c.name
        and ac.day = p_day
  where c.deleted_at is null
    and c.is_active
    and (p_branch_id is null or c.branch_id = p_branch_id)
  group by c.id, c.name, c.grade_level, t.full_name, c.branch_id,
           ac.day, ac.marked_at
  order by c.grade_level nulls last, c.name;
$$;

comment on function public.report_attendance_today(date, uuid) is
  'Kunlik davomat sinf kesimida. Davomat olinmagan sinf ham qatorda '
  'turadi (`checked = false`) — e''tibor talab qiladigan holat shu.';

revoke all on function public.report_attendance_today(date, uuid) from public, anon;
grant execute on function public.report_attendance_today(date, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
--  2. BITTA SINF ICHIDA KIM KELGAN
-- ---------------------------------------------------------------------

create or replace function public.class_attendance_students(
  p_class_id uuid,
  p_day      date default current_date
)
returns table (
  student_id   uuid,
  full_name    text,
  is_present   boolean,
  reason_name  text,
  note         text,
  marked_at    timestamptz
)
language sql
stable
as $$
  select
    st.id,
    st.full_name,
    ab.student_id is null           as is_present,
    r.name,
    ab.note,
    ab.marked_at
  from public.students st
  left join public.absences ab
         on ab.student_id = st.id and ab.day = p_day
  left join public.absence_reasons r on r.id = ab.reason_id
  where st.class_id = p_class_id
    and st.deleted_at is null
    and st.status = 'active'
    and (st.enrolled_on is null or st.enrolled_on <= p_day)
    and (st.left_on is null or st.left_on >= p_day)
  --  Kelmaganlar TEPADA: ro'yxatga qaraydigan odam aynan ularni
  --  qidiradi, kelganlar esa oddiy hol.
  order by (ab.student_id is null), st.full_name;
$$;

comment on function public.class_attendance_students(uuid, date) is
  'Sinfdagi o''quvchilar va ularning kunlik davomati. Kelmaganlar tepada.';

revoke all on function public.class_attendance_students(uuid, date) from public, anon;
grant execute on function public.class_attendance_students(uuid, date)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
--  3. OTA-ONAGA KUNDALIK XABAR
--
--  Xabar FAQAT davomat olingan sinflar bo'yicha ketadi. Rahbar
--  davomat olmagan bo'lsa ota-ona hech narsa olmaydi — "ma'lumot
--  yo'q" degan xabar yubormaymiz, u faqat xavotir uyg'otadi.
-- ---------------------------------------------------------------------

create or replace function app.enqueue_attendance_notices(
  p_day date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_students int := 0;
  v_queued   int := 0;
  v_absent   int := 0;
  v_n        int;
begin
  for r in
    select
      st.id            as student_id,
      st.school_id,
      st.full_name,
      c.name           as class_name,
      ab.student_id is null as is_present,
      coalesce(rs.name, '')  as reason
    from public.classes c
    join public.attendance_checks ac
      on ac.branch_id = c.branch_id
     and ac.class_name = c.name
     and ac.day = p_day
    join public.students st
      on st.class_id = c.id
     and st.deleted_at is null
     and st.status = 'active'
     and (st.enrolled_on is null or st.enrolled_on <= p_day)
     and (st.left_on is null or st.left_on >= p_day)
    left join public.absences ab
      on ab.student_id = st.id and ab.day = p_day
    left join public.absence_reasons rs on rs.id = ab.reason_id
    where c.deleted_at is null
      and c.is_active
      --  Maktab bu xabarni o'chirib qo'ygan bo'lishi mumkin.
      and coalesce(
            (app.school_setting(st.school_id, 'messaging.attendance_notice')
              #>> '{}')::boolean, true)
      --  Ikki marta yubormaymiz: kun davomida davomat tuzatilsa ham
      --  ota-ona bitta xabar oladi.
      --
      --  Solishtirish DAVOMAT KUNI bo'yicha, yaratilgan sana bo'yicha
      --  EMAS. Ular odatda bir xil, lekin o'tgan kun uchun qo'lda
      --  chaqirilsa farq qiladi va tekshiruv ishlamay qolardi —
      --  ota-ona bir necha marta xabar olardi.
      and not exists (
        select 1 from public.message_queue q
         where q.student_id = st.id
           and q.template_key in ('attendance_present', 'attendance_absent')
           and (q.params ->> 'day') = p_day::text
      )
  loop
    --  Qaytgan son — HAQIQATDA navbatga tushgan xabar soni. Telegramga
    --  ulanmagan ota-onada u nol bo'ladi va bu normal hol: xabar
    --  yaratilmaydi, demak takrorlanish ham yo'q.
    v_n := app.enqueue_for_student(
      r.student_id,
      case when r.is_present then 'attendance_present' else 'attendance_absent' end,
      jsonb_build_object(
        --  `day` xabar matnida ishlatilmaydi — u takrorlanishni
        --  aniqlash uchun ISO ko'rinishida saqlanadi.
        'day',     p_day::text,
        'student', r.full_name,
        'class',   r.class_name,
        'date',    to_char(p_day, 'DD.MM.YYYY'),
        'reason',  case when r.reason = '' then '—' else r.reason end));

    v_students := v_students + 1;
    v_queued   := v_queued + coalesce(v_n, 0);
    if not r.is_present then v_absent := v_absent + 1; end if;
  end loop;

  return jsonb_build_object(
    'day',      p_day,
    'students', v_students,
    'queued',   v_queued,
    'absent',   v_absent);
end;
$$;

comment on function app.enqueue_attendance_notices(date) is
  'Davomat OLINGAN sinflar bo''yicha ota-onaga kundalik xabar. '
  'Bir kunda bir marta: qayta chaqirilsa takrorlamaydi.';

create or replace function public.send_attendance_notices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  --  Faqat cron yoki platforma admini. Panel bu funksiyani
  --  chaqirmaydi — xabarlar o'z vaqtida avtomatik ketadi.
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu amal avtomatik bajariladi' using errcode = '42501';
  end if;

  return app.enqueue_attendance_notices(current_date);
end;
$$;

comment on function public.send_attendance_notices() is
  'Cron uchun: kundalik davomat xabarlarini navbatga qo''yadi.';

revoke all on function public.send_attendance_notices() from public, anon, authenticated;
grant execute on function public.send_attendance_notices() to service_role;

-- ---------------------------------------------------------------------
--  4. XABAR MATNLARI
--
--  Ular bazada — maktab o'z uslubiga moslashi mumkin (TZ 5.6.5).
-- ---------------------------------------------------------------------

insert into public.translations (scope, key, lang, text, school_id)
values
  ('bot', 'attendance_present', 'uz',
   E'✅ *{student}* bugun maktabda.\n\nSinf: {class}\nSana: {date}', null),
  ('bot', 'attendance_present', 'ru',
   E'✅ *{student}* сегодня в школе.\n\nКласс: {class}\nДата: {date}', null),
  ('bot', 'attendance_absent', 'uz',
   E'⚠️ *{student}* bugun maktabga kelmadi.\n\nSinf: {class}\nSana: {date}\nSabab: {reason}\n\nAgar bu xato bo''lsa maktabga xabar bering.', null),
  ('bot', 'attendance_absent', 'ru',
   E'⚠️ *{student}* сегодня не пришёл в школу.\n\nКласс: {class}\nДата: {date}\nПричина: {reason}\n\nЕсли это ошибка, сообщите в школу.', null)
on conflict (scope, key, lang) where school_id is null do nothing;

-- ---------------------------------------------------------------------
--  5. MAKTAB SOZLAMASI — xabarni o'chirish mumkin
-- ---------------------------------------------------------------------

insert into public.school_settings (school_id, key, value, note)
select s.id, 'messaging.attendance_notice', 'true'::jsonb,
       'Ota-onaga kundalik davomat xabari yuborilsinmi'
  from public.schools s
 where s.deleted_at is null
on conflict (school_id, key) do nothing;

-- ---------------------------------------------------------------------
--  6. CRON — 05:00 UTC = 10:00 Toshkent
--
--  Mavjud vazifalar ham shu naqshda: `maktab_due_reminders` 04:00 UTC
--  da, ya'ni Toshkent bo'yicha 09:00 da ishlaydi.
-- ---------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron yo''q — vazifa rejalashtirilmadi.';
    return;
  end if;

  perform cron.unschedule('maktab_attendance_notices')
    where exists (select 1 from cron.job
                   where jobname = 'maktab_attendance_notices');

  perform cron.schedule(
    'maktab_attendance_notices',
    '0 5 * * *',
    'select public.send_attendance_notices();');
end $do$;
