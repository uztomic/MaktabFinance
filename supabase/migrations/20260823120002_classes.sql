-- =====================================================================
--  27 — SINFLAR
--
--  Hozirgacha sinf `students.class_name` matn maydonida edi. Bu bilan
--  quyidagilar mumkin emas edi:
--
--    · sinf rahbarini belgilash (oylikdagi "sinf rahbarligi" ustamasi
--      kimga tegishli ekani noma'lum edi — TZ 12.1.6)
--    · sinf sig'imini yuritish
--    · yil oxirida 5-A → 6-A ko'chirish
--    · sinf kesimida moliyaviy hisobot
--    · sinf nomini bitta joyda o'zgartirish
--
--  MUHIM QAROR: `students.class_name` QOLDIRILADI va trigger bilan
--  `classes.name` dan avtomatik to'ldiriladi.
--
--  Sabab: 10 dan ortiq joyda (yo'qlik, qarzdorlik, hisoblanma,
--  o'quvchilar ro'yxati) `class_name` bo'yicha filtr va guruhlash bor.
--  Ularni qayta yozish o'rniga trigger ikki manbani doim bir xil
--  ushlab turadi — uzilib qolish imkoni yo'q.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O'QUV YILI
--
--  "2026/2027" ko'rinishida. Boshlanish oyi maktab sozlamasidan
--  (school_settings.academic_year_start_month, standart: sentyabr).
-- ---------------------------------------------------------------------

create or replace function app.academic_year(
  p_school_id uuid,
  p_date      date default current_date
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when extract(month from p_date)::int
         >= coalesce((app.school_setting(p_school_id, 'academic_year_start_month',
                                         '9'::jsonb))::int, 9)
      then extract(year from p_date)::int || '/' ||
           (extract(year from p_date)::int + 1)
    else (extract(year from p_date)::int - 1) || '/' ||
         extract(year from p_date)::int
  end;
$$;

comment on function app.academic_year(uuid, date) is
  'O''quv yili yorlig''i: "2026/2027". Boshlanish oyi maktab sozlamasidan.';

-- ---------------------------------------------------------------------
-- 2. SINFLAR
-- ---------------------------------------------------------------------

create table if not exists public.classes (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)  on delete restrict,
  -- TZ 5.4.2 — filial har bir tegishli jadvalda majburiy.
  branch_id     uuid not null references public.branches(id) on delete restrict,
  name          text not null,
  grade_level   smallint check (grade_level between 0 and 12),
  -- TZ 12.1.6 — sinf rahbari. Oylikdagi ustama shu bog'lanish orqali
  -- kimga tegishli ekani aniqlanadi.
  teacher_id    uuid references public.teachers(id) on delete set null,
  capacity      smallint check (capacity is null or capacity > 0),
  academic_year text not null,
  is_active     boolean     not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.classes is
  'Sinflar. O''quv yili bo''yicha yuritiladi — 5-A 2026/2027 va 5-A '
  '2027/2028 alohida yozuvlar, shuning uchun tarix saqlanadi.';
comment on column public.classes.teacher_id is
  'TZ 12.1.6 — sinf rahbari. Oylikdagi "class_teacher" ustamasi shu '
  'o''qituvchiga tegishli ekanini belgilaydi.';

-- Bir filialda, bir o'quv yilida sinf nomi takrorlanmaydi.
create unique index if not exists classes_unique_idx
  on public.classes(branch_id, academic_year, name)
  where deleted_at is null;

create index if not exists classes_branch_idx
  on public.classes(branch_id, academic_year)
  where deleted_at is null and is_active;
create index if not exists classes_teacher_idx
  on public.classes(teacher_id) where teacher_id is not null;

select app.attach_touch_trigger('classes');
select app.attach_audit_trigger('classes');

-- ---------------------------------------------------------------------
-- 3. O'QUVCHINI SINFGA BOG'LASH
-- ---------------------------------------------------------------------

alter table public.students
  add column if not exists class_id uuid references public.classes(id)
  on delete set null;

create index if not exists students_class_idx on public.students(class_id)
  where deleted_at is null;

comment on column public.students.class_name is
  'Sinf nomi. class_id berilganda TRIGGER avtomatik to''ldiradi — '
  'qo''lda yozilmaydi. Eski so''rovlar (filtr, guruhlash) shu maydonni '
  'ishlatadi, shuning uchun u saqlanib qoldi.';

-- =====================================================================
--  4. SINXRONLIK TRIGGERLARI
--
--  Ikki tomonlama: o'quvchi sinfga bog'langanda nomi ko'chadi, sinf
--  nomi o'zgarganda esa barcha o'quvchida yangilanadi. Shu tufayli
--  class_id va class_name hech qachon bir-biridan uzilib qolmaydi.
-- =====================================================================

create or replace function app.sync_student_class_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is not null then
    select c.name, coalesce(new.grade_level, c.grade_level)
      into new.class_name, new.grade_level
      from public.classes c
     where c.id = new.class_id;
  end if;
  return new;
end;
$$;

comment on function app.sync_student_class_name() is
  'O''quvchi sinfga bog''langanda class_name ni sinf nomidan oladi.';

drop trigger if exists trg_students_sync_class on public.students;
create trigger trg_students_sync_class
  before insert or update of class_id on public.students
  for each row execute function app.sync_student_class_name();

create or replace function app.sync_class_rename()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is distinct from old.name
     or new.grade_level is distinct from old.grade_level then
    update public.students
       set class_name = new.name,
           grade_level = coalesce(new.grade_level, grade_level)
     where class_id = new.id;
  end if;
  return new;
end;
$$;

comment on function app.sync_class_rename() is
  'Sinf nomi o''zgarganda barcha o''quvchida class_name yangilanadi. '
  'Busiz nomni o''zgartirish har bir o''quvchini qo''lda tahrirlashni '
  'talab qilardi.';

drop trigger if exists trg_classes_rename on public.classes;
create trigger trg_classes_rename
  after update of name, grade_level on public.classes
  for each row execute function app.sync_class_rename();

-- =====================================================================
--  5. MAVJUD MA'LUMOTNI KO'CHIRISH
--
--  Har bir (filial, sinf nomi) juftligi uchun sinf yaratiladi va
--  o'quvchilar unga bog'lanadi. Idempotent — qayta ishga tushirsa
--  dublikat yaratmaydi.
-- =====================================================================

do $do$
declare
  r record;
  v_class uuid;
  v_created int := 0;
  v_linked  int := 0;
begin
  for r in
    select distinct
           s.school_id,
           s.branch_id,
           s.class_name,
           max(s.grade_level) as grade_level,
           app.academic_year(s.school_id) as year
      from public.students s
     where s.class_name is not null
       and btrim(s.class_name) <> ''
       and s.class_id is null
       and s.deleted_at is null
     group by s.school_id, s.branch_id, s.class_name
  loop
    select id into v_class
      from public.classes
     where branch_id = r.branch_id
       and academic_year = r.year
       and name = r.class_name
       and deleted_at is null;

    if v_class is null then
      insert into public.classes
        (school_id, branch_id, name, grade_level, academic_year)
      values
        (r.school_id, r.branch_id, r.class_name, r.grade_level, r.year)
      returning id into v_class;
      v_created := v_created + 1;
    end if;

    update public.students
       set class_id = v_class
     where branch_id = r.branch_id
       and class_name = r.class_name
       and class_id is null
       and deleted_at is null;

    get diagnostics v_linked = row_count;
  end loop;

  raise notice 'Sinflar ko''chirildi: % ta sinf yaratildi', v_created;
end $do$;

-- Tekshiruv: sinfi bor, lekin bog'lanmagan o'quvchi qolmasin.
do $do$
declare v_orphan int;
begin
  select count(*) into v_orphan
    from public.students
   where class_name is not null
     and btrim(class_name) <> ''
     and class_id is null
     and deleted_at is null;

  if v_orphan > 0 then
    raise exception 'Ko''chirish to''liq emas: % ta o''quvchi sinfsiz qoldi', v_orphan;
  end if;

  raise notice 'Barcha o''quvchi sinfga bog''landi.';
end $do$;

-- =====================================================================
--  6. RLS — A guruh naqshi (10-migratsiya bilan bir xil)
-- =====================================================================

alter table public.classes enable row level security;

drop policy if exists classes_select on public.classes;
create policy classes_select on public.classes
  for select to authenticated
  using ((school_id = app.school_id() and branch_id = any (app.branch_ids()))
         or app.is_platform_admin());

drop policy if exists classes_insert on public.classes;
create policy classes_insert on public.classes
  for insert to authenticated
  with check (school_id = app.school_id()
              and branch_id = any (app.branch_ids())
              and app.may_write('students.manage'));

drop policy if exists classes_update on public.classes;
create policy classes_update on public.classes
  for update to authenticated
  using (school_id = app.school_id()
         and branch_id = any (app.branch_ids())
         and app.may_write('students.manage'))
  with check (school_id = app.school_id()
              and branch_id = any (app.branch_ids())
              and app.may_write('students.manage'));

-- TZ 5.4.8 — DELETE siyosati yaratilmaydi.
grant select, insert, update on public.classes to authenticated;

grant execute on function app.academic_year(uuid, date)
  to authenticated, service_role;
