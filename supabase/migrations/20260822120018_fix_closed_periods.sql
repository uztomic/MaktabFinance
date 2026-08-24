-- =====================================================================
--  18 — TUZATISH: closed_periods.branch_id NULL bo'la olishi kerak
--
--  MUAMMO: 09-migratsiyada jadval `primary key (school_id, period,
--  branch_id)` bilan yaratilgan. PostgreSQL da birlamchi kalitga
--  kirgan ustun avtomatik NOT NULL bo'ladi.
--
--  Lekin loyihada `branch_id IS NULL` alohida ma'noga ega:
--  "butun maktab bo'yicha oy yopildi". Filialga xos yopilish esa
--  to'ldirilgan branch_id bilan yoziladi.
--
--  Xato sinovda aniqlandi: `lock_period(period)` filialsiz chaqirilganda
--  NOT NULL cheklovi ishga tushdi.
--
--  YECHIM: birlamchi kalit o'rniga ikkita QISMIY UNIKAL INDEKS —
--  biri maktab bo'yicha yopilish uchun, ikkinchisi filial bo'yicha.
--  Shu tufayli ikkalasi ham takrorlanmaydi, lekin NULL ruxsat etiladi.
-- =====================================================================

alter table public.closed_periods drop constraint if exists closed_periods_pkey;
alter table public.closed_periods alter column branch_id drop not null;

-- Surrogat kalit — jadvalga murojaat qilish oson bo'lsin.
alter table public.closed_periods
  add column if not exists id uuid not null default gen_random_uuid();

do $do$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.closed_periods'::regclass and contype = 'p'
  ) then
    alter table public.closed_periods add primary key (id);
  end if;
end $do$;

-- Maktab bo'yicha yopilish: davr bo'yicha bittadan (09-migratsiyada bor).
create unique index if not exists closed_periods_school_idx
  on public.closed_periods(school_id, period) where branch_id is null;

-- Filial bo'yicha yopilish: filial + davr bo'yicha bittadan.
create unique index if not exists closed_periods_branch_idx
  on public.closed_periods(school_id, period, branch_id) where branch_id is not null;

comment on column public.closed_periods.branch_id is
  'null = BUTUN MAKTAB bo''yicha oy yopildi (barcha filialga taalluqli). '
  'To''ldirilgan = faqat shu filial yopildi.';
