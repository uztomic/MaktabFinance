-- =====================================================================
--  04 — O'QUVCHILAR, OTA-ONALAR VA SHARTNOMALAR (TZ 4.3)
--
--  Asosiy qoidalar:
--    · TZ 4.3.1 — har bir o'quvchiga NOYOB to'lov kodi. Bank vypiskasi
--      shu kod bo'yicha avtomatik biriktiriladi (TZ 4.7.2.2).
--    · TZ 4.3.4 — o'quvchi chiqarilganda ma'lumot O'CHIRILMAYDI,
--      faqat holati o'zgaradi va moliyaviy tarix saqlanadi.
--    · TZ 4.3.5 — shartnoma o'zgarganda eski versiya arxivda qoladi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. UMUMIY HISOBLAGICHLAR
--
--  To'lov kodi (TZ 4.3.1) va kassa kvitansiyasi raqami (TZ 4.7.1.5)
--  uchun. Oddiy `sequence` yaramaydi, chunki hisob har bir maktab va
--  filial uchun ALOHIDA va UZLUKSIZ bo'lishi kerak.
-- ---------------------------------------------------------------------

create table if not exists public.counters (
  school_id  uuid not null references public.schools(id) on delete cascade,
  -- Filial hisoblagichi uchun branch_id, maktab hisoblagichi uchun school_id.
  scope_id   uuid not null,
  kind       text not null,
  value      bigint not null default 0,
  primary key (school_id, scope_id, kind)
);

comment on table public.counters is
  'Uzluksiz ketma-ket raqamlar: to''lov kodi (TZ 4.3.1) va kvitansiya '
  'raqami (TZ 4.7.1.5). FOR UPDATE bilan olinadi — parallel yozuvda '
  'raqam takrorlanmaydi va uzilmaydi.';

-- Keyingi raqamni ATOMAR oladi. Qator qulflanadi, shuning uchun ikkita
-- buxgalter bir vaqtda to'lov kiritsa ham raqamlar takrorlanmaydi.
create or replace function app.next_counter(
  p_school_id uuid,
  p_scope_id  uuid,
  p_kind      text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value bigint;
begin
  insert into public.counters (school_id, scope_id, kind, value)
  values (p_school_id, p_scope_id, p_kind, 1)
  on conflict (school_id, scope_id, kind)
  do update set value = public.counters.value + 1
  returning value into v_value;

  return v_value;
end;
$$;

comment on function app.next_counter(uuid, uuid, text) is
  'Ketma-ket raqamni atomar oladi. ON CONFLICT DO UPDATE qatorni '
  'qulflaydi — parallel chaqiruvda raqam takrorlanmaydi.';

-- ---------------------------------------------------------------------
-- 2. O'QUVCHILAR (TZ 4.3)
-- ---------------------------------------------------------------------

create table if not exists public.students (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)  on delete restrict,
  branch_id     uuid not null references public.branches(id) on delete restrict,
  full_name     text not null,
  birth_date    date,
  -- Sinf: ko'rsatiladigan nomi ("5-A") va saralash uchun raqami (5).
  class_name    text,
  grade_level   smallint check (grade_level between 0 and 12),
  status        public.student_status not null default 'active',
  -- TZ 4.3.1 — noyob to'lov kodi, shartnomada ko'rsatiladi.
  payment_code  text not null,
  enrolled_on   date not null default current_date,
  left_on       date,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.students is
  'O''quvchilar. TZ 4.3.4 — chiqarilganda yozuv o''chirilmaydi, '
  'status = expelled bo''ladi va moliyaviy tarix saqlanadi.';
comment on column public.students.payment_code is
  'TZ 4.3.1 — noyob to''lov kodi (MK-1042). Bank vypiskasi shu kod '
  'bo''yicha avtomatik biriktiriladi (TZ 4.7.2.2).';
comment on column public.students.status is
  'academic_leave holatida hisoblanma SHAKLLANTIRILMAYDI (TZ 4.3.6).';

-- To'lov kodi maktab ichida noyob. Vypiska biriktirishda shu bo'yicha qidiriladi.
create unique index if not exists students_payment_code_idx
  on public.students(school_id, upper(payment_code));

create index if not exists students_branch_idx on public.students(branch_id, status)
  where deleted_at is null;
create index if not exists students_class_idx  on public.students(school_id, class_name)
  where deleted_at is null;
create index if not exists students_name_idx
  on public.students using gin (to_tsvector('simple', full_name));

select app.attach_touch_trigger('students');

-- To'lov kodini avtomatik beradi (TZ 4.3.1). Buxgalter qo'lda kiritmaydi.
create or replace function app.assign_payment_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
begin
  if new.payment_code is not null and btrim(new.payment_code) <> '' then
    return new; -- Qo'lda berilgan (ma'lumot ko'chirishda) — tegmaymiz.
  end if;

  -- Prefiks maktab nomining birinchi harflaridan: "Maktab Nur" → "MN".
  select coalesce(
           nullif(string_agg(upper(left(word, 1)), '' order by ord), ''),
           'MK')
    into v_prefix
    from (
      select word, ord
        from unnest(regexp_split_to_array(
               (select name from public.schools where id = new.school_id),
               '\s+')) with ordinality as t(word, ord)
       where word ~ '^[[:alpha:]]'
       limit 2
    ) w;

  new.payment_code := v_prefix || '-' ||
    lpad(app.next_counter(new.school_id, new.school_id, 'payment_code')::text, 4, '0');

  return new;
end;
$$;

drop trigger if exists trg_students_payment_code on public.students;
create trigger trg_students_payment_code
  before insert on public.students
  for each row execute function app.assign_payment_code();

-- ---------------------------------------------------------------------
-- 3. OTA-ONALAR (TZ 4.3, 4.9)
-- ---------------------------------------------------------------------

create table if not exists public.parents (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  full_name    text not null,
  -- Telefon — Telegram botga ulanishning YAGONA kaliti (TZ 4.9.1).
  phone        text not null,
  telegram_id  bigint,
  -- TZ 5.6.2 — ota-ona tili alohida saqlanadi va bot xabarlariga qo'llaniladi.
  lang         text not null default 'uz'
               check (lang in ('uz', 'uz-cyrl', 'ru')),
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.parents is
  'Ota-onalar. Telegram bot telefon raqami orqali bog''lanadi (TZ 4.9.1).';
comment on column public.parents.telegram_id is
  'Telegram chat id. Bot faqat SHU maydon orqali ota-onani aniqlaydi — '
  'xabardagi ma''lumotga ishonmaydi (TZ 5.4.15).';

-- Telefon maktab ichida noyob — bir ota-ona ikki marta kiritilmasin.
create unique index if not exists parents_phone_idx
  on public.parents(school_id, phone) where deleted_at is null;

-- Telegram id bo'yicha qidiruv — bot har bir so'rovda shundan boshlaydi.
create unique index if not exists parents_telegram_idx
  on public.parents(telegram_id) where telegram_id is not null and deleted_at is null;

select app.attach_touch_trigger('parents');

-- Bir o'quvchiga bir nechta ota-ona (TZ 4.3.2), bir ota-onaga bir nechta
-- farzand (TZ 4.9.2) — ko'pdan-ko'pga bog'lanish.
create table if not exists public.student_parents (
  student_id  uuid not null references public.students(id) on delete cascade,
  parent_id   uuid not null references public.parents(id)  on delete cascade,
  relation    text,      -- ota / ona / vasiy
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (student_id, parent_id)
);

comment on table public.student_parents is
  'TZ 4.3.2 va 4.9.2 — ko''pdan-ko''pga. Bot ota-onaga FAQAT shu jadval '
  'orqali bog''langan o''quvchilarni ko''rsatadi (TZ 5.4.15).';

create index if not exists student_parents_parent_idx
  on public.student_parents(parent_id);

-- ---------------------------------------------------------------------
-- 4. CHEGIRMA TURLARI (TZ 12.2.3, 12.2.4)
--
--  Turlar va foiz KODGA YOZILMAYDI — maktab o'zi sozlaydi.
-- ---------------------------------------------------------------------

create table if not exists public.discount_types (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  code        text not null,
  name        text not null,
  kind        public.discount_kind not null default 'percent',
  value       numeric(14,2) not null default 0 check (value >= 0),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (school_id, code)
);

comment on table public.discount_types is
  'TZ 12.2.3/12.2.4 — chegirma turlari (2-farzand, xodim farzandi, '
  'imtiyozli toifa). Foiz yoki qat''iy summa. Maktab o''zi qo''shadi.';

select app.attach_touch_trigger('discount_types');

-- ---------------------------------------------------------------------
-- 5. SHARTNOMALAR (TZ 4.3)
-- ---------------------------------------------------------------------

create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id)  on delete restrict,
  student_id        uuid not null references public.students(id) on delete restrict,
  number            text not null,
  signed_on         date not null default current_date,
  starts_on         date not null,
  ends_on           date,
  -- TZ 4.3 — o'qish uchun oylik summa.
  tuition_amount    numeric(14,2) not null default 0 check (tuition_amount >= 0),
  discount_type_id  uuid references public.discount_types(id) on delete set null,
  -- Turdagi qiymatni bekor qiluvchi qo'lda kiritilgan chegirma.
  discount_kind     public.discount_kind,
  discount_value    numeric(14,2) check (discount_value is null or discount_value >= 0),
  -- TZ 12.2.2 — to'lov muddati oyning nechanchi sanasi.
  due_day           smallint not null default 10 check (due_day between 1 and 28),
  -- TZ 12.2.1 — to'lov necha oyga taqsimlanadi (9 yoki 12). Yozgi ta'til
  -- oylarida hisoblanma shakllantirilishini shu belgilaydi.
  billing_months    smallint not null default 12 check (billing_months between 1 and 12),
  is_active         boolean     not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contracts_period_valid check (ends_on is null or ends_on >= starts_on)
);

comment on table public.contracts is
  'Ota-ona bilan shartnoma. Hisoblanma summasi shu yerdan olinadi.';
comment on column public.contracts.billing_months is
  'TZ 12.2.1 — to''lov 9 oygami yoki 12 oyga taqsimlanadi. Yozgi ta''til '
  'oylarida hisoblanma bo''lish-bo''lmasligini shu maydon hal qiladi.';
comment on column public.contracts.discount_kind is
  'To''ldirilgan bo''lsa discount_type dagi qiymatni bekor qiladi (qo''lda chegirma).';

-- Bir o'quvchida bir vaqtda bitta faol shartnoma.
create unique index if not exists contracts_one_active_idx
  on public.contracts(student_id) where is_active;
create index if not exists contracts_student_idx on public.contracts(student_id);
create unique index if not exists contracts_number_idx
  on public.contracts(school_id, number);

select app.attach_touch_trigger('contracts');

-- ---------------------------------------------------------------------
-- 6. SHARTNOMA VERSIYALARI (TZ 4.3.5)
--
--  Shartnoma o'zgarganda eski holat arxivga tushadi. Nizoli holatda
--  qaysi sanada qanday summa amal qilgani isbotlanadi.
-- ---------------------------------------------------------------------

create table if not exists public.contract_versions (
  id           bigint generated always as identity primary key,
  contract_id  uuid not null references public.contracts(id) on delete cascade,
  school_id    uuid not null,
  snapshot     jsonb not null,
  changed_by   uuid references public.app_users(id) on delete set null,
  changed_at   timestamptz not null default now()
);

comment on table public.contract_versions is
  'TZ 4.3.5 — shartnomaning har bir eski versiyasi. Faqat qo''shiladi.';

create index if not exists contract_versions_contract_idx
  on public.contract_versions(contract_id, changed_at desc);

create or replace function app.archive_contract_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Faqat mazmunli o'zgarishda arxivlaymiz — updated_at o'zgarishi kifoya emas.
  if to_jsonb(old) - 'updated_at' = to_jsonb(new) - 'updated_at' then
    return new;
  end if;

  insert into public.contract_versions (contract_id, school_id, snapshot, changed_by)
  values (old.id, old.school_id, to_jsonb(old), (select auth.uid()));

  return new;
end;
$$;

drop trigger if exists trg_contracts_version on public.contracts;
create trigger trg_contracts_version
  before update on public.contracts
  for each row execute function app.archive_contract_version();

-- ---------------------------------------------------------------------
-- 7. AMALDAGI CHEGIRMANI HISOBLASH
--
--  Shartnomadagi qo'lda kiritilgan chegirma > chegirma turi > yo'q.
--  Hisoblanma va hisobotlar shu yagona funksiyani ishlatadi.
-- ---------------------------------------------------------------------

create or replace function app.contract_discount(p_contract_id uuid)
returns table (kind public.discount_kind, value numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(c.discount_kind,  dt.kind),
    coalesce(c.discount_value, dt.value)
  from public.contracts c
  left join public.discount_types dt
         on dt.id = c.discount_type_id and dt.is_active
  where c.id = p_contract_id;
$$;

comment on function app.contract_discount(uuid) is
  'Amaldagi chegirma: shartnomadagi qo''lda kiritilgani ustun, aks holda '
  'chegirma turidan olinadi.';

grant execute on function
  app.next_counter(uuid, uuid, text),
  app.contract_discount(uuid)
to authenticated, service_role;
