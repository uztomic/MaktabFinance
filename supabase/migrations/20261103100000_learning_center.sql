-- =====================================================================
--  O'QUV MARKAZI REJIMI
--
--  Tizim endi ikki turdagi tashkilotga xizmat qiladi:
--
--    · school          — xususiy maktab (sinf, o'quv yili, shartnoma)
--    · learning_center — o'quv markazi (kurs, guruh, dars jadvali)
--
--  ASOSIY QAROR: moliya dvigateli O'ZGARMAYDI.
--
--  Guruh — bu oylik xizmat (`services`, billing_type = monthly_fixed).
--  O'quvchini guruhga yozish = unga shu xizmatni ulash
--  (`student_services`). Natijada hisoblanma, proporsional hisob (oy
--  o'rtasida qo'shilsa), chegirma, to'lov, qarzdorlik, davr qulfi,
--  Telegram bot va 7 ta hisobot — HAMMASI guruhlar uchun ham
--  hech qanday o'zgarishsiz ishlaydi va allaqachon sinovdan o'tgan.
--
--  Yangi jadvallar faqat o'quv jarayonini yuritadi:
--    rooms             — xonalar (sig'im, bandlik)
--    courses           — kurslar (Ingliz tili, IELTS, Matematika...)
--    study_groups      — guruhlar (kurs + o'qituvchi + xona + jadval + narx)
--    group_members     — guruh a'zoligi (sinov / faol / muzlatilgan / chiqqan)
--    group_freezes     — muzlatish davrlari (shu kunlar hisoblanmaydi)
--    group_sessions    — har bir dars (reja → o'tdi / bekor)
--    session_attendance — darsdagi davomat va baho
--
--  O'qituvchi haqi: guruh bo'yicha (foiz / darsbay / o'quvchibay)
--  oylik hisobiga ALOHIDA QATOR bo'lib tushadi (calc_payroll).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. TASHKILOT TURI
-- ---------------------------------------------------------------------

alter table public.schools
  add column if not exists org_type text not null default 'school';

alter table public.schools drop constraint if exists schools_org_type_check;
alter table public.schools
  add constraint schools_org_type_check
  check (org_type in ('school', 'learning_center'));

comment on column public.schools.org_type is
  'Tashkilot turi: school — xususiy maktab, learning_center — o''quv '
  'markazi. Panel menyusi va atamalar shunga qarab moslashadi.';

create or replace function public.set_org_type(p_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
begin
  if p_type not in ('school', 'learning_center') then
    raise exception 'Noma''lum tashkilot turi: %', p_type using errcode = '22023';
  end if;
  if v_school is null or app.role() <> 'director' then
    raise exception 'Tashkilot turini faqat direktor o''zgartiradi'
      using errcode = '42501';
  end if;
  if app.is_readonly_session() then
    raise exception 'Sessiya faqat o''qish rejimida' using errcode = '42501';
  end if;

  update public.schools set org_type = p_type where id = v_school;
  return p_type;
end;
$$;

comment on function public.set_org_type(text) is
  'Direktor tashkilot turini tanlaydi. Ma''lumot o''chmaydi — faqat '
  'panel menyusi va atamalar almashadi.';

-- ---------------------------------------------------------------------
-- 1. XONALAR
-- ---------------------------------------------------------------------

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  name        text not null,
  capacity    smallint check (capacity is null or capacity > 0),
  is_active   boolean     not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

comment on table public.rooms is
  'O''quv xonalari. Jadval to''qnashuvini tekshirish shu orqali.';

create unique index if not exists rooms_unique_idx
  on public.rooms(branch_id, name) where deleted_at is null;

select app.attach_touch_trigger('rooms');
select app.attach_audit_trigger('rooms');

-- ---------------------------------------------------------------------
-- 2. KURSLAR
-- ---------------------------------------------------------------------

create table if not exists public.courses (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete restrict,
  name              text not null,
  -- Daraja yoki bosqich: Beginner, Elementary, 1-bosqich...
  level             text,
  -- Kurs davomiyligi (oy). Guruh tugash sanasini taklif qilish uchun.
  duration_months   smallint check (duration_months is null or duration_months between 1 and 60),
  -- Odatiy narx — yangi guruh ochilganda taklif qilinadi.
  default_price     numeric(14,2) check (default_price is null or default_price >= 0),
  -- Odatiy dars davomiyligi (daqiqa).
  lesson_minutes    smallint check (lesson_minutes is null or lesson_minutes between 15 and 480),
  color             text,
  is_active         boolean     not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

comment on table public.courses is
  'Kurslar katalogi. Bitta kurs bo''yicha bir nechta guruh ochiladi.';

create unique index if not exists courses_unique_idx
  on public.courses(school_id, name, coalesce(level, '')) where deleted_at is null;

select app.attach_touch_trigger('courses');
select app.attach_audit_trigger('courses');

-- ---------------------------------------------------------------------
-- 3. GURUHLAR
-- ---------------------------------------------------------------------

create table if not exists public.study_groups (
  id                 uuid primary key default gen_random_uuid(),
  school_id          uuid not null references public.schools(id)  on delete restrict,
  branch_id          uuid not null references public.branches(id) on delete restrict,
  course_id          uuid references public.courses(id)  on delete set null,
  name               text not null,
  teacher_id         uuid references public.teachers(id) on delete set null,
  room_id            uuid references public.rooms(id)    on delete set null,
  -- Hisoblanma shu xizmat orqali ketadi (1:1). Trigger yaratadi.
  service_id         uuid references public.services(id) on delete restrict,
  -- Hafta kunlari: 1 = dushanba ... 7 = yakshanba (ISO).
  days               smallint[] not null default '{}',
  start_time         time,
  end_time           time,
  starts_on          date not null default current_date,
  ends_on            date,
  capacity           smallint check (capacity is null or capacity > 0),
  status             text not null default 'active'
                     check (status in ('forming', 'active', 'finished')),
  -- O'qituvchi haqi shu guruh bo'yicha. null = guruhdan haq yo'q
  -- (masalan qat'iy oylikdagi xodim).
  teacher_pay_kind   text check (teacher_pay_kind is null or
                     teacher_pay_kind in ('percent', 'per_lesson', 'per_student')),
  teacher_pay_value  numeric(14,2) check (teacher_pay_value is null or teacher_pay_value >= 0),
  is_online          boolean     not null default false,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  constraint study_groups_time_valid
    check (start_time is null or end_time is null or end_time > start_time),
  constraint study_groups_period_valid
    check (ends_on is null or ends_on >= starts_on),
  constraint study_groups_days_valid
    check (days <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint study_groups_percent_valid
    check (teacher_pay_kind is distinct from 'percent' or teacher_pay_value <= 100)
);

comment on table public.study_groups is
  'O''quv markazi guruhlari. Har guruhga bitta oylik xizmat bog''lanadi — '
  'hisoblanma mavjud moliya dvigateli orqali ketadi.';
comment on column public.study_groups.teacher_pay_kind is
  'percent — guruh hisoblanmasidan foiz; per_lesson — har o''tilgan dars '
  'uchun; per_student — har bir qatnashgan o''quvchi × dars uchun.';

create unique index if not exists study_groups_unique_idx
  on public.study_groups(branch_id, name) where deleted_at is null;
create index if not exists study_groups_teacher_idx
  on public.study_groups(teacher_id) where deleted_at is null;
create unique index if not exists study_groups_service_idx
  on public.study_groups(service_id) where service_id is not null;

select app.attach_touch_trigger('study_groups');
select app.attach_audit_trigger('study_groups');

-- --- Guruh ↔ xizmat sinxronlash ---------------------------------------
--  Guruh yaratilganda xizmat ham yaratiladi; nomi o'zgarsa xizmat ham
--  o'zgaradi. Narx `set_group_price` orqali (tarix bilan) beriladi.

create or replace function app.sync_group_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service uuid;
begin
  if new.service_id is null then
    insert into public.services
      (school_id, branch_id, code, name, billing_type, note)
    values
      (new.school_id, new.branch_id, 'grp_' || replace(new.id::text, '-', ''),
       new.name, 'monthly_fixed', 'Guruh to''lovi (avtomatik)')
    returning id into v_service;
    new.service_id := v_service;
  elsif tg_op = 'UPDATE' and (new.name is distinct from old.name
                               or new.deleted_at is distinct from old.deleted_at) then
    update public.services
       set name = new.name,
           is_active = new.deleted_at is null,
           deleted_at = new.deleted_at
     where id = new.service_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_study_groups_service on public.study_groups;
create trigger trg_study_groups_service
  before insert or update on public.study_groups
  for each row execute function app.sync_group_service();

-- ---------------------------------------------------------------------
-- 4. GURUH A'ZOLIGI
-- ---------------------------------------------------------------------

create table if not exists public.group_members (
  id                  uuid primary key default gen_random_uuid(),
  school_id           uuid not null references public.schools(id)   on delete restrict,
  branch_id           uuid not null references public.branches(id)  on delete restrict,
  group_id            uuid not null references public.study_groups(id) on delete cascade,
  student_id          uuid not null references public.students(id)  on delete cascade,
  status              text not null default 'active'
                      check (status in ('trial', 'active', 'frozen', 'left')),
  joined_on           date not null default current_date,
  left_on             date,
  left_reason         text,
  -- Sinov darsi sanasi (status = 'trial' bo'lganda).
  trial_on            date,
  note                text,
  created_by          uuid references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint group_members_period_valid
    check (left_on is null or left_on >= joined_on)
);

comment on table public.group_members is
  'Guruh a''zoligi. Hisob-kitob student_services orqali — bu jadval '
  'o''quv holatini (sinov, muzlatilgan, chiqqan) saqlaydi.';

-- Bir o'quvchi bir guruhda bir vaqtda bitta faol a'zolik.
create unique index if not exists group_members_one_open_idx
  on public.group_members(group_id, student_id) where status <> 'left';
create index if not exists group_members_student_idx
  on public.group_members(student_id);
create index if not exists group_members_group_idx
  on public.group_members(group_id) where status <> 'left';

select app.attach_touch_trigger('group_members');
select app.attach_audit_trigger('group_members');

create table if not exists public.group_freezes (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  member_id   uuid not null references public.group_members(id) on delete cascade,
  from_on     date not null,
  to_on       date,
  reason      text,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint group_freezes_period_valid check (to_on is null or to_on >= from_on)
);

comment on table public.group_freezes is
  'Muzlatish (pauza). Shu davrda xizmat yopiladi va hisoblanma tushmaydi.';

create index if not exists group_freezes_member_idx on public.group_freezes(member_id);
select app.attach_audit_trigger('group_freezes');

-- ---------------------------------------------------------------------
-- 5. DARSLAR VA DAVOMAT
-- ---------------------------------------------------------------------

create table if not exists public.group_sessions (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id)  on delete restrict,
  branch_id    uuid not null references public.branches(id) on delete restrict,
  group_id     uuid not null references public.study_groups(id) on delete cascade,
  day          date not null,
  start_time   time,
  end_time     time,
  -- Darsni kim o'tdi (o'rinbosar bo'lishi mumkin).
  teacher_id   uuid references public.teachers(id) on delete set null,
  room_id      uuid references public.rooms(id)    on delete set null,
  status       text not null default 'planned'
               check (status in ('planned', 'held', 'cancelled')),
  topic        text,
  homework     text,
  cancel_reason text,
  marked_at    timestamptz,
  marked_by    uuid references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.group_sessions is
  'Har bir dars. Jadvaldan avtomatik yaratiladi, qo''shimcha dars qo''lda.';

create unique index if not exists group_sessions_unique_idx
  on public.group_sessions(group_id, day, coalesce(start_time, '00:00'::time));
create index if not exists group_sessions_day_idx
  on public.group_sessions(branch_id, day);
create index if not exists group_sessions_teacher_idx
  on public.group_sessions(teacher_id, day);

select app.attach_touch_trigger('group_sessions');
select app.attach_audit_trigger('group_sessions');

create table if not exists public.session_attendance (
  session_id  uuid not null references public.group_sessions(id) on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  school_id   uuid not null references public.schools(id)  on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  status      text not null check (status in ('present', 'absent', 'late', 'excused')),
  -- Baho: 1..5 yoki 0..100 — maktab tanlaydi; bu yerda 0..100.
  grade       smallint check (grade is null or grade between 0 and 100),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (session_id, student_id)
);

comment on table public.session_attendance is
  'Dars davomati va baho. Faqat mark_session_attendance orqali yoziladi.';

create index if not exists session_attendance_student_idx
  on public.session_attendance(student_id);

select app.attach_touch_trigger('session_attendance');

-- ---------------------------------------------------------------------
-- 6. MUROJAATLAR: kurs, guruh, sinov darsi
-- ---------------------------------------------------------------------

alter table public.leads add column if not exists course_id uuid
  references public.courses(id) on delete set null;
alter table public.leads add column if not exists group_id uuid
  references public.study_groups(id) on delete set null;
alter table public.leads add column if not exists trial_on date;
alter table public.leads add column if not exists lost_reason text;

comment on column public.leads.trial_on is
  'Sinov darsi sanasi. Belgilangan bo''lsa murojaat voronkada '
  '"Sinov darsi" bosqichida ko''rinadi.';

-- ---------------------------------------------------------------------
-- 7. RLS — A guruh naqshi (filial bo'yicha)
-- ---------------------------------------------------------------------

do $do$
declare
  t   text;
  w   text;
begin
  for t, w in
    select * from (values
      ('rooms',              'students.manage'),
      ('study_groups',       'students.manage'),
      ('group_members',      'students.manage'),
      ('group_sessions',     'students.manage')
    ) as v(t, w)
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using ((school_id = app.school_id() and branch_id = any (app.branch_ids()))
             or app.is_platform_admin())$p$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$
      create policy %I on public.%I for insert to authenticated
      with check (school_id = app.school_id()
                  and branch_id = any (app.branch_ids())
                  and app.may_write(%L))$p$, t || '_insert', t, w);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$
      create policy %I on public.%I for update to authenticated
      using (school_id = app.school_id()
             and branch_id = any (app.branch_ids())
             and app.may_write(%L))
      with check (school_id = app.school_id()
                  and branch_id = any (app.branch_ids())
                  and app.may_write(%L))$p$, t || '_update', t, w, w);

    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $do$;

-- Muzlatish va davomat: faqat o'qish. Yozish — RPC orqali (biznes
-- qoidalari: xizmatni yopish/ochish, o'qituvchi tekshiruvi).
do $do$
declare t text;
begin
  foreach t in array array['group_freezes', 'session_attendance']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$
      create policy %I on public.%I for select to authenticated
      using ((school_id = app.school_id() and branch_id = any (app.branch_ids()))
             or app.is_platform_admin())$p$, t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $do$;

-- Kurslar maktab darajasida (filialga bog'lanmagan).
alter table public.courses enable row level security;

drop policy if exists courses_select on public.courses;
create policy courses_select on public.courses
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());

drop policy if exists courses_insert on public.courses;
create policy courses_insert on public.courses
  for insert to authenticated
  with check (school_id = app.school_id() and app.may_write('students.manage'));

drop policy if exists courses_update on public.courses;
create policy courses_update on public.courses
  for update to authenticated
  using (school_id = app.school_id() and app.may_write('students.manage'))
  with check (school_id = app.school_id() and app.may_write('students.manage'));

grant select, insert, update on public.courses to authenticated;

-- ---------------------------------------------------------------------
-- 8. GURUH NARXI (tarix bilan)
-- ---------------------------------------------------------------------

create or replace function public.set_group_price(
  p_group_id   uuid,
  p_price      numeric,
  p_valid_from date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.study_groups%rowtype;
  v_from  date;
begin
  select * into g from public.study_groups where id = p_group_id and deleted_at is null;
  if not found then
    raise exception 'Guruh topilmadi' using errcode = '22023';
  end if;
  perform app.assert_may_write('services.manage');
  perform app.assert_branch(g.branch_id);

  if p_price is null or p_price < 0 then
    raise exception 'Narx manfiy bo''lishi mumkin emas' using errcode = '22023';
  end if;

  -- Narx oy boshidan amal qiladi: oy o'rtasida o'zgartirilsa ham
  -- shu oy hisoblanmasi bitta narx bilan chiqadi.
  v_from := date_trunc('month', coalesce(p_valid_from, g.starts_on, current_date))::date;

  -- Yopilgan davrga narx yozib bo'lmaydi.
  perform app.assert_period_open(g.school_id, v_from, g.branch_id);

  -- Kesishgan eski narxlarni yopamiz.
  update public.service_prices
     set valid_to = v_from - 1
   where service_id = g.service_id
     and valid_from < v_from
     and (valid_to is null or valid_to >= v_from);

  -- Aynan shu sanadan boshlanadigan narx bo'lsa — almashtiramiz.
  delete from public.service_prices
   where service_id = g.service_id and valid_from >= v_from;

  insert into public.service_prices (school_id, service_id, price, valid_from, created_by)
  values (g.school_id, g.service_id, p_price, v_from, (select auth.uid()));

  return jsonb_build_object('group_id', g.id, 'price', p_price, 'valid_from', v_from);
end;
$$;

comment on function public.set_group_price(uuid, numeric, date) is
  'Guruh narxi. Oy boshidan amal qiladi; o''tgan oylar hisoblanmasi '
  'o''zgarmaydi (TZ 4.4.5).';

-- Joriy narx (panel uchun).
create or replace function app.group_price(p_group_id uuid, p_on date default current_date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select app.service_price_on(g.service_id, p_on)
    from public.study_groups g where g.id = p_group_id;
$$;

-- ---------------------------------------------------------------------
-- 9. O'QUVCHINI GURUHGA YOZISH / CHIQARISH / MUZLATISH
-- ---------------------------------------------------------------------

-- O'quvchida faol shartnoma bo'lmasa — 0 so'mlik shartnoma ochiladi.
-- Hisoblanma dvigateli shartnoma orqali o'quvchini ko'radi; o'qish
-- puli esa guruh xizmatlaridan keladi.
create or replace function app.ensure_lc_contract(p_student_id uuid, p_from date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  st      public.students%rowtype;
  v_id    uuid;
  v_n     bigint;
  v_num   text;
begin
  select id into v_id from public.contracts
   where student_id = p_student_id and is_active;
  if v_id is not null then
    -- Shartnoma keyinroq boshlansa — guruh sanasiga tortamiz, aks
    -- holda birinchi oy hisoblanmaga tushmay qoladi.
    update public.contracts
       set starts_on = p_from
     where id = v_id and starts_on > p_from;
    return v_id;
  end if;

  select * into st from public.students where id = p_student_id;

  loop
    v_n := app.next_counter(st.school_id, st.school_id, 'lc_contract');
    v_num := 'G-' || lpad(v_n::text, 5, '0');
    exit when not exists (select 1 from public.contracts
                           where school_id = st.school_id and number = v_num);
  end loop;

  insert into public.contracts
    (school_id, student_id, number, signed_on, starts_on, tuition_amount,
     billing_months, due_day, note)
  values
    (st.school_id, p_student_id, v_num, p_from, p_from, 0, 12,
     coalesce((app.school_setting(st.school_id, 'lc_due_day', '5'::jsonb))::int, 5),
     'O''quv markazi: to''lov guruhlar bo''yicha')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.enroll_to_group(
  p_group_id   uuid,
  p_student_id uuid,
  p_from       date default current_date,
  p_trial      boolean default false,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.study_groups%rowtype;
  st      public.students%rowtype;
  v_id    uuid;
  v_count int;
begin
  select * into g from public.study_groups where id = p_group_id and deleted_at is null;
  if not found then
    raise exception 'Guruh topilmadi' using errcode = '22023';
  end if;
  select * into st from public.students
   where id = p_student_id and deleted_at is null and school_id = g.school_id;
  if not found then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(g.branch_id);

  if g.status = 'finished' then
    raise exception 'Guruh yakunlangan' using errcode = '22023';
  end if;

  if exists (select 1 from public.group_members
              where group_id = p_group_id and student_id = p_student_id
                and status <> 'left') then
    raise exception 'O''quvchi bu guruhda allaqachon bor' using errcode = '23505';
  end if;

  if g.capacity is not null and not p_trial then
    select count(*) into v_count from public.group_members
     where group_id = p_group_id and status in ('active', 'frozen');
    if v_count >= g.capacity then
      raise exception 'Guruh to''la: % / % o''rin band', v_count, g.capacity
        using errcode = '22023';
    end if;
  end if;

  insert into public.group_members
    (school_id, branch_id, group_id, student_id, status, joined_on, trial_on,
     note, created_by)
  values
    (g.school_id, g.branch_id, p_group_id, p_student_id,
     case when p_trial then 'trial' else 'active' end,
     p_from, case when p_trial then p_from end, p_note, (select auth.uid()))
  returning id into v_id;

  -- Sinov darsi bepul: xizmat ulanmaydi. Faol bo'lsa — hisob boshlanadi.
  if not p_trial then
    perform app.assert_period_open(g.school_id, date_trunc('month', p_from)::date, g.branch_id);
    perform app.ensure_lc_contract(p_student_id, p_from);
    insert into public.student_services
      (school_id, student_id, service_id, starts_on, note, created_by)
    values
      (g.school_id, p_student_id, g.service_id, p_from,
       'group_member:' || v_id, (select auth.uid()));
  end if;

  return v_id;
end;
$$;

comment on function public.enroll_to_group(uuid, uuid, date, boolean, text) is
  'O''quvchini guruhga yozadi. Sinov bo''lsa hisob boshlanmaydi; faol '
  'bo''lsa guruh xizmati ulanadi va hisoblanma proporsional chiqadi.';

-- Sinovdan faolga o'tkazish.
create or replace function public.activate_group_member(
  p_member_id uuid,
  p_from      date default current_date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.group_members%rowtype;
  g public.study_groups%rowtype;
begin
  select * into m from public.group_members where id = p_member_id;
  if not found or m.status <> 'trial' then
    raise exception 'Sinov holatidagi a''zolik topilmadi' using errcode = '22023';
  end if;
  select * into g from public.study_groups where id = m.group_id;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(g.branch_id);
  perform app.assert_period_open(g.school_id, date_trunc('month', p_from)::date, g.branch_id);

  update public.group_members
     set status = 'active', joined_on = least(joined_on, p_from)
   where id = p_member_id;

  perform app.ensure_lc_contract(m.student_id, p_from);
  insert into public.student_services
    (school_id, student_id, service_id, starts_on, note, created_by)
  values
    (g.school_id, m.student_id, g.service_id, p_from,
     'group_member:' || m.id, (select auth.uid()));
end;
$$;

create or replace function public.leave_group(
  p_member_id uuid,
  p_on        date default current_date,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.group_members%rowtype;
  g public.study_groups%rowtype;
begin
  select * into m from public.group_members where id = p_member_id;
  if not found or m.status = 'left' then
    raise exception 'A''zolik topilmadi' using errcode = '22023';
  end if;
  select * into g from public.study_groups where id = m.group_id;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(g.branch_id);

  if p_on < m.joined_on then
    raise exception 'Chiqish sanasi qo''shilgan sanadan oldin bo''lishi mumkin emas'
      using errcode = '22023';
  end if;

  -- Xizmatni yopamiz: p_on — oxirgi o'qigan kun.
  update public.student_services
     set ends_on = p_on
   where student_id = m.student_id
     and service_id = g.service_id
     and (ends_on is null or ends_on > p_on)
     and starts_on <= p_on;

  -- Chiqish sanasidan keyin boshlanadigan (muzlatishdan qaytish) — bekor.
  delete from public.student_services
   where student_id = m.student_id
     and service_id = g.service_id
     and starts_on > p_on;

  update public.group_freezes set to_on = p_on
   where member_id = p_member_id and (to_on is null or to_on > p_on) and from_on <= p_on;

  update public.group_members
     set status = 'left', left_on = p_on, left_reason = p_reason
   where id = p_member_id;
end;
$$;

-- Guruhdan guruhga o'tkazish — bitta amalda chiqish va yozilish.
create or replace function public.transfer_group_member(
  p_member_id    uuid,
  p_to_group_id  uuid,
  p_on           date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.group_members%rowtype;
begin
  select * into m from public.group_members where id = p_member_id;
  if not found or m.status = 'left' then
    raise exception 'A''zolik topilmadi' using errcode = '22023';
  end if;
  if m.group_id = p_to_group_id then
    raise exception 'O''quvchi allaqachon shu guruhda' using errcode = '22023';
  end if;

  perform public.leave_group(p_member_id, p_on - 1, 'Boshqa guruhga o''tdi');
  return public.enroll_to_group(p_to_group_id, m.student_id, p_on,
                                m.status = 'trial', null);
end;
$$;

create or replace function public.freeze_group_member(
  p_member_id uuid,
  p_from      date,
  p_to        date,
  p_reason    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m     public.group_members%rowtype;
  g     public.study_groups%rowtype;
  v_id  uuid;
begin
  select * into m from public.group_members where id = p_member_id;
  if not found or m.status <> 'active' then
    raise exception 'Faqat faol a''zolikni muzlatish mumkin' using errcode = '22023';
  end if;
  select * into g from public.study_groups where id = m.group_id;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(g.branch_id);

  if p_to is null or p_to < p_from then
    raise exception 'Muzlatish davri noto''g''ri' using errcode = '22023';
  end if;
  if p_from < m.joined_on then
    raise exception 'Muzlatish qo''shilgan sanadan oldin boshlanmaydi' using errcode = '22023';
  end if;
  perform app.assert_period_open(g.school_id, date_trunc('month', p_from)::date, g.branch_id);

  -- Xizmatni muzlatishdan oldingi kunda yopamiz...
  update public.student_services
     set ends_on = p_from - 1
   where student_id = m.student_id
     and service_id = g.service_id
     and starts_on < p_from
     and (ends_on is null or ends_on >= p_from);

  -- ...va qaytish kunidan qayta ochamiz.
  insert into public.student_services
    (school_id, student_id, service_id, starts_on, note, created_by)
  values
    (g.school_id, m.student_id, g.service_id, p_to + 1,
     'group_member:' || m.id || ':after_freeze', (select auth.uid()));

  insert into public.group_freezes
    (school_id, branch_id, member_id, from_on, to_on, reason, created_by)
  values
    (g.school_id, g.branch_id, p_member_id, p_from, p_to, p_reason, (select auth.uid()))
  returning id into v_id;

  -- Holat bugungi kunga qarab: muzlatish allaqachon boshlangan bo'lsa.
  if p_from <= current_date and p_to >= current_date then
    update public.group_members set status = 'frozen' where id = p_member_id;
  end if;

  return v_id;
end;
$$;

-- Muzlatish holatini sanaga qarab yangilash (kunlik cron yoki panel).
create or replace function app.refresh_frozen_members()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int; v_m int;
begin
  update public.group_members gm
     set status = 'frozen'
   where gm.status = 'active'
     and exists (select 1 from public.group_freezes f
                  where f.member_id = gm.id
                    and f.from_on <= current_date and f.to_on >= current_date);
  get diagnostics v_n = row_count;

  update public.group_members gm
     set status = 'active'
   where gm.status = 'frozen'
     and not exists (select 1 from public.group_freezes f
                      where f.member_id = gm.id
                        and f.from_on <= current_date and f.to_on >= current_date);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. DARSLARNI JADVALDAN YARATISH
-- ---------------------------------------------------------------------

create or replace function public.generate_group_sessions(
  p_group_id uuid,
  p_from     date,
  p_to       date
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.study_groups%rowtype;
  d       date;
  v_n     int := 0;
  v_from  date;
  v_to    date;
begin
  select * into g from public.study_groups where id = p_group_id and deleted_at is null;
  if not found then
    raise exception 'Guruh topilmadi' using errcode = '22023';
  end if;
  perform app.assert_may_write('students.manage');
  perform app.assert_branch(g.branch_id);

  if p_to - p_from > 370 then
    raise exception 'Bir martada ko''pi bilan bir yillik dars yaratiladi'
      using errcode = '22023';
  end if;

  v_from := greatest(p_from, g.starts_on);
  v_to   := least(p_to, coalesce(g.ends_on, p_to));

  d := v_from;
  while d <= v_to loop
    if extract(isodow from d)::smallint = any (g.days)
       and not exists (
         select 1 from public.calendar_days c
          where c.school_id = g.school_id
            and (c.branch_id is null or c.branch_id = g.branch_id)
            and c.day = d
            and c.day_type in ('holiday', 'vacation'))
    then
      insert into public.group_sessions
        (school_id, branch_id, group_id, day, start_time, end_time, teacher_id, room_id)
      values
        (g.school_id, g.branch_id, g.id, d, g.start_time, g.end_time, g.teacher_id, g.room_id)
      on conflict do nothing;
      if found then v_n := v_n + 1; end if;
    end if;
    d := d + 1;
  end loop;

  return v_n;
end;
$$;

comment on function public.generate_group_sessions(uuid, date, date) is
  'Guruh jadvali (hafta kunlari + vaqt) bo''yicha darslar yaratadi. '
  'Bayram va ta''til kunlari (calendar_days) o''tkazib yuboriladi. '
  'Idempotent — mavjud darslar takrorlanmaydi.';

-- ---------------------------------------------------------------------
-- 11. JADVAL TO'QNASHUVI
-- ---------------------------------------------------------------------

create or replace function public.group_conflicts(
  p_branch_id  uuid,
  p_days       smallint[],
  p_start      time,
  p_end        time,
  p_teacher_id uuid,
  p_room_id    uuid,
  p_except_id  uuid default null
)
returns table (kind text, group_id uuid, group_name text, days smallint[],
               start_time time, end_time time)
language sql
stable
security definer
set search_path = ''
as $$
  select case when g.room_id = p_room_id then 'room' else 'teacher' end,
         g.id, g.name, g.days, g.start_time, g.end_time
    from public.study_groups g
   where g.school_id = app.school_id()
     and g.deleted_at is null
     and g.status <> 'finished'
     and (p_except_id is null or g.id <> p_except_id)
     and g.days && p_days
     and g.start_time < p_end and g.end_time > p_start
     and ((p_room_id is not null and g.room_id = p_room_id and g.branch_id = p_branch_id)
          or (p_teacher_id is not null and g.teacher_id = p_teacher_id));
$$;

comment on function public.group_conflicts(uuid, smallint[], time, time, uuid, uuid, uuid) is
  'Bir xona yoki bir o''qituvchi bir vaqtda ikki guruhga tushib '
  'qolmasligi uchun ogohlantirish.';

-- ---------------------------------------------------------------------
-- 12. DAVOMAT
-- ---------------------------------------------------------------------

create or replace function public.session_roster(p_session_id uuid)
returns table (student_id uuid, full_name text, member_status text,
               status text, grade smallint, comment text, balance numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.group_sessions%rowtype;
begin
  select * into s from public.group_sessions where id = p_session_id;
  if not found then
    raise exception 'Dars topilmadi' using errcode = '22023';
  end if;

  if not (
       (s.school_id = app.school_id() and s.branch_id = any (app.branch_ids()))
       or exists (select 1 from public.study_groups g
                    join public.teachers t on t.id in (g.teacher_id, s.teacher_id)
                   where g.id = s.group_id and t.user_id = (select auth.uid()))
  ) then
    raise exception 'Ruxsat yo''q' using errcode = '42501';
  end if;

  return query
    select st.id, st.full_name, gm.status,
           sa.status, sa.grade, sa.comment,
           (select coalesce(vb.balance, 0) from public.v_student_balances vb
             where vb.student_id = st.id)::numeric
      from public.group_members gm
      join public.students st on st.id = gm.student_id
      left join public.session_attendance sa
             on sa.session_id = s.id and sa.student_id = st.id
     where gm.group_id = s.group_id
       and gm.joined_on <= s.day
       and (gm.left_on is null or gm.left_on >= s.day)
       and (gm.status <> 'left' or gm.left_on >= s.day)
     order by st.full_name;
end;
$$;

create or replace function public.mark_session_attendance(
  p_session_id uuid,
  p_records    jsonb,
  p_topic      text default null,
  p_homework   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          public.group_sessions%rowtype;
  g          public.study_groups%rowtype;
  v_uid      uuid := (select auth.uid());
  v_teacher  boolean;
  r          jsonb;
  v_n        int := 0;
begin
  select * into s from public.group_sessions where id = p_session_id;
  if not found then
    raise exception 'Dars topilmadi' using errcode = '22023';
  end if;
  select * into g from public.study_groups where id = s.group_id;

  select exists (
    select 1 from public.teachers t
     where t.id in (g.teacher_id, s.teacher_id) and t.user_id = v_uid and t.is_active
  ) into v_teacher;

  if not v_teacher then
    perform app.assert_may_write('absences.mark');
    perform app.assert_branch(s.branch_id);
  else
    if app.is_readonly_session() or not app.school_is_writable() then
      raise exception 'Hozir yozib bo''lmaydi' using errcode = '42501';
    end if;
    -- O'qituvchi faqat yaqin kunlarni belgilaydi (bir hafta).
    if s.day < current_date - 7 then
      raise exception 'Bir haftadan eski darsni o''qituvchi o''zgartira olmaydi'
        using errcode = '42501';
    end if;
  end if;

  if s.day > current_date then
    raise exception 'Kelajakdagi dars uchun davomat olinmaydi' using errcode = '22023';
  end if;
  if s.status = 'cancelled' then
    raise exception 'Bekor qilingan dars' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    if not exists (select 1 from public.group_members gm
                    where gm.group_id = s.group_id
                      and gm.student_id = (r ->> 'student_id')::uuid) then
      raise exception 'O''quvchi bu guruhda emas' using errcode = '22023';
    end if;

    insert into public.session_attendance
      (session_id, student_id, school_id, branch_id, status, grade, comment)
    values
      (s.id, (r ->> 'student_id')::uuid, s.school_id, s.branch_id,
       coalesce(r ->> 'status', 'present'),
       nullif(r ->> 'grade', '')::smallint,
       nullif(r ->> 'comment', ''))
    on conflict (session_id, student_id) do update
      set status  = excluded.status,
          grade   = excluded.grade,
          comment = excluded.comment;
    v_n := v_n + 1;
  end loop;

  update public.group_sessions
     set status = 'held',
         topic = coalesce(p_topic, topic),
         homework = coalesce(p_homework, homework),
         marked_at = now(),
         marked_by = v_uid
   where id = s.id;

  return jsonb_build_object('session_id', s.id, 'marked', v_n);
end;
$$;

create or replace function public.cancel_session(p_session_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare s public.group_sessions%rowtype;
begin
  select * into s from public.group_sessions where id = p_session_id;
  if not found then
    raise exception 'Dars topilmadi' using errcode = '22023';
  end if;
  perform app.assert_may_write('students.manage');
  perform app.assert_branch(s.branch_id);

  delete from public.session_attendance where session_id = s.id;
  update public.group_sessions
     set status = 'cancelled', cancel_reason = p_reason
   where id = s.id;
end;
$$;

-- O'qituvchining bugungi (yoki berilgan kundagi) darslari.
create or replace function public.my_group_sessions(p_day date default current_date)
returns table (session_id uuid, group_id uuid, group_name text, course_name text,
               day date, start_time time, end_time time, room_name text,
               status text, students int, marked int)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, g.id, g.name, c.name, s.day, s.start_time, s.end_time, r.name,
         s.status,
         (select count(*)::int from public.group_members gm
           where gm.group_id = g.id and gm.status in ('active', 'trial')),
         (select count(*)::int from public.session_attendance sa where sa.session_id = s.id)
    from public.group_sessions s
    join public.study_groups g on g.id = s.group_id
    join public.teachers t     on t.id = coalesce(s.teacher_id, g.teacher_id)
    left join public.courses c on c.id = g.course_id
    left join public.rooms r   on r.id = s.room_id
   where t.user_id = (select auth.uid())
     and s.day = p_day
   order by s.start_time nulls last;
$$;

-- ---------------------------------------------------------------------
-- 13. O'QITUVCHI HAQI — GURUHLAR BO'YICHA
-- ---------------------------------------------------------------------

create or replace function app.teacher_group_earnings(
  p_teacher_id uuid,
  p_from       date,
  p_to         date
)
returns table (group_id uuid, group_name text, branch_id uuid, pay_kind text,
               quantity numeric, unit_price numeric, amount numeric, detail jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  -- Darsbay: o'qituvchi o'tgan har bir dars.
  select g.id, g.name, g.branch_id, 'per_lesson',
         count(s.id)::numeric, g.teacher_pay_value,
         round(count(s.id) * g.teacher_pay_value, 2),
         jsonb_build_object('lessons', count(s.id))
    from public.study_groups g
    join public.group_sessions s
      on s.group_id = g.id and s.status = 'held'
     and s.day between p_from and p_to
     and coalesce(s.teacher_id, g.teacher_id) = p_teacher_id
   where g.teacher_pay_kind = 'per_lesson' and coalesce(g.teacher_pay_value, 0) > 0
   group by g.id
  having count(s.id) > 0

  union all

  -- O'quvchibay: har bir qatnashgan (keldi / kechikdi) o'quvchi × dars.
  select g.id, g.name, g.branch_id, 'per_student',
         count(sa.*)::numeric, g.teacher_pay_value,
         round(count(sa.*) * g.teacher_pay_value, 2),
         jsonb_build_object('visits', count(sa.*))
    from public.study_groups g
    join public.group_sessions s
      on s.group_id = g.id and s.status = 'held'
     and s.day between p_from and p_to
     and coalesce(s.teacher_id, g.teacher_id) = p_teacher_id
    join public.session_attendance sa
      on sa.session_id = s.id and sa.status in ('present', 'late')
   where g.teacher_pay_kind = 'per_student' and coalesce(g.teacher_pay_value, 0) > 0
   group by g.id
  having count(sa.*) > 0

  union all

  -- Foiz: guruh xizmati bo'yicha shu oy hisoblangan summa (chegirma
  -- ulushi bilan emas, sof guruh qatori). Dars o'tilgan ulushiga
  -- qarab: o'rinbosar o'tgan darslar ulushi chegiriladi.
  select g.id, g.name, g.branch_id, 'percent',
         x.charged, g.teacher_pay_value,
         round(x.charged * g.teacher_pay_value / 100 * x.share, 2),
         jsonb_build_object('charged', x.charged, 'share', x.share,
                            'lessons_total', x.total, 'lessons_mine', x.mine)
    from public.study_groups g
    cross join lateral (
      select coalesce((
               select sum(il.amount)
                 from public.invoice_lines il
                 join public.invoices i on i.id = il.invoice_id
                where il.service_id = g.service_id
                  and i.status <> 'cancelled'
                  and i.period = date_trunc('month', p_from)::date), 0) as charged,
             tot.total, tot.mine,
             case when tot.total = 0
                  then case when g.teacher_id = p_teacher_id then 1 else 0 end
                  else tot.mine::numeric / tot.total end as share
        from (select count(*) filter (where s.status = 'held') as total,
                     count(*) filter (where s.status = 'held'
                                        and coalesce(s.teacher_id, g.teacher_id) = p_teacher_id) as mine
                from public.group_sessions s
               where s.group_id = g.id and s.day between p_from and p_to) tot
    ) x
   where g.teacher_pay_kind = 'percent' and coalesce(g.teacher_pay_value, 0) > 0
     and x.charged > 0 and x.share > 0;
$$;

comment on function app.teacher_group_earnings(uuid, date, date) is
  'O''qituvchining guruhlar bo''yicha haqi. calc_payroll shu funksiyadan '
  '"Guruh" qatorlarini oladi.';

create or replace function public.report_group_earnings(p_period date)
returns table (teacher_id uuid, teacher_name text, group_id uuid, group_name text,
               pay_kind text, quantity numeric, unit_price numeric, amount numeric,
               detail jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.full_name, e.group_id, e.group_name, e.pay_kind,
         e.quantity, e.unit_price, e.amount, e.detail
    from public.teachers t
    cross join lateral app.teacher_group_earnings(
      t.id,
      date_trunc('month', p_period)::date,
      (date_trunc('month', p_period) + interval '1 month - 1 day')::date) e
   where t.school_id = app.school_id()
     and t.deleted_at is null
     and (app.can('payroll.view') or t.user_id = (select auth.uid()))
     and e.branch_id = any (app.branch_ids())
   order by t.full_name, e.group_name;
$$;

-- ---------------------------------------------------------------------
-- 14. calc_payroll — guruh qatorlari qo'shildi
--
--  O'zgarish FAQAT bitta blok: "2a-QISM". Qolgan qism
--  20260901130000_teacher_hour_price.sql dagi bilan aynan bir xil.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calc_payroll(p_teacher_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t             public.teachers%rowtype;
  v_period      date := date_trunc('month', p_period)::date;
  v_month_end   date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_from        date;
  v_to          date;
  v_run_id      uuid;
  v_primary_br  uuid;

  v_base_type   text;
  v_hours_norm  numeric;
  v_hour_price  numeric;
  v_cat_factors jsonb;
  v_cat_factor  numeric;
  v_subst_pct   numeric;
  v_unheld_pol  jsonb;
  v_allowances  jsonb;
  v_deductions  jsonb;
  v_rounding    jsonb;
  v_period_cfg  jsonb;
  v_snapshot    jsonb;

  h             record;
  a             jsonb;
  d             jsonb;
  al            record;
  ent           record;
  ge            record;

  v_base        numeric(14,2) := 0;
  v_gross       numeric(14,2) := 0;
  v_sort        smallint := 0;
  v_val         numeric(14,2);
  v_hours_total numeric := 0;
  v_paid_pct    numeric;
  v_net         numeric(14,2);
  v_rounded     numeric(14,2);
begin
  select * into t from public.teachers where id = p_teacher_id and deleted_at is null;
  if not found then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payroll.manage');
  perform app.assert_period_open(t.school_id, v_period, null);

  v_period_cfg  := app.payroll_setting(t.school_id, 'period', v_period,
                     '{"start_day":1,"end_day":0}'::jsonb);
  v_base_type   := coalesce(
    nullif(t.base_type, ''),
    app.payroll_setting(t.school_id, 'base_type', v_period,
                        '"fixed"'::jsonb) #>> '{}');
  v_hours_norm  := (app.payroll_setting(t.school_id, 'hours_per_rate', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  v_hour_price  := coalesce(
    t.hour_price,
    (app.payroll_setting(t.school_id, 'hour_price', v_period,
       '0'::jsonb) #>> '{}')::numeric);
  v_cat_factors := app.payroll_setting(t.school_id, 'category_factors', v_period, '{}'::jsonb);
  v_subst_pct   := (app.payroll_setting(t.school_id, 'substitution_percent', v_period,
                     '100'::jsonb) #>> '{}')::numeric;
  v_unheld_pol  := app.payroll_setting(t.school_id, 'unheld_lesson_policy', v_period, '{}'::jsonb);
  v_allowances  := app.payroll_setting(t.school_id, 'allowances', v_period, '[]'::jsonb);
  v_deductions  := app.payroll_setting(t.school_id, 'deductions', v_period, '[]'::jsonb);
  v_rounding    := app.payroll_setting(t.school_id, 'rounding', v_period,
                     '{"step":1,"mode":"nearest"}'::jsonb);

  v_from := v_period + ((v_period_cfg ->> 'start_day')::int - 1);
  v_to   := case when coalesce((v_period_cfg ->> 'end_day')::int, 0) = 0
                 then v_month_end
                 else v_period + ((v_period_cfg ->> 'end_day')::int - 1) end;

  v_cat_factor := coalesce((v_cat_factors ->> coalesce(t.category, ''))::numeric, 1);

  v_snapshot := jsonb_build_object(
    'base_type', v_base_type, 'hours_per_rate', v_hours_norm,
    'hour_price', v_hour_price, 'category', t.category,
    'category_factor', v_cat_factor, 'substitution_percent', v_subst_pct,
    'unheld_lesson_policy', v_unheld_pol, 'allowances', v_allowances,
    'deductions', v_deductions, 'rounding', v_rounding,
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'rate_factor', t.rate_factor, 'base_salary', t.base_salary,
    'base_type_per_teacher', t.base_type is not null);

  select id into v_run_id
    from public.payroll_runs
   where teacher_id = p_teacher_id and period = v_period and status <> 'cancelled';

  if v_run_id is null then
    insert into public.payroll_runs
      (school_id, teacher_id, period, status, period_from, period_to, settings_snapshot)
    values
      (t.school_id, p_teacher_id, v_period, 'draft', v_from, v_to, v_snapshot)
    returning id into v_run_id;
  else
    if exists (select 1 from public.payroll_runs where id = v_run_id and status = 'approved') then
      raise exception 'Oylik allaqachon tasdiqlangan — qayta hisoblab bo''lmaydi (TZ 4.11.8)'
        using errcode = '42501';
    end if;
    delete from public.payroll_lines
     where payroll_run_id = v_run_id
       and source_kind <> 'manual';
    update public.payroll_runs
       set settings_snapshot = v_snapshot, calculated_at = now(),
           period_from = v_from, period_to = v_to
     where id = v_run_id;
  end if;

  select branch_id into v_primary_br
    from public.teacher_branches
   where teacher_id = p_teacher_id
   order by load_share desc limit 1;

  select coalesce(sum(held_hours + subst_hours), 0) into v_hours_total
    from app.teacher_hours(p_teacher_id, v_from, v_to);

  -- 1-QISM: ASOSIY HAQ
  if v_base_type = 'fixed' then
    v_base := round(t.base_salary * t.rate_factor, 2);
    if v_base > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy oylik',
         t.rate_factor, t.base_salary, v_base, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor',
                            'base_salary', t.base_salary,
                            'rate_factor', t.rate_factor));
      v_sort := v_sort + 1;
    end if;

  elsif v_base_type = 'rate' then
    v_base := round(v_hours_norm * t.rate_factor * v_hour_price * v_cat_factor, 2);
    if v_base <> 0 then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'base',
       'Stavka (' || app.fmt_num(v_hours_norm * t.rate_factor) || ' soat)',
       v_hours_norm * t.rate_factor, round(v_hour_price * v_cat_factor, 2), v_base, v_sort,
       jsonb_build_object('formula',
                          'hours_per_rate * rate_factor * hour_price * category_factor',
                          'hours_per_rate', v_hours_norm,
                          'rate_factor', t.rate_factor,
                          'hour_price', v_hour_price,
                          'category_factor', v_cat_factor));
    v_sort := v_sort + 1;
    end if;

  else
    v_base := 0;
    for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
    loop
      if h.held_hours > 0 then
        v_val := round(h.held_hours * v_hour_price * v_cat_factor, 2);
        v_base := v_base + v_val;
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'lessons', 'O''tilgan darslar',
           h.held_hours, round(v_hour_price * v_cat_factor, 2), v_val, v_sort,
           jsonb_build_object('formula', 'held_hours * hour_price * category_factor',
                              'held_hours', h.held_hours,
                              'hour_price', v_hour_price,
                              'category_factor', v_cat_factor,
                              'from', v_from, 'to', v_to));
        v_sort := v_sort + 1;
      end if;
    end loop;

    if v_base_type = 'mixed' and t.base_salary > 0 then
      v_val := round(t.base_salary * t.rate_factor, 2);
      v_base := v_base + v_val;
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy qism',
         t.rate_factor, t.base_salary, v_val, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor',
                            'base_salary', t.base_salary,
                            'rate_factor', t.rate_factor));
      v_sort := v_sort + 1;
    end if;
  end if;

  -- 2-QISM: O'RNIGA KIRILGAN VA O'TKAZILMAGAN DARSLAR
  for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
  loop
    v_val := round(h.subst_hours * v_hour_price * v_cat_factor * v_subst_pct / 100, 2);
    if h.subst_hours > 0 and v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, h.branch_id, 'substitution',
         'O''rniga kirilgan darslar (' || app.fmt_num(v_subst_pct) || '%)',
         h.subst_hours,
         round(v_hour_price * v_cat_factor * v_subst_pct / 100, 2), v_val, v_sort,
         jsonb_build_object('formula',
                            'subst_hours * hour_price * category_factor * substitution_percent / 100',
                            'subst_hours', h.subst_hours,
                            'substitution_percent', v_subst_pct));
      v_sort := v_sort + 1;
    end if;

    for ent in select key as reason, value::text::numeric as hours
                 from jsonb_each(h.unheld_detail)
    loop
      v_paid_pct := coalesce(
        (v_unheld_pol -> ent.reason ->> 'paid_percent')::numeric,
        (v_unheld_pol -> 'default'   ->> 'paid_percent')::numeric,
        0);

      v_val := round(ent.hours * v_hour_price * v_cat_factor * v_paid_pct / 100, 2);
      if v_paid_pct > 0 and ent.hours > 0 and v_val <> 0 then
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'unheld',
           'O''tkazilmagan dars — ' || ent.reason ||
             ' (' || app.fmt_num(v_paid_pct) || '%)',
           ent.hours,
           round(v_hour_price * v_cat_factor * v_paid_pct / 100, 2), v_val, v_sort,
           jsonb_build_object('reason', ent.reason, 'paid_percent', v_paid_pct,
                              'hours', ent.hours));
        v_sort := v_sort + 1;
      end if;
    end loop;
  end loop;

  -- =================================================================
  --  2a-QISM: GURUHLAR BO'YICHA HAQ (o'quv markazi)
  --
  --  Guruhda o'qituvchi haqi turi belgilangan bo'lsa (foiz / darsbay /
  --  o'quvchibay) — har guruh alohida qator. Maktabda guruh yo'q,
  --  shuning uchun bu blok hech narsa qo'shmaydi.
  -- =================================================================

  for ge in select * from app.teacher_group_earnings(p_teacher_id, v_from, v_to)
  loop
    if ge.amount <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, ge.branch_id, 'groups',
         'Guruh: ' || ge.group_name || ' (' ||
           case ge.pay_kind
             when 'percent'     then app.fmt_num(ge.unit_price) || '%'
             when 'per_lesson'  then 'darsbay'
             else 'o''quvchibay' end || ')',
         ge.quantity, ge.unit_price, ge.amount, v_sort,
         ge.detail || jsonb_build_object('group_id', ge.group_id,
                                         'pay_kind', ge.pay_kind));
      v_sort := v_sort + 1;
    end if;
  end loop;

  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- 3-QISM: USTAMALAR
  for al in
    select ta.code, ta.value_override
      from public.teacher_allowances ta
     where ta.teacher_id = p_teacher_id
       and ta.starts_on <= v_to
       and (ta.ends_on is null or ta.ends_on >= v_from)
     order by ta.code
  loop
    a := null;
    select value into a
      from jsonb_array_elements(v_allowances) value
     where value ->> 'code' = al.code
     limit 1;

    if a is null then
      continue;
    end if;

    v_val := case
      when coalesce(a ->> 'type', 'fixed') = 'percent'
        then round(v_gross * coalesce(al.value_override, (a ->> 'value')::numeric) / 100, 2)
      else round(coalesce(al.value_override, (a ->> 'value')::numeric), 2)
    end;

    if v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'allowance',
         coalesce(a ->> 'name', al.code), 1, v_val, v_val, v_sort,
         jsonb_build_object('code', al.code,
                            'type', a ->> 'type',
                            'value', coalesce(al.value_override, (a ->> 'value')::numeric),
                            'base', case when coalesce(a ->> 'type', 'fixed') = 'percent'
                                         then v_gross else null end,
                            'overridden', al.value_override is not null));
      v_sort := v_sort + 1;
    end if;
  end loop;

  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- 4-QISM: USHLANMALAR
  for d in select value from jsonb_array_elements(v_deductions) value
  loop
    v_val := case
      when coalesce(d ->> 'type', 'percent') = 'percent'
        then round(v_gross * (d ->> 'value')::numeric / 100, 2)
      else round((d ->> 'value')::numeric, 2)
    end;

    if v_val > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'deduction',
         coalesce(d ->> 'name', d ->> 'code'), 1, -v_val, -v_val, v_sort,
         jsonb_build_object('code', d ->> 'code', 'type', d ->> 'type',
                            'value', (d ->> 'value')::numeric,
                            'base', v_gross));
      v_sort := v_sort + 1;
    end if;
  end loop;

  -- 5-QISM: AVANS
  for al in
    select adv.id, adv.amount, adv.paid_on, adv.branch_id
      from public.teacher_advances adv
     where adv.teacher_id = p_teacher_id and adv.period = v_period
     order by adv.paid_on
  loop
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, al.branch_id, 'advance',
       'Avans (' || to_char(al.paid_on, 'DD.MM.YYYY') || ')',
       1, -al.amount, -al.amount, v_sort,
       jsonb_build_object('advance_id', al.id, 'paid_on', al.paid_on));
    v_sort := v_sort + 1;
  end loop;

  -- 6-QISM: YAXLITLASH
  select coalesce(sum(amount), 0) into v_net
    from public.payroll_lines where payroll_run_id = v_run_id;

  v_rounded := app.round_money(
    v_net,
    coalesce((v_rounding ->> 'step')::numeric, 1),
    coalesce(v_rounding ->> 'mode', 'nearest'));

  if v_rounded <> v_net then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'rounding', 'Yaxlitlash',
       1, v_rounded - v_net, v_rounded - v_net, 99,
       jsonb_build_object('before', v_net, 'after', v_rounded,
                          'step', v_rounding ->> 'step',
                          'mode', v_rounding ->> 'mode'));
  end if;

  return jsonb_build_object(
    'payroll_run_id', v_run_id,
    'teacher_id',     p_teacher_id,
    'period',         v_period,
    'period_from',    v_from,
    'period_to',      v_to,
    'gross',          v_gross,
    'net',            v_rounded,
    'hours',          v_hours_total);
end;
$function$;

-- ---------------------------------------------------------------------
-- 15. O'QUV MARKAZI BOSH SAHIFASI
-- ---------------------------------------------------------------------

create or replace function public.lc_overview(p_day date default current_date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select * from public.study_groups
     where school_id = app.school_id() and deleted_at is null
       and branch_id = any (app.branch_ids())
  ), m as (
    select gm.* from public.group_members gm join g on g.id = gm.group_id
  )
  select jsonb_build_object(
    'groups_active',   (select count(*) from g where status = 'active'),
    'groups_forming',  (select count(*) from g where status = 'forming'),
    'students_active', (select count(distinct student_id) from m where status = 'active'),
    'members_trial',   (select count(*) from m where status = 'trial'),
    'members_frozen',  (select count(*) from m where status = 'frozen'),
    'capacity_total',  (select coalesce(sum(capacity), 0) from g where status <> 'finished'),
    'seats_taken',     (select count(*) from m join g on g.id = m.group_id
                         where m.status in ('active', 'frozen') and g.status <> 'finished'
                           and g.capacity is not null),
    'joined_month',    (select count(*) from m where status <> 'trial'
                         and joined_on >= date_trunc('month', p_day)),
    'left_month',      (select count(*) from m where status = 'left'
                         and left_on >= date_trunc('month', p_day)),
    'sessions_today',  (select count(*) from public.group_sessions s join g on g.id = s.group_id
                         where s.day = p_day and s.status <> 'cancelled'),
    'sessions_unmarked', (select count(*) from public.group_sessions s join g on g.id = s.group_id
                         where s.day < p_day and s.day >= p_day - 7 and s.status = 'planned'),
    'trials_week',     (select count(*) from public.leads l
                         where l.school_id = app.school_id()
                           and l.branch_id = any (app.branch_ids())
                           and l.trial_on between p_day and p_day + 6),
    'leads_open',      (select count(*) from public.leads l
                         where l.school_id = app.school_id()
                           and l.branch_id = any (app.branch_ids())
                           and l.status not in ('accepted', 'rejected'))
  );
$$;

-- ---------------------------------------------------------------------
-- 16. GRANTLAR
-- ---------------------------------------------------------------------

grant execute on function public.set_org_type(text)                         to authenticated;
grant execute on function public.set_group_price(uuid, numeric, date)       to authenticated;
grant execute on function public.enroll_to_group(uuid, uuid, date, boolean, text) to authenticated;
grant execute on function public.activate_group_member(uuid, date)          to authenticated;
grant execute on function public.leave_group(uuid, date, text)              to authenticated;
grant execute on function public.transfer_group_member(uuid, uuid, date)    to authenticated;
grant execute on function public.freeze_group_member(uuid, date, date, text) to authenticated;
grant execute on function public.generate_group_sessions(uuid, date, date)  to authenticated;
grant execute on function public.group_conflicts(uuid, smallint[], time, time, uuid, uuid, uuid) to authenticated;
grant execute on function public.session_roster(uuid)                      to authenticated;
grant execute on function public.mark_session_attendance(uuid, jsonb, text, text) to authenticated;
grant execute on function public.cancel_session(uuid, text)                 to authenticated;
grant execute on function public.my_group_sessions(date)                    to authenticated;
grant execute on function public.report_group_earnings(date)               to authenticated;
grant execute on function public.lc_overview(date)                          to authenticated;
grant execute on function app.group_price(uuid, date)                       to authenticated;

revoke execute on function public.set_org_type(text)                         from anon, public;
revoke execute on function public.set_group_price(uuid, numeric, date)       from anon, public;
revoke execute on function public.enroll_to_group(uuid, uuid, date, boolean, text) from anon, public;
revoke execute on function public.activate_group_member(uuid, date)          from anon, public;
revoke execute on function public.leave_group(uuid, date, text)              from anon, public;
revoke execute on function public.transfer_group_member(uuid, uuid, date)    from anon, public;
revoke execute on function public.freeze_group_member(uuid, date, date, text) from anon, public;
revoke execute on function public.generate_group_sessions(uuid, date, date)  from anon, public;
revoke execute on function public.group_conflicts(uuid, smallint[], time, time, uuid, uuid, uuid) from anon, public;
revoke execute on function public.session_roster(uuid)                      from anon, public;
revoke execute on function public.mark_session_attendance(uuid, jsonb, text, text) from anon, public;
revoke execute on function public.cancel_session(uuid, text)                 from anon, public;
revoke execute on function public.my_group_sessions(date)                    from anon, public;
revoke execute on function public.report_group_earnings(date)               from anon, public;
revoke execute on function public.lc_overview(date)                          from anon, public;

-- Muzlatish holatini har kuni ertalab yangilash.
do $do$
begin
  perform cron.unschedule('lc-refresh-frozen')
    where exists (select 1 from cron.job where jobname = 'lc-refresh-frozen');
  perform cron.schedule('lc-refresh-frozen', '5 0 * * *',
                        'select app.refresh_frozen_members()');
end $do$;

-- Xavfsizlik invariantlari darhol tekshiriladi.
select * from app.security_invariants();
