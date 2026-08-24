-- =====================================================================
--  07 — XARAJATLAR, O'QITUVCHILAR YUKLAMASI VA OYLIK (TZ 4.10, 4.11)
--
--  TZ 4.11 ogohlantirishi: "Bu tizimning eng murakkab va eng mas'uliyatli
--  qismi." Shuning uchun eng muhim qoida — TZ 4.11.10:
--
--      FORMULA PARAMETRLARI KODGA YOZILMAYDI.
--
--  Stavkalar, tariflar, ustamalar foizi va ushlanma stavkalari
--  `payroll_settings` jadvalida saqlanadi va maktab bo'yicha farq
--  qilishi mumkin. Buxgalter formulani bergach FAQAT SHU JADVAL
--  yangilanadi — kod o'zgarmaydi va qayta joylashtirilmaydi.
--
--  TZ 4.10.2 — o'qituvchilar oyligi xarajat sifatida QO'LDA
--  KIRITILMAYDI: u tasdiqlangan oylik hisobidan avtomatik tushadi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. XARAJAT KATEGORIYALARI (TZ 4.10, 4.10.1)
-- ---------------------------------------------------------------------

create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,
  code        text not null,
  name        text not null,
  -- Tizim kategoriyasini o'chirib bo'lmaydi (masalan "Ish haqi" —
  -- unga oylik hisobidan avtomatik yozuv tushadi).
  is_system   boolean not null default false,
  is_active   boolean not null default true,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  unique (school_id, code)
);

comment on table public.expense_categories is
  'TZ 4.10.1 — kategoriyalar ro''yxati maktab tomonidan kengaytiriladi. '
  'is_system = true bo''lganlari (ish haqi) o''chirilmaydi.';

-- ---------------------------------------------------------------------
-- 2. XARAJATLAR (TZ 4.10)
-- ---------------------------------------------------------------------

create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id)  on delete restrict,
  branch_id       uuid not null references public.branches(id) on delete restrict,
  category_id     uuid not null references public.expense_categories(id) on delete restrict,
  amount          numeric(14,2) not null check (amount > 0),
  spent_on        date not null default current_date,
  payment_method  text not null default 'cash' check (payment_method in ('cash', 'bank')),
  note            text,
  -- Hujjat ilovasi (TZ 4.10 maydonlari).
  document_path   text,
  -- To'ldirilgan bo'lsa — bu yozuv oylik hisobidan AVTOMATIK yaratilgan
  -- (TZ 4.11.9). Bunday yozuv qo'lda tahrirlanmaydi.
  payroll_run_id  uuid,
  created_by      uuid references public.app_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

comment on table public.expenses is
  'Xarajatlar. TZ 4.10.2 — o''qituvchilar oyligi bu yerga QO''LDA '
  'kiritilmaydi, u payroll_run_id bilan avtomatik tushadi.';

create index if not exists expenses_branch_idx
  on public.expenses(branch_id, spent_on desc) where deleted_at is null;
create index if not exists expenses_category_idx
  on public.expenses(category_id, spent_on) where deleted_at is null;

select app.attach_touch_trigger('expenses');

-- ---------------------------------------------------------------------
-- 3. O'QITUVCHILAR (TZ 4.11.1)
-- ---------------------------------------------------------------------

create table if not exists public.teachers (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id) on delete restrict,
  -- O'qituvchi PWA ga kirsa — app_users dagi hisobiga bog'lanadi.
  -- Bog'lanmagan bo'lsa faqat buxgalter uchun yozuv.
  user_id      uuid references public.app_users(id) on delete set null,
  full_name    text not null,
  phone        text,
  -- Toifa (oliy, birinchi, ikkinchi...) — soat narxiga ta'sir qilishi
  -- mumkin (TZ 12.1.3). Koeffitsiyent payroll_settings da.
  category     text,
  hired_on     date,
  -- Stavka ulushi: 1.0 = to'liq, 0.5 = yarim (TZ 12.1.2).
  rate_factor  numeric(5,3) not null default 1.0
               check (rate_factor > 0 and rate_factor <= 3),
  -- Shartnomadagi qat'iy oylik (base_type = 'fixed' bo'lganda ishlatiladi).
  base_salary  numeric(14,2) not null default 0 check (base_salary >= 0),
  -- Haftalik yuklama (soat). base_type = 'hourly'/'rate' da ishlatiladi.
  weekly_hours numeric(6,2) not null default 0 check (weekly_hours >= 0),
  is_active    boolean     not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

comment on table public.teachers is
  'TZ 4.11.1 — har bir o''qituvchi uchun stavka va yuklama. '
  'Kadrlar hujjatlari yuritilmaydi (TZ 2.2) — faqat hisob uchun kerakli maydonlar.';
comment on column public.teachers.rate_factor is
  'TZ 12.1.2 — stavka ulushi: 1.0 to''liq, 0.5 yarim stavka.';

create index if not exists teachers_school_idx on public.teachers(school_id)
  where deleted_at is null and is_active;
create unique index if not exists teachers_user_idx on public.teachers(user_id)
  where user_id is not null;

select app.attach_touch_trigger('teachers');

-- TZ 4.11.4 — bir xodim bir nechta filialda ishlashi mumkin.
create table if not exists public.teacher_branches (
  teacher_id  uuid not null references public.teachers(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  -- Filialdagi yuklama ulushi — oylikni filiallar bo'yicha taqsimlash uchun.
  load_share  numeric(5,3) not null default 1.0 check (load_share > 0),
  primary key (teacher_id, branch_id)
);

comment on table public.teacher_branches is
  'TZ 4.1.6 / 4.11.4 — bir xodim bir nechta filialda dars berishi va '
  'oyligi JAMLANGAN holda hisoblanishi mumkin.';

-- ---------------------------------------------------------------------
-- 4. DARSLAR (TZ 4.11.2)
-- ---------------------------------------------------------------------

create table if not exists public.lessons (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)   on delete restrict,
  branch_id     uuid not null references public.branches(id)  on delete restrict,
  teacher_id    uuid not null references public.teachers(id)  on delete cascade,
  day           date not null,
  kind          public.lesson_kind not null default 'held',
  hours         numeric(5,2) not null default 1 check (hours > 0),
  subject       text,
  class_name    text,
  -- O'rniga kirilgan dars: kimning o'rniga (TZ 4.11.2, 12.1.4).
  substitute_for uuid references public.teachers(id) on delete set null,
  -- O'tkazilmagan dars sababi: bayram, karantin, o'qituvchi kelmadi
  -- (TZ 12.1.5). Ushlanma qoidasi payroll_settings dan keladi.
  reason        text,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.lessons is
  'TZ 4.11.2 — bo''lib o''tgan, o''rniga kirilgan va o''tkazilmagan darslar. '
  'Oylik hisobi shu yozuvlardan quriladi.';
comment on column public.lessons.reason is
  'O''tkazilmagan dars sababi. To''lanadimi yoki yo''q — payroll_settings '
  'dagi unheld_lesson_policy hal qiladi (TZ 12.1.5).';

create index if not exists lessons_teacher_period_idx
  on public.lessons(teacher_id, day);
create index if not exists lessons_branch_idx on public.lessons(branch_id, day);

-- ---------------------------------------------------------------------
-- 5. OYLIK SOZLAMALARI (TZ 4.11.10) — DVIGATELNING YURAGI
-- ---------------------------------------------------------------------

create table if not exists public.payroll_settings (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete cascade,
  key            text not null,
  value          jsonb not null,
  -- Parametr qaysi davrdan boshlab amal qiladi. O'tgan oylar qayta
  -- hisoblanganda O'SHA DAVRDAGI parametr olinadi.
  effective_from date not null default '2000-01-01',
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.app_users(id) on delete set null,
  unique (school_id, key, effective_from)
);

comment on table public.payroll_settings is
  'TZ 4.11.10 — oylik formulasining BARCHA parametrlari. Kodda hech qanday '
  'stavka, foiz yoki tarif yo''q. Buxgalter formulani bergach faqat shu '
  'jadval yangilanadi.';
comment on column public.payroll_settings.effective_from is
  'Parametr qaysi davrdan amal qiladi. O''tgan davr qayta hisoblanganda '
  'o''sha davrda amal qilgan qiymat olinadi.';

select app.attach_touch_trigger('payroll_settings');

-- Berilgan davrda amal qilgan parametrni oladi.
create or replace function app.payroll_setting(
  p_school_id uuid,
  p_key       text,
  p_period    date,
  p_default   jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select ps.value
      from public.payroll_settings ps
     where ps.school_id = p_school_id
       and ps.key = p_key
       and ps.effective_from <= p_period
     order by ps.effective_from desc
     limit 1
  ), p_default);
$$;

comment on function app.payroll_setting(uuid, text, date, jsonb) is
  'TZ 4.11.10 — davrda amal qilgan formula parametrini oladi.';

-- ---------------------------------------------------------------------
-- 6. OYLIK HISOBLARI (TZ 4.11.3, 4.11.8, 4.11.9)
-- ---------------------------------------------------------------------

create table if not exists public.payroll_runs (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id)  on delete restrict,
  teacher_id     uuid not null references public.teachers(id) on delete restrict,
  period         date not null,
  status         public.payroll_status not null default 'draft',
  -- Hisob davri chegaralari (TZ 12.1.10 — qaysi sanadan qaysi sanagacha).
  period_from    date not null,
  period_to      date not null,
  calculated_at  timestamptz not null default now(),
  approved_at    timestamptz,
  approved_by    uuid references public.app_users(id) on delete set null,
  -- TZ 4.11.9 — tasdiqlanganda yaratilgan xarajat yozuvi.
  expense_id     uuid references public.expenses(id) on delete set null,
  -- Hisoblashda ishlatilgan parametrlar nusxasi. Keyinchalik sozlama
  -- o'zgarsa ham "o'sha paytda qanday hisoblangani" isbotlanadi.
  settings_snapshot jsonb,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint payroll_runs_period_is_month
    check (period = date_trunc('month', period)::date)
);

comment on table public.payroll_runs is
  'O''qituvchining bir oylik hisobi. TZ 4.11.8 — buxgalter tasdiqlamaguncha '
  'KUCHGA KIRMAYDI (status = draft).';
comment on column public.payroll_runs.settings_snapshot is
  'Hisoblashda qo''llangan parametrlar nusxasi — nizoli holatda isbot uchun.';

create unique index if not exists payroll_runs_teacher_period_idx
  on public.payroll_runs(teacher_id, period) where status <> 'cancelled';
create index if not exists payroll_runs_period_idx
  on public.payroll_runs(school_id, period, status);

select app.attach_touch_trigger('payroll_runs');

-- Xarajat → oylik bog'lanishi (jadval endi mavjud).
alter table public.expenses
  drop constraint if exists expenses_payroll_run_fk;
alter table public.expenses
  add constraint expenses_payroll_run_fk
  foreign key (payroll_run_id) references public.payroll_runs(id) on delete set null;

-- ---------------------------------------------------------------------
-- 7. OYLIK QATORLARI (TZ 4.11.7) — BATAFSIL QAYDNOMA
--
--  "Har bir o'qituvchi uchun batafsil qaydnoma shakllantiriladi —
--   har bir qator qayerdan kelgani ko'rinadi."
-- ---------------------------------------------------------------------

create table if not exists public.payroll_lines (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete restrict,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  -- TZ 4.11.4 — filial kesimi. Jamlash uchun null bo'lishi mumkin.
  branch_id      uuid references public.branches(id) on delete set null,
  -- 'base' | 'lessons' | 'substitution' | 'allowance' | 'deduction' | 'advance'
  source_kind    text not null,
  description    text not null,
  quantity       numeric(10,2) not null default 1,
  unit_price     numeric(14,2) not null default 0,
  -- Ushlanma va avans MANFIY summa bilan yoziladi.
  amount         numeric(14,2) not null,
  -- Qator qayerdan kelgani: qaysi darslar, qaysi parametr, qanday baza.
  source         jsonb,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.payroll_lines is
  'TZ 4.11.7 — qaydnomaning har bir qatori. source maydonida raqam '
  'qayerdan kelgani (qaysi darslar, qaysi parametr) saqlanadi.';
comment on column public.payroll_lines.amount is
  'Ushlanma (deduction) va avans MANFIY summa bilan yoziladi — '
  'shuning uchun jami oddiy yig''indi bo''ladi.';

create index if not exists payroll_lines_run_idx on public.payroll_lines(payroll_run_id);

-- Oylik jamisi — qatorlardan (TZ 4.12.2).
create or replace view public.v_payroll_totals
with (security_invoker = true) as
select
  r.id           as payroll_run_id,
  r.school_id,
  r.teacher_id,
  r.period,
  r.status,
  coalesce(sum(l.amount), 0)::numeric(14,2) as net_total,
  coalesce(sum(l.amount) filter (where l.amount > 0), 0)::numeric(14,2) as gross_total,
  coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::numeric(14,2) as deductions_total
from public.payroll_runs r
left join public.payroll_lines l on l.payroll_run_id = r.id
group by r.id;

comment on view public.v_payroll_totals is
  'Oylik jamisi qatorlardan hisoblanadi, saqlanmaydi (TZ 4.12.2).';

grant execute on function app.payroll_setting(uuid, text, date, jsonb)
to authenticated, service_role;
