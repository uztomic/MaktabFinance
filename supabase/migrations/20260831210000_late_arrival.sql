-- =====================================================================
--  "KECH KELDI" — KELMAGAN EMAS
--
--  Sabablar ro'yxatida kasallik, oilaviy sabab, ta'til va sababsiz
--  bor edi. Kech kelgan bolani esa yozib qo'yishning yo'li yo'q
--  edi — sinf rahbari yo uni umuman belgilamasdi (va kechikish
--  yo'qolardi), yo "sababsiz" deb belgilardi.
--
--  Ikkinchisi jiddiy xato: bola KELGAN. Uni kelmaganlar qatoriga
--  qo'shsak,
--    · "bugun nechta bola keldi" degan raqam kamayadi
--    · ota-onaga "farzandingiz kelmadi" degan xabar ketadi
--    · kunlik xizmat (ovqat) hisobdan chiqariladi, holbuki bola
--      ovqatlangan
--
--  Shuning uchun kechikish ALOHIDA belgi bilan yoziladi: yozuv
--  `absences` da qoladi (kechikish tarixi kerak), lekin hisobotlarda
--  bola KELGAN deb sanaladi.
-- =====================================================================

alter table public.absence_reasons
  add column if not exists is_late boolean not null default false;

comment on column public.absence_reasons.is_late is
  'Bola kelgan, faqat kechikkan. Hisobotlarda KELGAN deb sanaladi va '
  'kunlik xizmat hisobdan chiqarilmaydi.';

--  Har bir maktabga qo'shamiz. Mavjud bo'lsa tegilmaydi.
insert into public.absence_reasons
  (school_id, code, name, deducts, is_active, sort_order, is_late)
select s.id, 'late', 'Kech keldi', false, true, 90, true
  from public.schools s
 where s.deleted_at is null
   and not exists (
     select 1 from public.absence_reasons r
      where r.school_id = s.id and r.code = 'late');

-- =====================================================================
--  Sinf kesimidagi jamlanma
--
--  `present` endi kechikkanlarni ham hisobga oladi, `late` esa
--  alohida ustun. Ilgari ular `absent` ga tushib ketardi.
-- =====================================================================

drop function if exists public.report_attendance_today(date, uuid);

create function public.report_attendance_today(
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
  late         integer,
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
    count(st.id)::integer as total,
    --  Kech kelgan ham KELGAN.
    (count(st.id) - count(ab.student_id)
      + count(ab.student_id) filter (where r.is_late))::integer as present,
    count(ab.student_id) filter (where not r.is_late)::integer   as absent,
    count(ab.student_id) filter (where r.is_late)::integer       as late,
    ac.day is not null as checked,
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
  left join public.absence_reasons r on r.id = ab.reason_id
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
  'Sinflar kesimida bugungi davomat. Kech kelgan bola KELGAN deb '
  'sanaladi va alohida ustunda ko''rsatiladi.';

grant execute on function public.report_attendance_today(date, uuid)
  to authenticated;

-- =====================================================================
--  Sinf ichidagi ro'yxat
-- =====================================================================

drop function if exists public.class_attendance_students(uuid, date);

create function public.class_attendance_students(
  p_class_id uuid,
  p_day      date default current_date
)
returns table (
  student_id  uuid,
  full_name   text,
  is_present  boolean,
  is_late     boolean,
  reason_name text,
  note        text,
  marked_at   timestamptz
)
language sql
stable
as $$
  select
    st.id,
    st.full_name,
    --  Kech kelgan ham kelgan: ro'yxatda u yashil bo'lib turadi,
    --  yonida esa kechikkani yoziladi.
    (ab.student_id is null or coalesce(r.is_late, false)) as is_present,
    coalesce(r.is_late, false)                            as is_late,
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
  --  qidiradi. Keyin kechikkanlar, oxirida kelganlar.
  order by
    (ab.student_id is null or coalesce(r.is_late, false)),
    coalesce(r.is_late, false),
    st.full_name;
$$;

comment on function public.class_attendance_students(uuid, date) is
  'Sinfdagi o''quvchilar va bugungi holati. Kech kelgan KELGAN deb '
  'sanaladi, lekin alohida belgilanadi.';

grant execute on function public.class_attendance_students(uuid, date)
  to authenticated;
