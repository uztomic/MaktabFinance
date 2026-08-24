-- =====================================================================
--  32 — YILLIK KO'CHIRISHDAGI IKKI XATO
--
--  Ikkalasini ham `scripts/test-classes.sql` topdi.
--
--  1. KO'CHGAN O'QUVCHILAR SONI NOTO'G'RI. `get diagnostics` sikl
--     ichida `v_moved` ni QAYTA YOZARDI, qo'shmasdi. Natijada
--     "N ta o'quvchi ko'chdi" xabari faqat OXIRGI sinfning sonini
--     ko'rsatardi. Direktor ko'chirish to'liq bo'lganini shu raqamga
--     qarab baholaydi — noto'g'ri raqam ishonchni buzadi.
--
--  2. SINF NOMI BOSQICH BILAN UZILIB QOLARDI. Eski qoida bosqich
--     raqamini faqat nom BOSHIDA almashtirardi. "5-A" ishlardi, lekin
--     "Boshlang'ich 5-A" yoki "5-A sinf" kabi nomlarda raqam eski
--     holida qolib, `grade_level` esa 6 ga o'sardi — nomi "5", o'zi
--     6-bosqich. Endi raqam nomning ISTALGAN joyida, lekin faqat
--     ALOHIDA SON sifatida almashtiriladi (15 ichidagi 5 emas).
-- =====================================================================

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
  v_batch      int;
  v_moved      int := 0;
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

  if p_from_year = p_to_year then
    raise exception 'O''quv yillari bir xil bo''lishi mumkin emas'
      using errcode = '22023';
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
    -- Bitiruvchi sinf — ko'chirilmaydi.
    if c.grade_level is not null and c.grade_level >= p_final_grade then
      v_graduating := v_graduating + c.student_count;
      continue;
    end if;

    -- Yangi nom: bosqich raqami nomning istalgan joyida almashtiriladi,
    -- lekin faqat ALOHIDA son bo'lsa: "5-A" → "6-A",
    -- "Boshlang'ich 5-A" → "Boshlang'ich 6-A", ammo "15-guruh" tegilmaydi.
    v_new_name := case
      when c.grade_level is null then c.name
      when c.name ~ ('(^|\D)' || c.grade_level || '(\D|$)')
      then regexp_replace(
             c.name,
             '(^|\D)' || c.grade_level || '(\D|$)',
             '\1' || (c.grade_level + 1)::text || '\2')
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
         c.grade_level + 1, c.teacher_id,
         c.capacity, p_to_year)
      returning id into v_target;
      v_classes := v_classes + 1;
    end if;

    update public.students
       set class_id = v_target
     where class_id = c.id
       and status = 'active'
       and deleted_at is null;

    -- QO'SHILADI, qayta yozilmaydi — aks holda faqat oxirgi sinf sanaladi.
    get diagnostics v_batch = row_count;
    v_moved := v_moved + v_batch;
  end loop;

  -- Eski o'quv yili sinflari arxivga o'tadi (o'chirilmaydi).
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
    'students_moved',  v_moved,
    'graduating',      v_graduating);
end;
$$;

comment on function public.promote_classes(text, text, uuid, int) is
  'Yillik ko''chirish: 5-A → 6-A. Bitiruv bosqichidagilar ko''chmaydi, '
  'eski yil sinflari arxivga o''tadi. Nomdagi bosqich raqami alohida '
  'son sifatida almashtiriladi.';

revoke all on function public.promote_classes(text, text, uuid, int)
  from public, anon;
grant execute on function public.promote_classes(text, text, uuid, int)
  to authenticated, service_role;
