-- =====================================================================
--  10 — ROW LEVEL SECURITY (TZ 5.4.3, 5.4.4, 5.5.7)
--
--  "RLS birinchi jadvaldan yoqiladi. maktab_id va filial_id filtri
--   QO'LDA YOZILMAYDI, RLS siyosati orqali majburiy qo'llanadi."
--
--  Bu migratsiya butun tizimning xavfsizlik chegarasi. U to'rt guruhga
--  bo'linadi va siyosatlar SIKL bilan generatsiya qilinadi — har bir
--  jadvalga qo'lda ko'chirilmaydi (TZ 5.4.4 aynan shuni talab qiladi).
--
--    A guruh — ma'lumotnoma jadvallar: to'liq CRUD (DELETE dan tashqari)
--    B guruh — moliyaviy jadvallar: mijozga FAQAT O'QISH.
--              Yozuv faqat SECURITY DEFINER RPC orqali (TZ 5.4.6).
--    C guruh — jurnallar: faqat o'qish. UPDATE/DELETE siyosati
--              UMUMAN YARATILMAYDI (TZ 5.4.13, 4.13.7).
--    D guruh — platforma jadvallari.
--
--  DELETE HAQIDA (TZ 5.4.8): "Yozuvlar jismonan o'chirilmaydi."
--  Shuning uchun hech bir jadvalda DELETE siyosati yo'q va DELETE
--  huquqi `authenticated` roldan butunlay olib tashlanadi.
--
--  PLATFORMA ADMINI: faqat O'QISH huquqiga ega (texnik yordam uchun).
--  Yozish faqat impersonation orqali — u esa ikkita jurnalga tushadi
--  (TZ 4.13.5.2, 4.13.5.6). Shu tufayli "jurnalsiz o'zgartirish"
--  texnik jihatdan imkonsiz (TZ 4.13.7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. BAZAVIY HUQUQLAR
--
--  Supabase standart holatda public sxemadagi barcha jadvalga anon va
--  authenticated uchun TO'LIQ huquq beradi. Buni avval OLIB TASHLAYMIZ,
--  keyin faqat kerakligini qaytaramiz.
-- ---------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

-- Kelajakda yaratiladigan jadvallar ham himoyalangan bo'lsin.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

-- identity ustunlar uchun ketma-ketlikdan foydalanish kerak.
grant usage on all sequences in schema public to authenticated;

-- =====================================================================
--  A GURUH — MA'LUMOTNOMA JADVALLAR
--
--  SELECT: o'z maktabi + ochiq filiallar
--  INSERT/UPDATE: yuqoridagilar + huquq + maktab faol + sessiya
--                 o'qish rejimida emas (app.may_write)
--  DELETE: siyosat yo'q (TZ 5.4.8)
-- =====================================================================

do $do$
declare
  r record;
  v_scope text;
begin
  for r in
    select * from (values
      -- jadval,             huquq kaliti,        filial ustuni bormi
      --
      -- IZOH: user_branches, student_parents va teacher_branches bu
      -- ro'yxatda YO'Q — ularda `school_id` ustuni yo'q (bog'lovchi
      -- jadvallar). Ular quyida ota jadvali orqali alohida himoyalanadi.
      ('branches',           'users.manage',      false),
      ('app_users',          'users.manage',      false),
      ('students',           'students.manage',   true ),
      ('parents',            'students.manage',   false),
      ('contracts',          'students.manage',   false),
      ('discount_types',     'services.manage',   false),
      ('services',           'services.manage',   true ),
      ('service_prices',     'services.manage',   false),
      ('student_services',   'services.manage',   false),
      ('absence_reasons',    'services.manage',   false),
      ('calendar_days',      'services.manage',   false),
      ('absences',           'absences.mark',     true ),
      ('expense_categories', 'expenses.create',   false),
      ('expenses',           'expenses.create',   true ),
      ('teachers',           'teachers.manage',   false),
      ('lessons',            'lessons.manage',    true ),
      ('payroll_settings',   'payroll.manage',    false),
      ('leads',              'leads.manage',      true )
    ) as v(tbl, perm, has_branch)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    -- Filial ustuni bo'lsa — filial bo'yicha ham cheklanadi (TZ 4.1.2).
    v_scope := case when r.has_branch
      then 'school_id = app.school_id() and branch_id = any (app.branch_ids())'
      else 'school_id = app.school_id()'
    end;

    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (%2$s or app.is_platform_admin())
    $f$, r.tbl, v_scope);

    execute format('drop policy if exists %1$s_insert on public.%1$I', r.tbl);
    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (%2$s and app.may_write(%3$L))
    $f$, r.tbl, v_scope, r.perm);

    execute format('drop policy if exists %1$s_update on public.%1$I', r.tbl);
    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (%2$s and app.may_write(%3$L))
        with check (%2$s and app.may_write(%3$L))
    $f$, r.tbl, v_scope, r.perm);

    -- TZ 5.4.8 — DELETE siyosati ataylab yaratilmaydi.
    execute format('grant select, insert, update on public.%I to authenticated', r.tbl);
  end loop;
end $do$;

-- =====================================================================
--  BOG'LOVCHI JADVALLAR
--
--  Bularda `school_id` ustuni yo'q. Ular OTA JADVALI orqali
--  himoyalanadi: yozuv ko'rinadi faqat ota yozuvi ko'rinsa.
--  Bu ijarachilar ajratilishini bir xilda kafolatlaydi.
-- =====================================================================

alter table public.user_branches    enable row level security;
alter table public.student_parents  enable row level security;
alter table public.teacher_branches enable row level security;

grant select, insert, update on public.user_branches    to authenticated;
grant select, insert, update on public.student_parents  to authenticated;
grant select, insert, update on public.teacher_branches to authenticated;

create policy user_branches_select on public.user_branches
  for select to authenticated
  using (
    exists (select 1 from public.app_users u
             where u.id = user_branches.user_id
               and u.school_id = app.school_id())
    or app.is_platform_admin()
  );

create policy user_branches_insert on public.user_branches
  for insert to authenticated
  with check (
    app.may_write('users.manage')
    and exists (select 1 from public.app_users u
                 where u.id = user_branches.user_id
                   and u.school_id = app.school_id())
  );

create policy student_parents_select on public.student_parents
  for select to authenticated
  using (
    exists (select 1 from public.students s
             where s.id = student_parents.student_id
               and s.school_id = app.school_id()
               and s.branch_id = any (app.branch_ids()))
    or app.is_platform_admin()
  );

create policy student_parents_insert on public.student_parents
  for insert to authenticated
  with check (
    app.may_write('students.manage')
    and exists (select 1 from public.students s
                 where s.id = student_parents.student_id
                   and s.school_id = app.school_id()
                   and s.branch_id = any (app.branch_ids()))
  );

create policy student_parents_update on public.student_parents
  for update to authenticated
  using (
    app.may_write('students.manage')
    and exists (select 1 from public.students s
                 where s.id = student_parents.student_id
                   and s.school_id = app.school_id())
  );

create policy teacher_branches_select on public.teacher_branches
  for select to authenticated
  using (
    exists (select 1 from public.teachers t
             where t.id = teacher_branches.teacher_id
               and t.school_id = app.school_id())
    or app.is_platform_admin()
  );

create policy teacher_branches_insert on public.teacher_branches
  for insert to authenticated
  with check (
    app.may_write('teachers.manage')
    and exists (select 1 from public.teachers t
                 where t.id = teacher_branches.teacher_id
                   and t.school_id = app.school_id())
  );

-- =====================================================================
--  O'QITUVCHI O'Z MA'LUMOTINI KO'RADI (TZ 3.1 — "O'z yuklamasini ko'rish")
--
--  O'qituvchiga `teachers.manage` huquqi yo'q, shuning uchun yuqoridagi
--  siyosat unga hech narsa ko'rsatmaydi. Bu qo'shimcha siyosat unga
--  FAQAT O'ZINING yozuvini ochadi.
-- =====================================================================

create policy teachers_select_own on public.teachers
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy lessons_select_own on public.lessons
  for select to authenticated
  using (
    exists (select 1 from public.teachers t
             where t.id = lessons.teacher_id
               and t.user_id = (select auth.uid()))
  );

-- =====================================================================
--  B GURUH — MOLIYAVIY JADVALLAR (TZ 5.4.6)
--
--  Mijozga FAQAT O'QISH. INSERT/UPDATE siyosati umuman yaratilmaydi,
--  shuning uchun PostgREST orqali hisoblanma yoki to'lov yozib
--  bo'lmaydi. Yozuv faqat 11-migratsiyadagi SECURITY DEFINER
--  funksiyalar orqali — ular ichida huquq tekshiruvi, davr qulfi
--  tekshiruvi va audit yozuvi bor.
-- =====================================================================

do $do$
declare
  r record;
  v_scope text;
begin
  for r in
    select * from (values
      ('invoices',            'reports.view', true ),
      ('invoice_lines',       'reports.view', false),
      ('payments',            'reports.view', true ),
      ('cash_receipts',       'reports.view', true ),
      ('bank_statements',     'reports.view', true ),
      ('bank_statement_rows', 'reports.view', false),
      ('payment_proofs',      'reports.view', true ),
      ('payroll_runs',        'payroll.view', false),
      ('payroll_lines',       'payroll.view', false),
      ('closed_periods',      'reports.view', false)
    ) as v(tbl, perm, has_branch)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);

    v_scope := case when r.has_branch
      then 'school_id = app.school_id() and branch_id = any (app.branch_ids())'
      else 'school_id = app.school_id()'
    end;

    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using ((%2$s and app.can(%3$L)) or app.is_platform_admin())
    $f$, r.tbl, v_scope, r.perm);

    -- INSERT/UPDATE/DELETE siyosati YO'Q — bu ataylab (TZ 5.4.6).
    execute format('grant select on public.%I to authenticated', r.tbl);
  end loop;
end $do$;

-- O'qituvchi o'z oyligini ko'radi (TZ 3.1, 4.11.7 qaydnoma).
create policy payroll_runs_select_own on public.payroll_runs
  for select to authenticated
  using (
    exists (select 1 from public.teachers t
             where t.id = payroll_runs.teacher_id
               and t.user_id = (select auth.uid()))
  );

create policy payroll_lines_select_own on public.payroll_lines
  for select to authenticated
  using (
    exists (select 1 from public.payroll_runs r
              join public.teachers t on t.id = r.teacher_id
             where r.id = payroll_lines.payroll_run_id
               and t.user_id = (select auth.uid()))
  );

-- =====================================================================
--  C GURUH — JURNALLAR (TZ 5.4.13)
--
--  Faqat o'qish. Yozuv triggerlar (SECURITY DEFINER) orqali tushadi.
--  UPDATE va DELETE siyosati UMUMAN YARATILMAYDI — shuning uchun
--  hech kim, hatto super admin ham o'z izini o'chira olmaydi (TZ 4.13.7).
-- =====================================================================

do $do$
declare
  r record;
begin
  for r in
    select * from (values
      ('audit_log',          'reports.view'),
      ('lead_events',        'leads.manage'),
      ('contract_versions',  'students.manage')
    ) as v(tbl, perm)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('drop policy if exists %1$s_select on public.%1$I', r.tbl);
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using ((school_id = app.school_id() and app.can(%2$L))
               or app.is_platform_admin())
    $f$, r.tbl, r.perm);
    execute format('grant select on public.%I to authenticated', r.tbl);
  end loop;
end $do$;

-- =====================================================================
--  D GURUH — PLATFORMA JADVALLARI
-- =====================================================================

-- --- schools: a'zolar o'z maktabini ko'radi -------------------------
alter table public.schools enable row level security;

drop policy if exists schools_select on public.schools;
create policy schools_select on public.schools
  for select to authenticated
  using (id = app.school_id() or app.is_platform_admin());

-- Direktor maktab sozlamalarini o'zgartira oladi (til, oy yopish sanasi).
-- Holatni (status) o'zgartira OLMAYDI — u platforma qarori.
drop policy if exists schools_update on public.schools;
create policy schools_update on public.schools
  for update to authenticated
  using (id = app.school_id() and app.may_write('users.manage'))
  with check (id = app.school_id() and app.may_write('users.manage'));

grant select, update on public.schools to authenticated;

-- Maktab foydalanuvchisi `status` ni o'zgartira olmasligini kafolatlaydi.
create or replace function app.guard_school_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not app.is_platform_admin() then
    raise exception 'Maktab holatini faqat platforma operatori o''zgartiradi'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_schools_guard_status on public.schools;
create trigger trg_schools_guard_status
  before update on public.schools
  for each row execute function app.guard_school_status();

-- --- platform_admins: faqat platforma adminiga ko'rinadi ------------
alter table public.platform_admins enable row level security;

drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select to authenticated
  using (app.is_platform_admin());

-- TZ 5.4.11 — INSERT/UPDATE siyosati YO'Q. Yangi platforma admini
-- faqat SQL orqali qo'lda qo'shiladi. Ilova orqali qo'shish yo'li
-- ataylab mavjud emas.
grant select on public.platform_admins to authenticated;

-- --- plans / school_subscriptions -----------------------------------
alter table public.plans enable row level security;
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (true);
grant select on public.plans to authenticated;

alter table public.school_subscriptions enable row level security;
drop policy if exists school_subscriptions_select on public.school_subscriptions;
create policy school_subscriptions_select on public.school_subscriptions
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());
grant select on public.school_subscriptions to authenticated;

-- --- role_permissions -----------------------------------------------
alter table public.role_permissions enable row level security;
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (school_id is null or school_id = app.school_id() or app.is_platform_admin());
grant select on public.role_permissions to authenticated;

-- --- translations: hamma o'qiydi -------------------------------------
alter table public.translations enable row level security;
drop policy if exists translations_select on public.translations;
create policy translations_select on public.translations
  for select to authenticated
  using (school_id is null or school_id = app.school_id());
grant select on public.translations to authenticated;

-- =====================================================================
--  IMPERSONATION JURNALI — DIREKTOR HAM KO'RADI (TZ 4.13.5.2)
--
--  "Har bir kirish audit jurnalida qayd etiladi va MAKTAB DIREKTORIGA
--   HAM KO'RINADI." Bu ataylab: mijozdan yashirilmaydi.
-- =====================================================================

alter table public.impersonation_sessions enable row level security;
drop policy if exists impersonation_sessions_select on public.impersonation_sessions;
create policy impersonation_sessions_select on public.impersonation_sessions
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());
grant select on public.impersonation_sessions to authenticated;

alter table public.impersonation_log enable row level security;
drop policy if exists impersonation_log_select on public.impersonation_log;
create policy impersonation_log_select on public.impersonation_log
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());
grant select on public.impersonation_log to authenticated;

-- Platforma jurnali maktabga ko'rinmaydi.
alter table public.platform_log enable row level security;
drop policy if exists platform_log_select on public.platform_log;
create policy platform_log_select on public.platform_log
  for select to authenticated
  using (app.is_platform_admin());
grant select on public.platform_log to authenticated;

-- =====================================================================
--  MIJOZGA UMUMAN OCHILMAYDIGAN JADVALLAR
--
--  RLS yoqiladi, lekin BIRORTA HAM siyosat yaratilmaydi va grant
--  berilmaydi. Faqat service_role (Edge Functions) va SECURITY DEFINER
--  funksiyalar ishlaydi.
-- =====================================================================

do $do$
declare t text;
begin
  foreach t in array array[
    'counters',            -- ketma-ket raqamlar — faqat app.next_counter
    'telegram_updates',    -- bot deduplikatsiyasi
    'telegram_sessions',   -- bot suhbat holati
    'message_queue'        -- xabar navbati — faqat queue-sender
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $do$;

-- Xabar navbatini direktor JURNAL sifatida ko'radi (TZ 4.9.4 —
-- "yuborilgan barcha xabarlar jurnalda saqlanadi, yetkazilmaganlari
-- ko'rinadi"). Faqat o'qish.
drop policy if exists message_queue_select on public.message_queue;
create policy message_queue_select on public.message_queue
  for select to authenticated
  using ((school_id = app.school_id() and app.can('reports.view'))
         or app.is_platform_admin());
grant select on public.message_queue to authenticated;

-- =====================================================================
--  YAKUNIY TEKSHIRUV
--
--  public sxemasidagi HAR BIR jadvalda RLS yoqilganini tasdiqlaydi.
--  Bittasi ham qolib ketsa migratsiya YIQILADI — bu ataylab
--  (TZ 5.4.3 "RLS birinchi jadvaldan yoqiladi").
-- =====================================================================

do $do$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ')
    into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if v_missing is not null then
    raise exception 'RLS YOQILMAGAN JADVALLAR: %', v_missing;
  end if;

  raise notice 'RLS: public sxemasidagi barcha jadvalda yoqilgan.';
end $do$;

-- =====================================================================
--  MOLIYAVIY ANIQLIK TEKSHIRUVI (TZ 5.4.5)
--
--  float / double precision turidagi ustun topilsa migratsiya yiqiladi.
-- =====================================================================

do $do$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s', c.table_name, c.column_name), ', ')
    into v_bad
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.data_type in ('real', 'double precision');

  if v_bad is not null then
    raise exception 'TZ 5.4.5 BUZILDI — float ustunlar: %', v_bad;
  end if;

  raise notice 'Moliyaviy aniqlik: float/double ustun yo''q.';
end $do$;
