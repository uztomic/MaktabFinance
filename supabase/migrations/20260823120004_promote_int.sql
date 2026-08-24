-- =====================================================================
--  29 — TUZATISH: promote_classes parametri `int` bo'lsin
--
--  `smallint` parametr PostgreSQL da oddiy butun son literalidan
--  avtomatik aniqlanmaydi: `promote_classes('a','b',null,11)` chaqiruvi
--  "No function matches" xatosi beradi. Mijoz (PostgREST) ham raqamni
--  `int` sifatida yuboradi.
--
--  Sinovda aniqlandi. Eski versiya olib tashlanadi.
-- =====================================================================

drop function if exists public.promote_classes(text, text, uuid, smallint);

create or replace function public.promote_classes(
  p_from_year   text,
  p_to_year     text,
  p_branch_id   uuid default null,
  p_final_grade int default 11
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c            record;
  v_target     uuid;
  v_new_name   text;
  v_moved      int := 0;
  v_total      int := 0;
  v_classes    int := 0;
  v_graduating int := 0;
  v_school     uuid;
begin
  perform app.assert_may_write('students.manage');

  v_school := app.school_id();
  if v_school is null and p_branch_id is not null then
    select school_id into v_school from public.branches where id = p_branch_id;
  end if;
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;

  for c in
    select cl.*, count(s.id) as student_count
      from public.classes cl
      left join public.students s
             on s.class_id = cl.id and s.deleted_at is null
                and s.status = 'active'
     where cl.school_id = v_school
       and cl.academic_year = p_from_year
       and cl.deleted_at is null
       and cl.is_active
       and (p_branch_id is null or cl.branch_id = p_branch_id)
     group by cl.id
     order by cl.grade_level nulls last, cl.name
  loop
    -- Bitiruvchi sinf — ko'chirilmaydi, maktab o'zi hal qiladi.
    if c.grade_level is not null and c.grade_level >= p_final_grade then
      v_graduating := v_graduating + c.student_count;
      continue;
    end if;

    -- "5-A" → "6-A": bosqich raqami almashtiriladi.
    v_new_name := case
      when c.grade_level is not null
       and c.name ~ ('^' || c.grade_level || '\M')
      then regexp_replace(c.name, '^' || c.grade_level, (c.grade_level + 1)::text)
      else c.name
    end;

    select id into v_target
      from public.classes
     where branch_id = c.branch_id
       and academic_year = p_to_year
       and name = v_new_name
       and deleted_at is null;

    if v_target is null then
      insert into public.classes
        (school_id, branch_id, name, grade_level, teacher_id,
         capacity, academic_year)
      values
        (c.school_id, c.branch_id, v_new_name,
         (c.grade_level + 1)::smallint, c.teacher_id,
         c.capacity, p_to_year)
      returning id into v_target;
      v_classes := v_classes + 1;
    end if;

    update public.students
       set class_id = v_target
     where class_id = c.id
       and status = 'active'
       and deleted_at is null;

    get diagnostics v_moved = row_count;
    v_total := v_total + v_moved;
  end loop;

  -- Eski o'quv yili sinflari arxivga o'tadi (o'chirilmaydi — TZ 5.4.8).
  update public.classes
     set is_active = false
   where school_id = v_school
     and academic_year = p_from_year
     and deleted_at is null
     and (p_branch_id is null or branch_id = p_branch_id);

  return jsonb_build_object(
    'from_year',       p_from_year,
    'to_year',         p_to_year,
    'classes_created', v_classes,
    'students_moved',  v_total,
    'graduating',      v_graduating);
end;
$$;

comment on function public.promote_classes(text, text, uuid, int) is
  'Yillik ko''chirish: 5-A → 6-A. Bitiruvchi sinf o''quvchilari '
  'ko''chirilmaydi, faqat soni qaytariladi. Eski yil sinflari arxivga o''tadi.';

revoke all on function public.promote_classes(text, text, uuid, int)
  from public, anon;
grant execute on function public.promote_classes(text, text, uuid, int)
  to authenticated, service_role;
