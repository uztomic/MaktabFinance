-- =====================================================================
--  37 — SINF RAHBARI O'Z SINFINING DAVOMATINI OLADI
--
--  Hozircha yo'qlikni faqat NAVBATCHI belgilay olardi (`absences.mark`
--  huquqi faqat `duty` rolida). Amalda esa har kuni ertalab davomatni
--  SINF RAHBARI oladi — u sinfda turadi, navbatchi esa yo'lakda.
--
--  NEGA HUQUQNI SHUNCHAKI O'QITUVCHIGA BERMAYMIZ: `absences.mark`
--  huquqi RLS orqali BUTUN FILIAL uchun ochiladi. Ya'ni 5-A rahbari
--  9-A ning davomatini ham o'zgartira olardi. Bu shunchaki noqulay
--  emas — moliyaviy oqibati bor, chunki kunlik xizmat aynan shu
--  yozuvlar bo'yicha qayta hisoblanadi.
--
--  YECHIM: bitta server funksiyasi. U chaqiruvchi AYNAN SHU SINFNING
--  rahbari ekanini tekshiradi va butun kunni bir amalda yozadi:
--  yo'qliklar + qayd etuv belgisi. RLS ochilmaydi.
--
--  "Kuniga bir marta" — bu taqiq emas, ODAT. Xato bo'lsa tuzatish
--  kerak, shuning uchun qayta yuborishga ruxsat beriladi: eski
--  yozuvlar almashtiriladi va audit jurnalida ikkala holat qoladi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MENING SINFLARIM
--
--  O'qituvchi kirganda "bugun qaysi sinfning davomatini olishim
--  kerak va olganmanmi" degan savolga bitta so'rov javob beradi.
-- ---------------------------------------------------------------------

create or replace function public.my_classes(p_day date default current_date)
returns table (
  class_id      uuid,
  class_name    text,
  academic_year text,
  branch_id     uuid,
  students      integer,
  is_workday    boolean,
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
  'Sinf rahbari yuritadigan sinflar va bugungi davomat holati.';

-- ---------------------------------------------------------------------
-- 2. DAVOMATNI YOZISH
-- ---------------------------------------------------------------------

create or replace function public.mark_class_attendance(
  p_class_id uuid,
  p_day      date,
  p_absent   jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c          record;
  v_uid      uuid := (select auth.uid());
  v_is_owner boolean;
  v_rec      jsonb;
  v_student  uuid;
  v_reason   uuid;
  v_removed  int := 0;
  v_added    int := 0;
begin
  select cl.*, s.name as school_name
    into c
    from public.classes cl
    join public.schools s on s.id = cl.school_id
   where cl.id = p_class_id and cl.deleted_at is null;

  if not found then
    raise exception 'Sinf topilmadi' using errcode = '22023';
  end if;

  -- --- Kim yozishi mumkin -------------------------------------------
  --  a) shu sinfning rahbari, yoki
  --  b) `absences.mark` huquqiga ega xodim (navbatchi, buxgalter).
  select exists (
    select 1 from public.teachers t
     where t.id = c.teacher_id and t.user_id = v_uid and t.is_active
  ) into v_is_owner;

  if not v_is_owner then
    perform app.assert_may_write('absences.mark');
    perform app.assert_branch(c.branch_id);
  else
    -- Rahbar ham cheklovlardan ozod emas: maktab cheklash rejimida
    -- bo'lsa yoki sessiya o'qish rejimida bo'lsa yozib bo'lmaydi.
    if app.is_readonly_session() then
      raise exception 'Sessiya faqat o''qish rejimida'
        using errcode = '42501';
    end if;
    if not app.school_is_writable() then
      raise exception 'Maktab cheklash rejimida' using errcode = '42501';
    end if;
  end if;

  -- --- Sana tekshiruvlari -------------------------------------------
  if p_day > current_date then
    raise exception 'Kelajakdagi kun uchun davomat olinmaydi'
      using errcode = '22023';
  end if;

  -- Orqaga qarab bir hafta. Undan eskisi buxgalter ishi: hisoblanma
  -- allaqachon yakunlangan bo'lishi mumkin.
  if p_day < current_date - 7 then
    raise exception
      'Bir haftadan eski kunni sinf rahbari o''zgartira olmaydi. '
      'Buxgalterga murojaat qiling.'
      using errcode = '42501';
  end if;

  if app.working_days(c.school_id, c.branch_id, p_day, p_day) <> 1 then
    raise exception 'Bu kun ish kuni emas' using errcode = '22023';
  end if;

  perform app.assert_period_open(c.school_id, p_day, c.branch_id);

  -- --- Eski yozuvlar almashtiriladi ---------------------------------
  --  Qayta yuborish — tuzatish. O'chirish audit jurnaliga tushadi,
  --  ya'ni "kim nimani olib tashladi" ko'rinib qoladi (TZ 5.4.10).
  with gone as (
    delete from public.absences a
     using public.students s
     where a.student_id = s.id
       and s.class_id = p_class_id
       and a.day = p_day
    returning 1
  )
  select count(*)::int into v_removed from gone;

  -- --- Yangi yozuvlar ------------------------------------------------
  for v_rec in select * from jsonb_array_elements(coalesce(p_absent, '[]'::jsonb))
  loop
    v_student := (v_rec ->> 'student_id')::uuid;
    v_reason  := nullif(v_rec ->> 'reason_id', '')::uuid;

    -- O'quvchi HAQIQATAN shu sinfdami? Aks holda rahbar begona
    -- o'quvchiga yo'qlik yozib qo'yishi mumkin edi.
    if not exists (
      select 1 from public.students s
       where s.id = v_student and s.class_id = p_class_id
         and s.deleted_at is null
    ) then
      raise exception 'O''quvchi bu sinfda emas' using errcode = '42501';
    end if;

    insert into public.absences
      (school_id, branch_id, student_id, day, reason_id, marked_by)
    values (c.school_id, c.branch_id, v_student, p_day, v_reason, v_uid)
    on conflict do nothing;

    v_added := v_added + 1;
  end loop;

  -- --- Qayd etuv belgisi ---------------------------------------------
  --  BUSIZ hisoblanmani yakunlab bo'lmaydi (app.absence_gaps).
  insert into public.attendance_checks
    (school_id, branch_id, day, class_name, absent_count, marked_by, marked_at)
  values (c.school_id, c.branch_id, p_day, c.name, v_added, v_uid, now())
  on conflict (school_id, branch_id, day, class_name) do update
    set absent_count = excluded.absent_count,
        marked_by    = excluded.marked_by,
        marked_at    = excluded.marked_at;

  return jsonb_build_object(
    'class_id',  p_class_id,
    'day',       p_day,
    'absent',    v_added,
    'replaced',  v_removed,
    'as_owner',  v_is_owner);
end;
$$;

comment on function public.mark_class_attendance(uuid, date, jsonb) is
  'Sinf rahbari o''z sinfining kunlik davomatini oladi. Huquq RLS '
  'orqali emas, sinf rahbarligi orqali beriladi — boshqa sinfga '
  'yozib bo''lmaydi.';

-- ---------------------------------------------------------------------
-- 3. HUQUQLAR
-- ---------------------------------------------------------------------

do $do$
declare f text;
begin
  foreach f in array array[
    'public.my_classes(date)',
    'public.mark_class_attendance(uuid, date, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
