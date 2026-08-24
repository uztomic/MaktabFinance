-- =====================================================================
--  02 — PLATFORMA DARAJASI (TZ 4.13, 5.4.11–5.4.13)
--
--  Bu qatlam Ijrochiga (Uztomic) tegishli: maktablar reyestri, tariflar,
--  obunalar, super adminlar va jurnallar.
--
--  XAVFSIZLIK ASOSI (TZ 5.4.11): super adminlar ALOHIDA jadvalda.
--  `app_users.role` maydonini o'zgartirib platforma huquqini olish
--  MUMKIN EMAS — chunki platforma huquqi u yerdan umuman o'qilmaydi.
--
--  JURNALLAR (TZ 5.4.13): `platform_log` va `impersonation_log` —
--  FAQAT QO'SHISH. UPDATE/DELETE siyosati 10-migratsiyada umuman
--  yaratilmaydi, ya'ni super admin ham o'z izini o'chira olmaydi
--  (TZ 4.13.7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MAKTABLAR REYESTRI (TZ 4.13.1)
-- ---------------------------------------------------------------------

create table if not exists public.schools (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  legal_name    text,
  tax_id        text,                      -- STIR
  address       text,
  phone         text,
  email         extensions.citext,
  status        public.school_status not null default 'trial',
  -- Barcha sana hisob-kitobi shu mintaqa bo'yicha. O'zbekiston = UTC+5.
  timezone      text        not null default 'Asia/Tashkent',
  default_lang  text        not null default 'uz'
                check (default_lang in ('uz', 'uz-cyrl', 'ru')),
  -- Oy qaysi sanada yopiladi (TZ 12.6.3). Sozlanadi.
  closing_day   smallint    not null default 5 check (closing_day between 1 and 28),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz          -- TZ 5.4.8: jismonan o'chirilmaydi
);

comment on table public.schools is
  'Ulangan maktablar (ijarachilar). Har bir jadvaldagi school_id shu yerga qaraydi.';
comment on column public.schools.status is
  'restricted = to''lov kechikkan: o''qish va eksport ishlaydi, yangi yozuv yo''q (TZ 4.13.4).';
comment on column public.schools.closing_day is
  'Oy yopiladigan sana (TZ 12.6.3). Shu sanadan keyin o''tgan davr qulflanadi.';

create index if not exists schools_status_idx on public.schools(status)
  where deleted_at is null;

select app.attach_touch_trigger('schools');

-- ---------------------------------------------------------------------
-- 2. TARIFLAR VA OBUNALAR (TZ 4.13.4)
-- ---------------------------------------------------------------------

create table if not exists public.plans (
  id             uuid primary key default gen_random_uuid(),
  code           text        not null unique,
  name           text        not null,
  monthly_price  numeric(14,2) not null default 0 check (monthly_price >= 0),
  max_students   integer,     -- null = cheklovsiz
  max_branches   integer,
  features       jsonb       not null default '{}'::jsonb,
  is_active      boolean     not null default true,
  sort_order     smallint    not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.plans is 'Platforma tariflari (TZ 4.13.4).';

create table if not exists public.school_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete restrict,
  plan_id           uuid not null references public.plans(id)   on delete restrict,
  status            public.subscription_status not null default 'trial',
  monthly_amount    numeric(14,2) not null default 0 check (monthly_amount >= 0),
  trial_ends_at     date,
  next_payment_date date,
  last_paid_at      date,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Bir maktabda bir vaqtda bitta faol obuna.
create unique index if not exists school_subscriptions_active_idx
  on public.school_subscriptions(school_id)
  where status <> 'cancelled';

comment on table public.school_subscriptions is
  'Maktab obunasi va to''lov holati. To''lov kechikkanda status → restricted, '
  'lekin ma''lumot HECH QACHON o''chirilmaydi (TZ 4.13.4).';

select app.attach_touch_trigger('school_subscriptions');

-- ---------------------------------------------------------------------
-- 3. SUPER ADMINLAR (TZ 5.4.11)
-- ---------------------------------------------------------------------

create table if not exists public.platform_admins (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null,
  email       extensions.citext,
  phone       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.platform_admins is
  'Ijrochi (platforma operatori) xodimlari. Yozuv FAQAT SQL orqali qo''lda '
  'qo''shiladi — INSERT siyosati ataylab yaratilmaydi. Maktab xodimi hech '
  'qanday yo''l bilan bu yerga tusha olmaydi (TZ 5.4.11).';

-- =====================================================================
--  YAGONA MARKAZLASHGAN RLS CHETLAB O'TISH NUQTASI (TZ 5.4.4)
--
--  Bu shart har bir jadval siyosatiga qo'lda ko'chirilmaydi — barcha
--  siyosat shu funksiyani chaqiradi. Kelajakda platforma huquqi
--  mantiqi o'zgarsa, faqat shu yer o'zgaradi.
--
--  `security definer` — platform_admins ustidagi RLS o'z-o'ziga
--  rekursiya qilmasligi uchun.
-- =====================================================================
create or replace function app.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
     where id = (select auth.uid()) and is_active
  );
$$;

comment on function app.is_platform_admin() is
  'TZ 5.4.4 — RLS ni chetlab o''tishning YAGONA nuqtasi.';

revoke all on function app.is_platform_admin() from public;
grant execute on function app.is_platform_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. PLATFORMA JURNALI — faqat qo'shish (TZ 5.4.13)
-- ---------------------------------------------------------------------

create table if not exists public.platform_log (
  id         bigint generated always as identity primary key,
  admin_id   uuid references public.platform_admins(id) on delete set null,
  action     text not null,
  entity     text,
  entity_id  text,
  school_id  uuid references public.schools(id) on delete set null,
  before     jsonb,
  after      jsonb,
  at         timestamptz not null default now()
);

comment on table public.platform_log is
  'Super admin amallari. FAQAT QO''SHISH — tahrirlash va o''chirish '
  'siyosatlari umuman yaratilmaydi (TZ 4.13.7, 5.4.13).';

create index if not exists platform_log_school_idx on public.platform_log(school_id, at desc);
create index if not exists platform_log_admin_idx  on public.platform_log(admin_id, at desc);

-- ---------------------------------------------------------------------
-- 5. TEXNIK YORDAM UCHUN KIRISH (TZ 4.13.5)
-- ---------------------------------------------------------------------

create table if not exists public.impersonation_sessions (
  id              uuid primary key default gen_random_uuid(),
  admin_id        uuid not null references public.platform_admins(id) on delete restrict,
  school_id       uuid not null references public.schools(id)         on delete restrict,
  target_user_id  uuid not null references auth.users(id)             on delete cascade,
  mode            public.impersonation_mode not null default 'read',
  -- Yozish rejimiga o'tish uchun sabab SHART (TZ 4.13.5.4).
  reason          text,
  started_at      timestamptz not null default now(),
  -- TZ 4.13.5.5 — 60 daqiqadan keyin avtomatik yakunlanadi.
  expires_at      timestamptz not null default now() + interval '60 minutes',
  ended_at        timestamptz,
  constraint impersonation_write_needs_reason
    check (mode = 'read' or (reason is not null and length(btrim(reason)) >= 10))
);

comment on table public.impersonation_sessions is
  'Faol texnik yordam sessiyalari. JWT ga claim shu jadvaldan qo''yiladi.';
comment on constraint impersonation_write_needs_reason on public.impersonation_sessions is
  'TZ 4.13.5.4 — yozish rejimi uchun kamida 10 belgilik sabab majburiy.';

create index if not exists impersonation_sessions_active_idx
  on public.impersonation_sessions(target_user_id)
  where ended_at is null;

create table if not exists public.impersonation_log (
  id          bigint generated always as identity primary key,
  session_id  uuid references public.impersonation_sessions(id) on delete set null,
  admin_id    uuid not null,
  school_id   uuid not null,
  target_user_id uuid,
  mode        public.impersonation_mode not null,
  action      text not null,
  detail      jsonb,
  at          timestamptz not null default now()
);

comment on table public.impersonation_log is
  'TZ 4.13.5.2 — har bir kirish qayd etiladi va MAKTAB DIREKTORIGA HAM '
  'ko''rinadi. FAQAT QO''SHISH (TZ 5.4.13).';

create index if not exists impersonation_log_school_idx
  on public.impersonation_log(school_id, at desc);

-- =====================================================================
--  6. IMPERSONATION KONTEKSTI — JWT claim'laridan o'qiladi
--
--  Claim'lar `public.custom_access_token_hook` orqali tokenga
--  qo'yiladi. Ular TOKEN ICHIDA imzolangan — mijoz ularni o'zgartira
--  olmaydi (TZ 5.4.12).
-- =====================================================================

create or replace function app.jwt_claim(p_key text)
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb ->> p_key,
      ''
    ), '');
$$;

comment on function app.jwt_claim(text) is
  'JWT dan bitta claim ni o''qiydi. Claim yo''q bo''lsa null.';

-- Sessiya texnik yordam sessiyasimi?
create or replace function app.is_impersonating()
returns boolean
language sql
stable
as $$
  select app.jwt_claim('imp_mode') is not null;
$$;

-- =====================================================================
--  FAQAT O'QISH REJIMI (TZ 4.13.5.4)
--
--  Bu funksiya barcha yozuv siyosatida va har bir moliyaviy RPC ichida
--  chaqiriladi. `read` rejimidagi super admin hech narsa yoza olmaydi.
--  Muddati o'tgan sessiya ham yozuvga ruxsat bermaydi (TZ 4.13.5.5).
-- =====================================================================
create or replace function app.is_readonly_session()
returns boolean
language sql
stable
as $$
  select case
    -- Oddiy maktab foydalanuvchisi — cheklov yo'q.
    when app.jwt_claim('imp_mode') is null then false
    -- Texnik yordam sessiyasi: faqat `write` va muddati o'tmagan bo'lsa yozadi.
    when app.jwt_claim('imp_mode') = 'write'
     and coalesce(app.jwt_claim('imp_exp')::timestamptz, '-infinity') > now()
      then false
    else true
  end;
$$;

comment on function app.is_readonly_session() is
  'TZ 4.13.5.4/4.13.5.5 — texnik yordam sessiyasi o''qish rejimida yoki '
  'muddati o''tgan bo''lsa TRUE. Barcha yozuv siyosati buni tekshiradi.';

-- =====================================================================
--  7. CUSTOM ACCESS TOKEN HOOK
--
--  Supabase Auth token berayotganda shu funksiyani chaqiradi va
--  qaytgan claim'larni JWT ga qo'yadi. Shu tufayli impersonation
--  rejimi tokenning o'zida imzolangan bo'ladi (TZ 5.4.12).
--
--  Hook Supabase sozlamasida yoqiladi (scripts/setup-auth.mjs).
-- =====================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_session public.impersonation_sessions%rowtype;
begin
  select * into v_session
    from public.impersonation_sessions
   where target_user_id = v_user_id
     and ended_at is null
     and expires_at > now()
   order by started_at desc
   limit 1;

  if found then
    v_claims := v_claims
      || jsonb_build_object(
           'imp_mode',    v_session.mode::text,
           'imp_admin',   v_session.admin_id::text,
           'imp_session', v_session.id::text,
           'imp_exp',     to_char(v_session.expires_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
         );
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase Auth hook: faol texnik yordam sessiyasi bo''lsa JWT ga '
  'imp_mode / imp_admin / imp_exp claim''larini qo''yadi (TZ 5.4.12).';

-- Hook ni faqat Auth xizmati chaqiradi. Boshqa hech kim emas.
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Hook impersonation_sessions ni o'qiy olishi kerak.
grant usage on schema public to supabase_auth_admin;
grant select on public.impersonation_sessions to supabase_auth_admin;
