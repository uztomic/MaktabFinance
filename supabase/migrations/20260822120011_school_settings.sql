-- =====================================================================
--  11 — MAKTAB SOZLAMALARI VA YO'QLIK TEKSHIRUVI
--
--  Ikkita bo'shliqni to'ldiradi:
--
--  1) TZ 4.6.1.3 — "Farqni ko'chirish usuli SOZLAMADA belgilanadi".
--     Demak hisoblanma xatti-harakati kodda qattiq yozilmasligi kerak.
--     `school_settings` — moliya moduli uchun parametrlar jadvali
--     (payroll_settings oylik uchun bo'lgani kabi).
--
--  2) TZ 4.5.6 — "Tizim yo'qlik kiritilmagan ish kunlarini aniqlab
--     ogohlantiradi" va TZ 4.6.1.2 — "Qayta hisoblash FAQAT yo'qlik
--     qayd etuvi to'liq kiritilgandan keyin ishga tushadi".
--
--     Muammo: `absences` jadvalida faqat KELMAGANLAR bor. Agar bir
--     kunda hamma kelgan bo'lsa, u kun bo'sh qoladi — bu "hamma keldi"
--     va "hali belgilanmagan" holatlarini bir-biridan ajratib
--     bo'lmasligini anglatadi.
--
--     Yechim: navbatchi sinfni ko'rib chiqqanini ALOHIDA qayd etadi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MAKTAB SOZLAMALARI
-- ---------------------------------------------------------------------

create table if not exists public.school_settings (
  school_id   uuid not null references public.schools(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.app_users(id) on delete set null,
  primary key (school_id, key)
);

comment on table public.school_settings is
  'Moliya moduli parametrlari. TZ 4.6.1.3 — farqni ko''chirish usuli va '
  'shunga o''xshash qarorlar kodda emas, shu yerda saqlanadi.';

select app.attach_touch_trigger('school_settings');
select app.attach_audit_trigger('school_settings');

create or replace function app.school_setting(
  p_school_id uuid,
  p_key       text,
  p_default   jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ss.value from public.school_settings ss
      where ss.school_id = p_school_id and ss.key = p_key),
    p_default);
$$;

comment on function app.school_setting(uuid, text, jsonb) is
  'Maktab sozlamasini oladi; topilmasa berilgan standart qiymat.';

-- ---------------------------------------------------------------------
-- 2. YO'QLIK TEKSHIRUVI (TZ 4.5.2, 4.5.6)
--
--  Navbatchi bitta sinfni ko'rib chiqqanda shu yerga yozuv tushadi.
--  Yozuv bor = "bu sinf shu kuni ko'rib chiqilgan".
--  Yozuv yo'q = "hali belgilanmagan" → ogohlantirish.
-- ---------------------------------------------------------------------

create table if not exists public.attendance_checks (
  school_id   uuid not null references public.schools(id)  on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  day         date not null,
  -- TZ 4.5.2 — belgilash SINFLAR KESIMIDA amalga oshiriladi.
  class_name  text not null,
  absent_count smallint not null default 0,
  -- TZ 4.5.8 — kim va qachon.
  marked_by   uuid references public.app_users(id) on delete set null,
  marked_at   timestamptz not null default now(),
  primary key (school_id, branch_id, day, class_name)
);

comment on table public.attendance_checks is
  'TZ 4.5.6 — sinf shu kuni ko''rib chiqilganini tasdiqlaydi. Bunsiz '
  '"hamma keldi" va "belgilanmagan" holatlarini ajratib bo''lmaydi.';

select app.attach_audit_trigger('attendance_checks');
select app.attach_period_guard('attendance_checks', 'day');

alter table public.attendance_checks enable row level security;

create policy attendance_checks_select on public.attendance_checks
  for select to authenticated
  using ((school_id = app.school_id() and branch_id = any (app.branch_ids()))
         or app.is_platform_admin());

create policy attendance_checks_insert on public.attendance_checks
  for insert to authenticated
  with check (school_id = app.school_id()
              and branch_id = any (app.branch_ids())
              and app.may_write('absences.mark'));

create policy attendance_checks_update on public.attendance_checks
  for update to authenticated
  using (school_id = app.school_id()
         and branch_id = any (app.branch_ids())
         and app.may_write('absences.mark'))
  with check (school_id = app.school_id()
              and branch_id = any (app.branch_ids())
              and app.may_write('absences.mark'));

grant select, insert, update on public.attendance_checks to authenticated;

alter table public.school_settings enable row level security;

create policy school_settings_select on public.school_settings
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());

create policy school_settings_insert on public.school_settings
  for insert to authenticated
  with check (school_id = app.school_id() and app.may_write('users.manage'));

create policy school_settings_update on public.school_settings
  for update to authenticated
  using (school_id = app.school_id() and app.may_write('users.manage'))
  with check (school_id = app.school_id() and app.may_write('users.manage'));

grant select, insert, update on public.school_settings to authenticated;

-- =====================================================================
--  3. YO'QLIK QAYD ETUVI TO'LIQMI?
--
--  Davrdagi har bir ish kuni × har bir sinf uchun tekshiruv yozuvi
--  bormi. `finalize_invoices` shu funksiyani chaqiradi (TZ 4.6.1.2).
-- =====================================================================

create or replace function app.absence_gaps(
  p_branch_id uuid,
  p_from      date,
  p_to        date
)
returns table (day date, class_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select id, school_id from public.branches where id = p_branch_id
  ),
  -- Faqat kunlik xizmatga yozilgan o'quvchilar bor sinflar (TZ 4.5.1).
  classes as (
    select distinct s.class_name
      from public.students s
      join public.student_services ss on ss.student_id = s.id
      join public.services sv on sv.id = ss.service_id
      join b on true
     where s.branch_id = p_branch_id
       and s.status = 'active'
       and s.deleted_at is null
       and s.class_name is not null
       and sv.billing_type = 'daily'
       and sv.is_active
       and ss.starts_on <= p_to
       and (ss.ends_on is null or ss.ends_on >= p_from)
  ),
  workdays as (
    select g.day::date as day
      from b, generate_series(p_from, p_to, interval '1 day') g(day)
     where app.working_days(b.school_id, p_branch_id, g.day::date, g.day::date) = 1
  )
  select w.day, c.class_name
    from workdays w
   cross join classes c
   where not exists (
     select 1 from public.attendance_checks ac
      where ac.branch_id = p_branch_id
        and ac.day = w.day
        and ac.class_name = c.class_name
   )
   order by w.day, c.class_name;
$$;

comment on function app.absence_gaps(uuid, date, date) is
  'TZ 4.5.6 — yo''qlik kiritilmagan ish kunlari va sinflar. Bo''sh natija '
  'qaytarsa qayd etuv to''liq (TZ 4.6.1.2).';

grant execute on function
  app.school_setting(uuid, text, jsonb),
  app.absence_gaps(uuid, date, date)
to authenticated, service_role;
