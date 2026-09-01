-- =====================================================================
--  ISH HAFTASI SOZLAMASI
--
--  Ish kunlari kodda QAT'IY yozilgan edi: dushanba–juma. O'zbekistonda
--  esa ko'p maktab shanba kuni ham ishlaydi, bog'chalar esa boshqacha
--  jadval bo'yicha.
--
--  Oqibati jimgina edi: shanba kuni dars o'tilsa ham davomat
--  olinmasdi ("bu kun ish kuni emas"), kunlik xizmat (ovqat) o'sha
--  kunga hisoblanmasdi va oylikdagi soat kam chiqardi.
--
--  Endi sozlama: `calendar.workweek` = [1,2,3,4,5] (1 = dushanba).
--  Standart qiymat AVVALGIDEK dushanba–juma — mavjud maktablarda
--  hech narsa o'zgarmaydi.
-- =====================================================================

create or replace function app.working_days(
  p_school_id uuid,
  p_branch_id uuid,
  p_from      date,
  p_to        date
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with week as (
    --  Bir marta o'qiladi, har kun uchun emas.
    select array(
      select value::int
        from jsonb_array_elements_text(
          app.school_setting(p_school_id, 'calendar.workweek',
                             '[1,2,3,4,5]'::jsonb))
    ) as days
  )
  select count(*)::integer
    from generate_series(p_from, p_to, interval '1 day') as g(day), week w
   where coalesce(
     -- 1) Filialga xos yozuv
     (select cd.day_type
        from public.calendar_days cd
       where cd.school_id = p_school_id
         and cd.branch_id = p_branch_id
         and cd.day = g.day::date),
     -- 2) Maktab bo'yicha umumiy yozuv (bayramlar shu yerda)
     (select cd.day_type
        from public.calendar_days cd
       where cd.school_id = p_school_id
         and cd.branch_id is null
         and cd.day = g.day::date),
     -- 3) Sozlamadagi ish haftasi
     case when extract(isodow from g.day)::int = any(w.days)
          then 'workday'::public.calendar_day_type
          else 'weekend'::public.calendar_day_type
     end
   ) = 'workday';
$$;

comment on function app.working_days(uuid, uuid, date, date) is
  'Oraliqdagi ish kunlari soni. Tartib: filial yozuvi → maktab '
  'yozuvi (bayram) → `calendar.workweek` sozlamasi.';

-- =====================================================================
--  KUN NEGA ISH KUNI EMAS — SABABI KO'RSATILSIN
--
--  Ekranda "Bu kun ish kuni emas" deb yozilardi va tamom. Sinf
--  rahbari buni xato deb o'ylardi: bugun dushanba-ku. Aslida
--  1-sentabr — Mustaqillik kuni, lekin buni ekran aytmasdi.
-- =====================================================================

drop function if exists public.my_classes(date);

create function public.my_classes(p_day date default current_date)
returns table (
  class_id      uuid,
  class_name    text,
  academic_year text,
  branch_id     uuid,
  students      integer,
  is_workday    boolean,
  --  Bayram yoki dam olish kunining nomi. Oddiy ish kunida null.
  day_name      text,
  marked_at     timestamptz,
  absent_count  integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.academic_year,
    c.branch_id,
    (select count(*)::int from public.students s
      where s.class_id = c.id and s.deleted_at is null
        and s.status = 'active' and s.enrolled_on <= p_day
        and (s.left_on is null or s.left_on >= p_day)),
    app.working_days(c.school_id, c.branch_id, p_day, p_day) = 1,
    (select cd.name
       from public.calendar_days cd
      where cd.school_id = c.school_id
        and (cd.branch_id = c.branch_id or cd.branch_id is null)
        and cd.day = p_day
      order by cd.branch_id nulls last
      limit 1),
    ac.marked_at,
    ac.absent_count
  from public.classes c
  join public.teachers t on t.id = c.teacher_id
  left join public.attendance_checks ac
         on ac.branch_id = c.branch_id
        and ac.day = p_day
        and ac.class_name = c.name
  where t.user_id = (select auth.uid())
    and c.is_active
    and c.deleted_at is null
  order by c.grade_level nulls last, c.name;
$$;

comment on function public.my_classes(date) is
  'Sinf rahbarining sinflari va kunning holati. `day_name` — kun '
  'nega ish kuni emasligi (bayram nomi).';

grant execute on function public.my_classes(date) to authenticated;
