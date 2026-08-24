-- =====================================================================
--  30 — TO'LIQ MOLIYAVIY MANZARA
--
--  Hozirgi hisobotlar "qancha hisoblangan" va "qancha yig'ilgan" ni
--  ko'rsatardi. Yetishmagani:
--
--    · YANA QANCHA YIG'ILISHI KERAK (qolgan)
--    · yig'ish foizi — sinf va maktab bo'yicha
--    · XODIMLAR OYLIGI xarajatlardan ALOHIDA (u eng katta modda va
--      uni boshqa xarajatlar bilan aralashtirish manzarani buzadi)
--    · foyda XARAJAT BILAN va XARAJATSIZ
--    · naqd holat: yig'ilgan pul minus to'langan xarajat
--    · oylar bo'yicha dinamika
--
--  MUHIM FARQ — ikki xil "qarzdorlik":
--    remaining — SHU DAVRDA hisoblangan minus shu davrda yig'ilgan
--    debt      — o'quvchining BUGUNGI umumiy qoldig'i (butun tarix)
--  Buxgalterga ikkalasi ham kerak: birinchisi oy rejasini, ikkinchisi
--  haqiqiy qarzni ko'rsatadi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SINF KESIMI — "yana qancha yig'ilishi kerak" qo'shiladi
-- ---------------------------------------------------------------------

drop function if exists public.report_by_class(date, date, uuid);

create or replace function public.report_by_class(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  class_id        uuid,
  class_name      text,
  grade_level     smallint,
  branch_id       uuid,
  branch_name     text,
  teacher_name    text,
  students        integer,
  charged         numeric,   -- shu davrda hisoblangan
  collected       numeric,   -- shu davrda yig'ilgan
  remaining       numeric,   -- YANA QANCHA YIG'ILISHI KERAK
  collection_rate numeric,   -- yig'ish foizi
  debt            numeric,   -- bugungi umumiy qarzdorlik (butun tarix)
  avg_per_student numeric
)
language sql
stable
as $$
  select
    c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
    count(distinct s.id)::integer,
    coalesce(inv.charged, 0)::numeric(14,2),
    coalesce(pay.collected, 0)::numeric(14,2),
    -- Qolgan hech qachon manfiy bo'lmaydi: ortiqcha to'lov "qolgan" emas.
    greatest(0, coalesce(inv.charged, 0) - coalesce(pay.collected, 0))::numeric(14,2),
    case when coalesce(inv.charged, 0) > 0
         then round(100.0 * coalesce(pay.collected, 0) / inv.charged, 1)
         else 0 end,
    coalesce(bal.debt, 0)::numeric(14,2),
    case when count(distinct s.id) > 0
         then round(coalesce(inv.charged, 0) / count(distinct s.id), 2)
         else 0 end
  from public.classes c
  join public.branches b on b.id = c.branch_id
  left join public.teachers te on te.id = c.teacher_id
  left join public.students s on s.class_id = c.id and s.deleted_at is null
  left join lateral (
    select sum(t.total) as charged
      from public.v_invoice_totals t
      join public.students s2 on s2.id = t.student_id
     where s2.class_id = c.id
       and t.status <> 'cancelled'
       and t.period between date_trunc('month', p_from)::date and p_to
  ) inv on true
  left join lateral (
    select sum(p.amount) as collected
      from public.payments p
      join public.students s3 on s3.id = p.student_id
     where s3.class_id = c.id
       and p.status = 'confirmed'
       and p.paid_on between p_from and p_to
  ) pay on true
  left join lateral (
    select sum(v.balance) filter (where v.balance > 0) as debt
      from public.v_student_balances v
      join public.students s4 on s4.id = v.student_id
     where s4.class_id = c.id
  ) bal on true
  where c.deleted_at is null
    and (p_branch_id is null or c.branch_id = p_branch_id)
  group by c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
           inv.charged, pay.collected, bal.debt
  order by c.grade_level nulls last, c.name;
$$;

comment on function public.report_by_class(date, date, uuid) is
  'Sinf kesimi: hisoblangan, yig''ilgan, YANA QANCHA KERAK, yig''ish '
  'foizi va bugungi qarzdorlik.';

-- ---------------------------------------------------------------------
-- 2. UMUMIY MOLIYAVIY JAMLANMA
--
--  Bitta qator — direktor bir qarashda butun manzarani ko'radi.
--  Xodimlar oyligi alohida ustunda, chunki u odatda xarajatning
--  yarmidan ko'pini tashkil qiladi.
-- ---------------------------------------------------------------------

create or replace function public.report_financial_summary(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  charged            numeric,  -- hisoblangan (kutilgan tushum)
  collected          numeric,  -- yig'ilgan
  remaining          numeric,  -- yana yig'ilishi kerak
  collection_rate    numeric,  -- yig'ish foizi
  total_debt         numeric,  -- bugungi umumiy qarzdorlik
  advances           numeric,  -- ortiqcha to'lov (avans)
  payroll            numeric,  -- XODIMLAR OYLIGI (alohida)
  other_expenses     numeric,  -- qolgan xarajatlar
  total_expenses     numeric,  -- jami xarajat
  profit_before_expenses numeric, -- xarajatsiz (= hisoblangan)
  profit_before_payroll  numeric, -- oyliksiz foyda
  profit_net         numeric,  -- sof foyda (hisoblangan − barcha xarajat)
  cash_position      numeric,  -- naqd holat (yig'ilgan − barcha xarajat)
  students           integer,
  paid_students      integer   -- qarzi yo'q o'quvchilar
)
language sql
stable
as $$
  with scope as (
    select id as branch_id from public.branches
     where deleted_at is null
       and (p_branch_id is null or id = p_branch_id)
  ),
  inv as (
    select coalesce(sum(t.total), 0) as charged
      from public.v_invoice_totals t
      join scope on scope.branch_id = t.branch_id
     where t.status <> 'cancelled'
       and t.period between date_trunc('month', p_from)::date and p_to
  ),
  pay as (
    select coalesce(sum(p.amount), 0) as collected
      from public.payments p
      join scope on scope.branch_id = p.branch_id
     where p.status = 'confirmed'
       and p.paid_on between p_from and p_to
  ),
  exp as (
    select
      -- Oylik xarajati `payroll_run_id` bilan belgilangan (TZ 4.11.9),
      -- shuning uchun uni aniq ajratish mumkin.
      coalesce(sum(e.amount) filter (where e.payroll_run_id is not null), 0) as payroll,
      coalesce(sum(e.amount) filter (where e.payroll_run_id is null), 0) as other,
      coalesce(sum(e.amount), 0) as total
      from public.expenses e
      join scope on scope.branch_id = e.branch_id
     where e.deleted_at is null
       and e.spent_on between p_from and p_to
  ),
  bal as (
    select
      coalesce(sum(v.balance) filter (where v.balance > 0), 0) as debt,
      coalesce(-sum(v.balance) filter (where v.balance < 0), 0) as advance,
      count(*) filter (where v.status = 'active')::int as students,
      count(*) filter (where v.status = 'active' and v.balance <= 0)::int as paid
      from public.v_student_balances v
      join scope on scope.branch_id = v.branch_id
  )
  select
    inv.charged::numeric(14,2),
    pay.collected::numeric(14,2),
    greatest(0, inv.charged - pay.collected)::numeric(14,2),
    case when inv.charged > 0
         then round(100.0 * pay.collected / inv.charged, 1) else 0 end,
    bal.debt::numeric(14,2),
    bal.advance::numeric(14,2),
    exp.payroll::numeric(14,2),
    exp.other::numeric(14,2),
    exp.total::numeric(14,2),
    inv.charged::numeric(14,2),
    (inv.charged - exp.other)::numeric(14,2),
    (inv.charged - exp.total)::numeric(14,2),
    (pay.collected - exp.total)::numeric(14,2),
    bal.students,
    bal.paid
  from inv, pay, exp, bal;
$$;

comment on function public.report_financial_summary(date, date, uuid) is
  'Butun moliyaviy manzara bitta qatorda: kutilgan, yig''ilgan, qolgan, '
  'xodimlar oyligi ALOHIDA, foyda xarajat bilan va xarajatsiz, naqd holat.';

-- ---------------------------------------------------------------------
-- 3. OYLAR BO'YICHA DINAMIKA
--
--  Direktor uchun: tushum o'sayaptimi, xarajat qayerga ketyapti,
--  sof foyda qanday o'zgaryapti.
-- ---------------------------------------------------------------------

create or replace function public.report_monthly_trend(
  p_months    int default 12,
  p_branch_id uuid default null
)
returns table (
  period      date,
  charged     numeric,
  collected   numeric,
  remaining   numeric,
  payroll     numeric,
  other_expenses numeric,
  net_profit  numeric,
  students    integer
)
language sql
stable
as $$
  with months as (
    select date_trunc('month', current_date)::date
           - (make_interval(months => g))::interval as m
      from generate_series(0, greatest(0, p_months - 1)) g
  ),
  scope as (
    select id as branch_id from public.branches
     where deleted_at is null
       and (p_branch_id is null or id = p_branch_id)
  ),
  period_list as (
    select m::date as period,
           (m + interval '1 month - 1 day')::date as period_end
      from months
  )
  select
    pl.period,
    coalesce((
      select sum(t.total) from public.v_invoice_totals t
       join scope on scope.branch_id = t.branch_id
      where t.status <> 'cancelled' and t.period = pl.period
    ), 0)::numeric(14,2) as charged,
    coalesce((
      select sum(p.amount) from public.payments p
       join scope on scope.branch_id = p.branch_id
      where p.status = 'confirmed'
        and p.paid_on between pl.period and pl.period_end
    ), 0)::numeric(14,2) as collected,
    0::numeric(14,2) as remaining,
    coalesce((
      select sum(e.amount) from public.expenses e
       join scope on scope.branch_id = e.branch_id
      where e.deleted_at is null
        and e.payroll_run_id is not null
        and e.spent_on between pl.period and pl.period_end
    ), 0)::numeric(14,2) as payroll,
    coalesce((
      select sum(e.amount) from public.expenses e
       join scope on scope.branch_id = e.branch_id
      where e.deleted_at is null
        and e.payroll_run_id is null
        and e.spent_on between pl.period and pl.period_end
    ), 0)::numeric(14,2) as other_expenses,
    0::numeric(14,2) as net_profit,
    coalesce((
      select count(*)::int from public.students s
       join scope on scope.branch_id = s.branch_id
      where s.deleted_at is null
        and s.status = 'active'
        and s.enrolled_on <= pl.period_end
        and (s.left_on is null or s.left_on >= pl.period)
    ), 0) as students
  from period_list pl
  order by pl.period;
$$;

comment on function public.report_monthly_trend(int, uuid) is
  'Oxirgi N oy: hisoblangan, yig''ilgan, oylik, boshqa xarajat va '
  'o''quvchilar soni. Qolgan va sof foyda mijoz tomonda hisoblanadi — '
  'ustunlardan kelib chiqadi.';

-- =====================================================================
--  HUQUQLAR
-- =====================================================================

do $do$
declare f text;
begin
  foreach f in array array[
    'public.report_by_class(date, date, uuid)',
    'public.report_financial_summary(date, date, uuid)',
    'public.report_monthly_trend(int, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
