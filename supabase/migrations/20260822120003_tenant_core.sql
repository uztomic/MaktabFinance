-- =====================================================================
--  03 — IJARACHI YADROSI: FILIALLAR, FOYDALANUVCHILAR, HUQUQLAR
--
--  Bu yerda butun RLS tizimining KONTEKST FUNKSIYALARI yaratiladi.
--  Ular 10-migratsiyadagi har bir siyosat tomonidan chaqiriladi.
--
--  REKURSIYA MUAMMOSI: `app_users` ustida ham RLS bor. Agar siyosat
--  ichida oddiy funksiya `app_users` dan o'qisa, u yana o'sha siyosatni
--  chaqiradi va cheksiz halqa hosil bo'ladi. Shuning uchun barcha
--  kontekst funksiyalari `security definer` — ular RLS dan o'tmaydi.
--  (Bu naqsh Uztomic loyihasidagi `auth_store_id()` dan olingan.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FILIALLAR (TZ 4.1)
-- ---------------------------------------------------------------------

create table if not exists public.branches (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete restrict,
  name          text not null,
  address       text,
  phone         text,
  manager_name  text,
  is_active     boolean     not null default true,
  -- Bitta filialli maktabda interfeys filial tanlashni ko'rsatmaydi va
  -- shu filial standart qiymat bo'ladi (TZ 4.1 izohi).
  is_default    boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.branches is
  'O''quv binolari. TZ 5.4.2 — bitta filial bo''lsa ham standart filial '
  'yaratiladi, chunki barcha jadvalda branch_id NOT NULL.';

create index if not exists branches_school_idx on public.branches(school_id)
  where deleted_at is null;

-- Bir maktabda faqat bitta standart filial.
create unique index if not exists branches_one_default_idx
  on public.branches(school_id) where is_default and deleted_at is null;

select app.attach_touch_trigger('branches');

-- ---------------------------------------------------------------------
-- 2. FOYDALANUVCHILAR (TZ 3)
-- ---------------------------------------------------------------------

create table if not exists public.app_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  school_id     uuid not null references public.schools(id) on delete restrict,
  role          public.user_role not null,
  full_name     text not null,
  email         extensions.citext,
  phone         text,
  -- Interfeys tili (TZ 5.6.1). Profilda saqlanadi.
  lang          text not null default 'uz'
                check (lang in ('uz', 'uz-cyrl', 'ru')),
  -- TZ 4.1.2 / 3.1 izohi: "Barcha filiallarni ko'rish huquqi alohida
  -- belgilanadi". true bo'lsa user_branches jadvali o'qilmaydi.
  all_branches  boolean     not null default false,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.app_users is
  'Maktab xodimlari. Super adminlar BU YERDA EMAS — ular platform_admins '
  'jadvalida (TZ 5.4.11). role maydonini o''zgartirish platforma huquqini bermaydi.';
comment on column public.app_users.all_branches is
  'TZ 4.1.2 — barcha filiallarni ko''rish huquqi. Odatda direktor va buxgalterda.';

create index if not exists app_users_school_idx on public.app_users(school_id)
  where deleted_at is null;
create index if not exists app_users_email_idx on public.app_users(email)
  where deleted_at is null;

select app.attach_touch_trigger('app_users');

-- Foydalanuvchi ↔ filial (TZ 4.1.2)
create table if not exists public.user_branches (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  branch_id  uuid not null references public.branches(id)  on delete cascade,
  primary key (user_id, branch_id)
);

comment on table public.user_branches is
  'Foydalanuvchiga biriktirilgan filiallar. all_branches = true bo''lsa '
  'bu jadval o''qilmaydi.';

-- ---------------------------------------------------------------------
-- 3. HUQUQLAR MATRITSASI (TZ 3.1)
--
--  Huquqlar KODGA YOZILMAYDI — jadvalda saqlanadi. school_id null
--  bo'lsa platforma standarti, to'ldirilgan bo'lsa shu maktab uchun
--  moslashtirilgan qoida (maktab o'z ehtiyojiga qarab o'zgartirishi mumkin).
-- ---------------------------------------------------------------------

create table if not exists public.role_permissions (
  role        public.user_role not null,
  permission  text not null,
  school_id   uuid references public.schools(id) on delete cascade,
  allowed     boolean not null default true
);

-- Platforma standarti (school_id null) va maktab moslamasi uchun
-- alohida unikal indeks — null qiymat unique da tenglashmaydi.
create unique index if not exists role_permissions_default_idx
  on public.role_permissions(role, permission) where school_id is null;
create unique index if not exists role_permissions_school_idx
  on public.role_permissions(role, permission, school_id) where school_id is not null;

comment on table public.role_permissions is
  'TZ 3.1 huquqlar matritsasi. school_id null = platforma standarti; '
  'to''ldirilgan = shu maktab uchun moslashtirilgan qoida (standartni bekor qiladi).';

-- =====================================================================
--  4. RLS KONTEKST FUNKSIYALARI
--
--  Hammasi: security definer + stable + search_path = ''
--    · security definer — app_users ustidagi RLS rekursiyasini to'xtatadi
--    · stable           — bitta so'rov ichida bir marta hisoblanadi
--    · search_path = '' — sxema o'g'irlash hujumini yopadi
-- =====================================================================

-- Joriy foydalanuvchining maktabi. RLS ning ASOSIY filtri.
create or replace function app.school_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.school_id
    from public.app_users u
   where u.id = (select auth.uid())
     and u.is_active
     and u.deleted_at is null;
$$;

comment on function app.school_id() is
  'Joriy foydalanuvchining maktabi. Barcha RLS siyosatining asosiy filtri '
  '(TZ 5.4.3 — filtr qo''lda yozilmaydi).';

-- Joriy foydalanuvchining roli.
create or replace function app.role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select u.role
    from public.app_users u
   where u.id = (select auth.uid())
     and u.is_active
     and u.deleted_at is null;
$$;

-- Kirish huquqi bor filiallar (TZ 4.1.2).
create or replace function app.branch_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when u.all_branches then
      coalesce((
        select array_agg(b.id)
          from public.branches b
         where b.school_id = u.school_id
           and b.deleted_at is null
      ), '{}'::uuid[])
    else
      coalesce((
        select array_agg(ub.branch_id)
          from public.user_branches ub
         where ub.user_id = u.id
      ), '{}'::uuid[])
  end
  from public.app_users u
  where u.id = (select auth.uid())
    and u.is_active
    and u.deleted_at is null;
$$;

comment on function app.branch_ids() is
  'TZ 4.1.2 — foydalanuvchi ko''ra oladigan filiallar. all_branches = true '
  'bo''lsa maktabning barcha filiallari.';

-- Berilgan filial foydalanuvchiga ochiqmi?
create or replace function app.has_branch(p_branch_id uuid)
returns boolean
language sql
stable
as $$
  select p_branch_id is not null and p_branch_id = any (app.branch_ids());
$$;

-- =====================================================================
--  HUQUQ TEKSHIRUVI (TZ 3.1)
--
--  Maktab moslamasi (school_id to'ldirilgan) platforma standartini
--  bekor qiladi.
-- =====================================================================
create or replace function app.can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select rp.allowed
      from public.role_permissions rp
      join public.app_users u
        on u.id = (select auth.uid())
       and u.is_active
       and u.deleted_at is null
     where rp.role = u.role
       and rp.permission = p_permission
       and (rp.school_id is null or rp.school_id = u.school_id)
     -- Maktab moslamasi birinchi: school_id to'ldirilgani ustun turadi.
     order by rp.school_id nulls last
     limit 1
  ), false);
$$;

comment on function app.can(text) is
  'TZ 3.1 huquqlar matritsasi tekshiruvi. Maktab moslamasi platforma '
  'standartidan ustun.';

-- =====================================================================
--  MAKTAB YOZUVGA OCHIQMI? (TZ 4.13.4)
--
--  Cheklash rejimida maktab o'z ma'lumotini KO'RADI va EKSPORT QILADI,
--  lekin yangi yozuv kirita olmaydi. Ma'lumot hech qachon o'chirilmaydi
--  va bloklanmaydi.
-- =====================================================================
create or replace function app.school_is_writable()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.schools s
      join public.app_users u on u.school_id = s.id
     where u.id = (select auth.uid())
       and u.is_active
       and u.deleted_at is null
       and s.deleted_at is null
       and s.status in ('trial', 'active')
  );
$$;

comment on function app.school_is_writable() is
  'TZ 4.13.4 — to''lov kechikkanda (status = restricted) yangi yozuv '
  'to''xtatiladi, o''qish va eksport ishlashda davom etadi.';

-- =====================================================================
--  YOZUVGA UMUMIY RUXSAT
--
--  Uchta shart birga: huquq bor + maktab cheklanmagan + sessiya
--  faqat-o'qish rejimida emas. Barcha INSERT/UPDATE siyosati shu
--  yagona funksiyani chaqiradi.
-- =====================================================================
create or replace function app.may_write(p_permission text)
returns boolean
language sql
stable
as $$
  select app.can(p_permission)
     and app.school_is_writable()
     and not app.is_readonly_session();
$$;

comment on function app.may_write(text) is
  'Yozuvga ruxsatning YAGONA nuqtasi: huquq + maktab faol + sessiya '
  'o''qish rejimida emas (TZ 3.1, 4.13.4, 4.13.5.4).';

-- RPC ichida ishlatiladigan variant — ruxsat yo'q bo'lsa aniq xato beradi.
create or replace function app.assert_may_write(p_permission text)
returns void
language plpgsql
stable
as $$
begin
  if app.is_readonly_session() then
    raise exception 'Texnik yordam sessiyasi faqat o''qish rejimida (TZ 4.13.5.4)'
      using errcode = '42501';
  end if;
  if not app.school_is_writable() then
    raise exception 'Maktab cheklash rejimida: yangi yozuv kiritib bo''lmaydi (TZ 4.13.4)'
      using errcode = '42501';
  end if;
  if not app.can(p_permission) then
    raise exception 'Ruxsat yo''q: %', p_permission
      using errcode = '42501';
  end if;
end;
$$;

-- Berilgan filial joriy foydalanuvchining maktabiga tegishlimi va
-- unga ochiqmi? RPC lar shu bilan boshlanadi.
create or replace function app.assert_branch(p_branch_id uuid)
returns void
language plpgsql
stable
as $$
begin
  if not app.has_branch(p_branch_id) then
    raise exception 'Bu filialga kirish huquqi yo''q'
      using errcode = '42501';
  end if;
end;
$$;

grant execute on function
  app.school_id(), app.role(), app.branch_ids(), app.has_branch(uuid),
  app.can(text), app.school_is_writable(), app.may_write(text),
  app.assert_may_write(text), app.assert_branch(uuid),
  app.jwt_claim(text), app.is_impersonating(), app.is_readonly_session(),
  app.round_money(numeric, numeric, text), app.period_start(date)
to authenticated, service_role;
