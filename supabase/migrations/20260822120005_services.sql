-- =====================================================================
--  05 — QO'SHIMCHA XIZMATLAR, KALENDAR VA YO'QLIK QAYD ETUVI
--       (TZ 4.4, 4.5)
--
--  Asosiy tamoyil (TZ 4.5): tizimda KELGANLAR EMAS, KELMAGANLAR
--  belgilanadi. Standart holatda barcha o'quvchi xizmatdan foydalangan
--  hisoblanadi. 300 o'quvchidan 5-15 tasi belgilanadi.
--
--  TZ 4.4.5 — narx o'zgarganda eski narx tarixda saqlanadi va O'TGAN
--  DAVRLARGA TA'SIR QILMAYDI. Shuning uchun narx alohida jadvalda,
--  amal qilish davri bilan.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. XIZMATLAR (TZ 4.4)
--
--  TZ 5.3 modeliga muvofiq xizmat FILIALGA tegishli. Bu TZ 4.4.4 ni
--  ("narx filial bo'yicha farq qilishi mumkin") tabiiy qoplaydi va
--  5.4.2 talabini (branch_id NOT NULL) buzmaydi.
--  Filiallar bo'ylab jamlash uchun `code` maydoni ishlatiladi (TZ 4.4.6).
-- ---------------------------------------------------------------------

create table if not exists public.services (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)  on delete restrict,
  branch_id     uuid not null references public.branches(id) on delete restrict,
  -- Filiallar bo'ylab bir xil xizmatni jamlash kaliti: 'meals', 'transport'.
  code          text not null,
  name          text not null,
  billing_type  public.billing_type not null,
  is_active     boolean     not null default true,
  sort_order    smallint    not null default 0,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (branch_id, code)
);

comment on table public.services is
  'Pullik xizmatlar (transport, ovqatlanish...). TZ 4.4.1 — maktab xodimi '
  'yangi xizmatni DASTURCHI ISHTIROKISIZ qo''sha oladi.';
comment on column public.services.code is
  'TZ 4.4.6 — filiallar bo''ylab bir xil xizmatni jamlash kaliti.';
comment on column public.services.billing_type is
  'monthly_fixed = oy boshida to''liq summa; daily = oy oxirida kunlar '
  'soni bo''yicha; one_time = bir martalik (TZ 4.4.1).';

create index if not exists services_branch_idx on public.services(branch_id)
  where deleted_at is null and is_active;

select app.attach_touch_trigger('services');

-- ---------------------------------------------------------------------
-- 2. NARX TARIXI (TZ 4.4.5)
-- ---------------------------------------------------------------------

create table if not exists public.service_prices (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)   on delete restrict,
  service_id  uuid not null references public.services(id)  on delete cascade,
  price       numeric(14,2) not null check (price >= 0),
  valid_from  date not null,
  valid_to    date,        -- null = hozirgacha amal qiladi
  created_at  timestamptz not null default now(),
  created_by  uuid references public.app_users(id) on delete set null,
  constraint service_prices_period_valid
    check (valid_to is null or valid_to >= valid_from)
);

comment on table public.service_prices is
  'TZ 4.4.5 — narx tarixi. Eski narx saqlanadi va o''tgan davrlarga '
  'ta''sir qilmaydi: hisoblanma har doim O''SHA DAVRDA amal qilgan narxni oladi.';

create index if not exists service_prices_lookup_idx
  on public.service_prices(service_id, valid_from desc);

-- Bir xizmatda bir sanada faqat bitta narx amal qiladi.
create unique index if not exists service_prices_no_overlap_idx
  on public.service_prices(service_id, valid_from);

-- =====================================================================
--  BERILGAN SANADA AMAL QILGAN NARX
--
--  Hisoblanma HAR DOIM shu funksiya orqali narx oladi. Shuning uchun
--  bugun narx o'zgarsa ham o'tgan oy hisoblanmasi o'zgarmaydi (TZ 4.4.5).
-- =====================================================================
create or replace function app.service_price_on(p_service_id uuid, p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select sp.price
    from public.service_prices sp
   where sp.service_id = p_service_id
     and sp.valid_from <= p_date
     and (sp.valid_to is null or sp.valid_to >= p_date)
   order by sp.valid_from desc
   limit 1;
$$;

comment on function app.service_price_on(uuid, date) is
  'TZ 4.4.5 — berilgan sanada amal qilgan narx. Hisoblanma faqat shu '
  'funksiya orqali narx oladi.';

-- ---------------------------------------------------------------------
-- 3. O'QUVCHI ↔ XIZMAT (TZ 4.4.2, 4.4.3)
-- ---------------------------------------------------------------------

create table if not exists public.student_services (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)   on delete restrict,
  student_id  uuid not null references public.students(id)  on delete cascade,
  service_id  uuid not null references public.services(id)  on delete restrict,
  starts_on   date not null default current_date,
  ends_on     date,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.app_users(id) on delete set null,
  constraint student_services_period_valid
    check (ends_on is null or ends_on >= starts_on)
);

comment on table public.student_services is
  'TZ 4.4.2 — o''quvchi bir nechta xizmatga yozilishi mumkin, har biri '
  'o''z muddati bilan. TZ 4.4.3 — yozilish va bekor qilish sanasi qayd etiladi.';

create index if not exists student_services_student_idx
  on public.student_services(student_id, service_id);
create index if not exists student_services_service_idx
  on public.student_services(service_id, starts_on);

select app.attach_touch_trigger('student_services');

-- ---------------------------------------------------------------------
-- 4. KALENDAR (TZ 4.5.5)
--
--  Dam olish kunlari, bayramlar va ta'til davrlari hisobga kirmaydi.
-- ---------------------------------------------------------------------

create table if not exists public.calendar_days (
  school_id   uuid not null references public.schools(id) on delete cascade,
  -- Filial bo'yicha farq bo'lsa (masalan ta'mir) — filialga xos kun.
  -- null = maktabning barcha filiallari uchun.
  branch_id   uuid references public.branches(id) on delete cascade,
  day         date not null,
  day_type    public.calendar_day_type not null,
  name        text,
  created_at  timestamptz not null default now()
);

comment on table public.calendar_days is
  'TZ 4.5.5 — dam olish kunlari, bayramlar va ta''til. Kunlik xizmat '
  'faqat workday turidagi kunlar uchun hisoblanadi.';
comment on column public.calendar_days.branch_id is
  'null = maktabning barcha filiallari uchun. To''ldirilgan bo''lsa '
  'faqat shu filialga tegishli istisno.';

create unique index if not exists calendar_days_school_idx
  on public.calendar_days(school_id, day) where branch_id is null;
create unique index if not exists calendar_days_branch_idx
  on public.calendar_days(school_id, branch_id, day) where branch_id is not null;

-- =====================================================================
--  DAVRDAGI ISH KUNLARI
--
--  Kunlik xizmatni hisoblashning asosi. Kalendarga kiritilmagan kun
--  standart qoida bo'yicha baholanadi: dushanba-juma = ish kuni.
--  Filialga xos yozuv maktab yozuvidan USTUN.
-- =====================================================================
create or replace function app.working_days(
  p_school_id uuid,
  p_branch_id uuid,
  p_from      date,
  p_to        date
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from generate_series(p_from, p_to, interval '1 day') as g(day)
   where coalesce(
     -- 1) Filialga xos yozuv
     (select cd.day_type
        from public.calendar_days cd
       where cd.school_id = p_school_id
         and cd.branch_id = p_branch_id
         and cd.day = g.day::date),
     -- 2) Maktab bo'yicha umumiy yozuv
     (select cd.day_type
        from public.calendar_days cd
       where cd.school_id = p_school_id
         and cd.branch_id is null
         and cd.day = g.day::date),
     -- 3) Standart: dushanba-juma ish kuni
     case when extract(isodow from g.day) <= 5
          then 'workday'::public.calendar_day_type
          else 'weekend'::public.calendar_day_type
     end
   ) = 'workday';
$$;

comment on function app.working_days(uuid, uuid, date, date) is
  'TZ 4.5.5 — davrdagi ish kunlari soni. Filialga xos kalendar yozuvi '
  'maktab yozuvidan ustun; yozuv bo''lmasa dushanba-juma ish kuni.';

-- ---------------------------------------------------------------------
-- 5. YO'QLIK SABABLARI (TZ 12.3.5)
--
--  "Yo'qlik sababi ahamiyatlimi? (kasallik uchun hisoblanmaydi,
--   sababsiz uchun hisoblanadi kabi)" — javob sozlanadigan qilinadi.
-- ---------------------------------------------------------------------

create table if not exists public.absence_reasons (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  code        text not null,
  name        text not null,
  -- true  = bu sabab bilan yo'q kun HISOBLANMAYDI (pul olinmaydi)
  -- false = yo'q bo'lsa ham kun hisoblanadi (masalan sababsiz)
  deducts     boolean not null default true,
  is_active   boolean not null default true,
  sort_order  smallint not null default 0,
  unique (school_id, code)
);

comment on table public.absence_reasons is
  'TZ 12.3.5 — yo''qlik sababi va u pulga ta''sir qiladimi. Maktab o''zi sozlaydi.';
comment on column public.absence_reasons.deducts is
  'true = bu sabab bilan yo''q kun uchun pul olinmaydi. '
  'false = yo''q bo''lsa ham kun hisoblanadi (sababsiz).';

-- ---------------------------------------------------------------------
-- 6. YO'QLIK QAYD ETUVI (TZ 4.5)
--
--  MUHIM (TZ 4.5 izohi): bu modul eMaktabdagi davomat BILAN BOG'LIQ
--  EMAS va uni almashtirmaydi. Bu — pullik xizmatdan foydalanish qayd
--  etuvi, ta'lim hujjati emas.
-- ---------------------------------------------------------------------

create table if not exists public.absences (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)   on delete restrict,
  branch_id   uuid not null references public.branches(id)  on delete restrict,
  student_id  uuid not null references public.students(id)  on delete cascade,
  -- null = barcha kunlik xizmatlardan yo'q (odatiy holat: bola kelmadi).
  -- To'ldirilgan = faqat shu xizmatdan (masalan transportdan foydalanmadi).
  service_id  uuid references public.services(id) on delete cascade,
  day         date not null,
  reason_id   uuid references public.absence_reasons(id) on delete set null,
  note        text,
  -- TZ 4.5.8 — har bir belgilash kim va qachon qilgani bilan qayd etiladi.
  marked_by   uuid references public.app_users(id) on delete set null,
  marked_at   timestamptz not null default now()
);

comment on table public.absences is
  'TZ 4.5 — KELMAGANLAR belgilanadi (kelganlar emas). Faqat kunlik '
  'xizmatga yozilgan o''quvchilar uchun yuritiladi (TZ 4.5.1).';
comment on column public.absences.service_id is
  'null = barcha kunlik xizmatlardan yo''q. To''ldirilgan = faqat shu xizmatdan.';

-- Takroriy belgilashni oldini oladi.
create unique index if not exists absences_all_services_idx
  on public.absences(student_id, day) where service_id is null;
create unique index if not exists absences_one_service_idx
  on public.absences(student_id, service_id, day) where service_id is not null;

create index if not exists absences_day_idx on public.absences(branch_id, day);
create index if not exists absences_student_idx on public.absences(student_id, day);

-- =====================================================================
--  O'QUVCHINING DAVRDAGI HISOBLANADIGAN KUNLARI
--
--  Kunlik xizmat summasi = shu funksiya × birlik narxi (TZ 4.6.4).
--
--  Hisob:  ish kunlari
--        − xizmatga yozilmagan kunlar (yozilish/bekor sanasidan tashqari)
--        − pulga ta'sir qiladigan sabab bilan yo'q kunlar
-- =====================================================================
create or replace function app.billable_days(
  p_student_id uuid,
  p_service_id uuid,
  p_from       date,
  p_to         date
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select s.school_id,
           s.branch_id,
           -- Xizmatga yozilgan davr bilan kesishma (TZ 4.4.2, 4.6.5)
           greatest(p_from, ss.starts_on)                       as day_from,
           least(p_to, coalesce(ss.ends_on, p_to))              as day_to
      from public.student_services ss
      join public.students s on s.id = ss.student_id
     where ss.student_id = p_student_id
       and ss.service_id = p_service_id
  ),
  work as (
    select b.school_id, b.branch_id, b.day_from, b.day_to,
           case when b.day_to < b.day_from then 0
                else app.working_days(b.school_id, b.branch_id, b.day_from, b.day_to)
           end as work_days
      from bounds b
  ),
  absent as (
    select count(*)::integer as missed
      from public.absences a
      join work w on true
      left join public.absence_reasons r on r.id = a.reason_id
     where a.student_id = p_student_id
       and (a.service_id is null or a.service_id = p_service_id)
       and a.day between w.day_from and w.day_to
       -- Sababsiz (reason_id null) — standart holatda pul olinmaydi.
       and coalesce(r.deducts, true)
       -- Faqat ish kunidagi yo'qlik hisobdan chiqadi.
       and app.working_days(w.school_id, w.branch_id, a.day, a.day) = 1
  )
  select greatest(0, (select work_days from work) - (select missed from absent));
$$;

comment on function app.billable_days(uuid, uuid, date, date) is
  'TZ 4.6.4 — kunlik xizmat uchun hisoblanadigan kunlar soni: '
  'ish kunlari − xizmatga yozilmagan kunlar − pulga ta''sir qiluvchi yo''qliklar.';

grant execute on function
  app.service_price_on(uuid, date),
  app.working_days(uuid, uuid, date, date),
  app.billable_days(uuid, uuid, date, date)
to authenticated, service_role;
