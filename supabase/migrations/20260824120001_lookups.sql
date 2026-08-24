-- =====================================================================
--  33 — OCHIQ RO'YXATLAR (MA'LUMOTNOMA)
--
--  MUAMMO: bir nechta joyda ro'yxat bo'lishi kerak bo'lgan maydon
--  ERKIN MATN edi:
--
--    · murojaat manbasi — "Instagram", "instagram", "Инстаграм",
--      "insta" — to'rt xil yozilib, "qaysi kanal ko'proq mijoz
--      keltiryapti" degan savolga javob berib bo'lmasdi;
--    · o'qituvchi toifasi — "oliy", "Oliy", "oliy toifa";
--    · murojaatdagi mo'ljallangan sinf — sinflar jadvali bo'la turib
--      qo'lda yozilardi.
--
--  YECHIM: bitta umumiy jadval. Har bir ro'yxat `kind` bilan
--  ajratiladi. Alohida jadval yaratilmaydi — chunki bu ro'yxatlarning
--  hech qandayida qo'shimcha ustun yo'q, faqat nom. Yangi ro'yxat
--  kerak bo'lsa migratsiya ham shart emas: yangi `kind` yetarli.
--
--  Foydalanuvchi ro'yxatda yo'q qiymatni uchratsa — o'zi qo'shadi
--  (dasturchisiz, TZ 4.4.1 ruhida).
-- =====================================================================

create table if not exists public.lookups (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,

  -- Qaysi ro'yxat: 'lead_source', 'teacher_category', ...
  kind        text not null,

  -- Ko'rinadigan nom. Foydalanuvchi shuni yozadi.
  name        text not null,

  sort_order  smallint not null default 100,
  is_active   boolean  not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint lookups_kind_check check (kind ~ '^[a-z][a-z0-9_]{2,39}$'),
  constraint lookups_name_check check (length(btrim(name)) between 1 and 80)
);

-- Bir maktabda bir ro'yxat ichida bir nom faqat bir marta.
-- Katta-kichik harf farqi hisobga OLINMAYDI: "Instagram" va
-- "instagram" bitta qiymat.
create unique index if not exists lookups_unique
  on public.lookups (school_id, kind, lower(btrim(name)))
  where deleted_at is null;

create index if not exists lookups_lookup
  on public.lookups (school_id, kind, sort_order)
  where deleted_at is null and is_active;

comment on table public.lookups is
  'Ochiq ma''lumotnoma ro''yxatlari (murojaat manbasi, o''qituvchi '
  'toifasi va h.k.). Yangi ro''yxat uchun migratsiya kerak emas — '
  'yangi `kind` yetarli.';

-- --- updated_at triggeri (mavjud yordamchi bilan) --------------------
do $do$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'app' and p.proname = 'touch_updated_at') then
    execute 'drop trigger if exists trg_lookups_touch on public.lookups';
    execute 'create trigger trg_lookups_touch before update on public.lookups
               for each row execute function app.touch_updated_at()';
  end if;
end $do$;

-- =====================================================================
--  RLS — A guruh naqshi (ma'lumotnoma jadval)
-- =====================================================================

alter table public.lookups enable row level security;

drop policy if exists lookups_select on public.lookups;
create policy lookups_select on public.lookups
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());

-- Ro'yxatga qo'shish huquqi past bo'lsin: murojaat manbasini
-- menejer ham qo'sha olishi kerak, aks holda "boshqa" deb yozib
-- ketadi va ro'yxat ma'nosini yo'qotadi.
drop policy if exists lookups_insert on public.lookups;
create policy lookups_insert on public.lookups
  for insert to authenticated
  with check (
    school_id = app.school_id()
    and (app.may_write('leads.manage')
      or app.may_write('teachers.manage')
      or app.may_write('services.manage'))
  );

drop policy if exists lookups_update on public.lookups;
create policy lookups_update on public.lookups
  for update to authenticated
  using (
    school_id = app.school_id()
    and (app.may_write('leads.manage')
      or app.may_write('teachers.manage')
      or app.may_write('services.manage'))
  )
  with check (
    school_id = app.school_id()
    and (app.may_write('leads.manage')
      or app.may_write('teachers.manage')
      or app.may_write('services.manage'))
  );

-- TZ 5.4.8 — DELETE siyosati yo'q.
grant select, insert, update on public.lookups to authenticated;

-- =====================================================================
--  BOSHLANG'ICH QIYMATLAR
--
--  Mavjud maktablarga ham, keyin yaratiladiganlarga ham.
-- =====================================================================

create or replace function app.seed_lookups(p_school_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lookups (school_id, kind, name, sort_order)
  select p_school_id, v.kind, v.name, v.ord
    from (values
      ('lead_source',      'Instagram',            10),
      ('lead_source',      'Telegram',             20),
      ('lead_source',      'Tanish tavsiyasi',     30),
      ('lead_source',      'Maktab yonidan o''tib', 40),
      ('lead_source',      'Reklama banneri',      50),
      ('lead_source',      'Veb-sayt',             60),
      ('lead_source',      'Telefon qo''ng''irog''i', 70),
      ('teacher_category', 'Oliy toifa',           10),
      ('teacher_category', 'Birinchi toifa',       20),
      ('teacher_category', 'Ikkinchi toifa',       30),
      ('teacher_category', 'Toifasiz',             40),
      ('teacher_category', 'Yosh mutaxassis',      50)
    ) as v(kind, name, ord)
  on conflict do nothing;
end;
$$;

comment on function app.seed_lookups(uuid) is
  'Yangi maktabga standart ro''yxatlarni qo''yadi. Idempotent.';

-- Mavjud maktablarga.
do $do$
declare s uuid;
begin
  for s in select id from public.schools where deleted_at is null loop
    perform app.seed_lookups(s);
  end loop;
end $do$;

-- Yangi maktab yaratilganda ham chaqirilsin.
do $do$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'seed_school_defaults') then
    -- `seed_school_defaults` ichidan chaqirish uchun uni o'zgartirish
    -- kerak; buni qilmaymiz — o'rniga yangi maktab yaratilganda
    -- trigger ishlaydi (quyida).
    null;
  end if;
end $do$;

create or replace function app.seed_lookups_on_school()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_lookups(new.id);
  return new;
end;
$$;

drop trigger if exists trg_schools_seed_lookups on public.schools;
create trigger trg_schools_seed_lookups
  after insert on public.schools
  for each row execute function app.seed_lookups_on_school();

-- =====================================================================
--  MUROJAATDAGI MO'LJALLANGAN SINF
--
--  `leads.target_class` matn bo'lib qoladi (murojaat kelganda sinf
--  hali aniq bo'lmasligi mumkin), lekin interfeys uni SINFLAR
--  ro'yxatidan tanlashni taklif qiladi.
-- =====================================================================

comment on column public.leads.target_class is
  'Mo''ljallangan sinf nomi. Interfeys mavjud sinflar ro''yxatidan '
  'tanlashni taklif qiladi, lekin yangi o''quv yiliga murojaat kelsa '
  'qo''lda ham yozish mumkin.';
