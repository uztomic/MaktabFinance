-- =====================================================================
--  14 — HISOBOTLAR (TZ 4.12)
--
--  UCHTA QOIDA:
--
--  1) TZ 4.12.1 — barcha hisobot IXTIYORIY SANA ORALIG'I bo'yicha.
--     "Kunlik, haftalik, oylik va yillik kesimlar alohida funksiya
--      emas, balki sana filtri natijasidir."
--     Shuning uchun har bir funksiya (p_from, p_to) oladi.
--
--  2) TZ 4.12.2 — jamlanma qiymatlar bazada SAQLANMAYDI, har safar
--     boshlang'ich yozuvlardan hisoblanadi.
--
--  3) XAVFSIZLIK: bu funksiyalar `security invoker` (standart) —
--     ataylab. Shu tufayli RLS chaqiruvchiga qo'llaniladi va hisobot
--     avtomatik ravishda faqat o'z maktabi va ochiq filiallari
--     bo'yicha chiqadi. `security definer` ishlatilsa RLS chetlab
--     o'tilardi va bu TZ 5.5.7 ni buzardi.
--
--  TZ 4.12.3/4.12.4 — har bir hisobotda `branch_id` ustuni bor.
--  Filial kesimi = shu ustun bo'yicha guruhlash; jamlangan = umumiy
--  yig'indi. Ikkalasi bir manbadan chiqqani uchun ular HAR DOIM
--  o'zaro mos keladi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MOLIYAVIY NATIJA (tushum, xarajat, foyda)
--
--  Ikki xil tushum ko'rsatiladi:
--    charged   — hisoblangan (hisoblanma bo'yicha, hisoblash usuli)
--    collected — yig'ilgan (haqiqiy to'lovlar, kassa usuli)
--  Buxgalterga ikkalasi ham kerak.
-- ---------------------------------------------------------------------

create or replace function public.report_pnl(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id   uuid,
  branch_name text,
  charged     numeric,
  collected   numeric,
  expenses    numeric,
  profit      numeric
)
language sql
stable
as $$
  with b as (
    select id, name from public.branches
     where deleted_at is null
       and (p_branch_id is null or id = p_branch_id)
  ),
  inv as (
    -- Hisoblanma davri oraliqqa tushgan hisoblanmalar.
    select i.branch_id, sum(t.total) as charged
      from public.invoices i
      join public.v_invoice_totals t on t.invoice_id = i.id
     where i.status <> 'cancelled'
       and i.period between date_trunc('month', p_from)::date and p_to
     group by i.branch_id
  ),
  pay as (
    select p.branch_id, sum(p.amount) as collected
      from public.payments p
     where p.status = 'confirmed'
       and p.paid_on between p_from and p_to
     group by p.branch_id
  ),
  exp as (
    select e.branch_id, sum(e.amount) as spent
      from public.expenses e
     where e.deleted_at is null
       and e.spent_on between p_from and p_to
     group by e.branch_id
  )
  select
    b.id,
    b.name,
    coalesce(inv.charged, 0)::numeric(14,2),
    coalesce(pay.collected, 0)::numeric(14,2),
    coalesce(exp.spent, 0)::numeric(14,2),
    (coalesce(inv.charged, 0) - coalesce(exp.spent, 0))::numeric(14,2)
  from b
  left join inv on inv.branch_id = b.id
  left join pay on pay.branch_id = b.id
  left join exp on exp.branch_id = b.id
  order by b.name;
$$;

comment on function public.report_pnl(date, date, uuid) is
  'TZ 4.12 — moliyaviy natija. charged = hisoblangan tushum, '
  'collected = haqiqiy yig''ilgan. Foyda hisoblangan tushumdan.';

-- ---------------------------------------------------------------------
-- 2. TUSHUM TARKIBI — xizmat turlari bo'yicha (TZ 4.4.6)
-- ---------------------------------------------------------------------

create or replace function public.report_revenue_mix(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id    uuid,
  branch_name  text,
  service_code text,
  service_name text,
  line_kind    public.invoice_line_kind,
  quantity     numeric,
  amount       numeric
)
language sql
stable
as $$
  select
    i.branch_id,
    b.name,
    coalesce(sv.code, l.kind::text),
    case l.kind
      when 'tuition'   then 'O''qish to''lovi'
      when 'discount'  then 'Chegirmalar'
      when 'adjustment' then 'Tuzatishlar'
      when 'carryover' then 'O''tgan davr tuzatuvi'
      else coalesce(sv.name, l.description)
    end,
    l.kind,
    sum(l.quantity)::numeric(14,2),
    sum(l.amount)::numeric(14,2)
  from public.invoice_lines l
  join public.invoices i on i.id = l.invoice_id
  join public.branches b on b.id = i.branch_id
  left join public.services sv on sv.id = l.service_id
  where i.status <> 'cancelled'
    and i.period between date_trunc('month', p_from)::date and p_to
    and (p_branch_id is null or i.branch_id = p_branch_id)
  group by i.branch_id, b.name, sv.code, sv.name, l.kind, l.description
  order by b.name, sum(l.amount) desc;
$$;

comment on function public.report_revenue_mix(date, date, uuid) is
  'TZ 4.12 — tushum tarkibi xizmat turlari bo''yicha. TZ 4.4.6 dagi '
  '"har bir xizmat bo''yicha alohida tushum hisoboti" shu funksiyadan.';

-- ---------------------------------------------------------------------
-- 3. QARZDORLIK — joriy va muddati o'tgan, sinflar kesimida (TZ 4.8)
-- ---------------------------------------------------------------------

create or replace function public.report_debts(
  p_branch_id uuid default null,
  p_min_amount numeric default 0.01
)
returns table (
  student_id      uuid,
  branch_id       uuid,
  full_name       text,
  class_name      text,
  payment_code    text,
  charged         numeric,
  paid            numeric,
  balance         numeric,
  overdue_amount  numeric,
  oldest_due      date,
  days_overdue    integer
)
language sql
stable
as $$
  select
    v.student_id,
    v.branch_id,
    v.full_name,
    v.class_name,
    v.payment_code,
    v.charged,
    v.paid,
    v.balance,
    -- Muddati o'tgan qismi balansdan oshib ketmasin (TZ 4.8.3).
    least(v.balance, v.overdue_charged)::numeric(14,2),
    v.oldest_unpaid_due,
    case when v.oldest_unpaid_due is not null and v.balance > 0
         then (current_date - v.oldest_unpaid_due)::integer
         else 0 end
  from public.v_student_balances v
  where v.status <> 'expelled'
    and v.balance >= p_min_amount
    and (p_branch_id is null or v.branch_id = p_branch_id)
  order by v.balance desc;
$$;

comment on function public.report_debts(uuid, numeric) is
  'TZ 4.8.2/4.8.3 — qarzdorlar summa bo''yicha saralangan, muddati '
  'o''tgani alohida ustunda.';

-- Ortiqcha to'lov (avans) — TZ 4.8.5
create or replace function public.report_advances(
  p_branch_id uuid default null
)
returns table (
  student_id   uuid,
  branch_id    uuid,
  full_name    text,
  class_name   text,
  advance      numeric
)
language sql
stable
as $$
  select v.student_id, v.branch_id, v.full_name, v.class_name,
         (-v.balance)::numeric(14,2)
    from public.v_student_balances v
   where v.balance < 0
     and (p_branch_id is null or v.branch_id = p_branch_id)
   order by v.balance;
$$;

comment on function public.report_advances(uuid) is
  'TZ 4.8.5 — ortiqcha to''lov (avans) alohida ko''rsatiladi va keyingi '
  'hisoblanmaga o''tkaziladi.';

-- ---------------------------------------------------------------------
-- 4. XARAJATLAR — kategoriyalar bo'yicha (TZ 4.10.3)
-- ---------------------------------------------------------------------

create or replace function public.report_expenses(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id     uuid,
  branch_name   text,
  category_id   uuid,
  category_code text,
  category_name text,
  amount        numeric,
  entries       integer
)
language sql
stable
as $$
  select
    e.branch_id,
    b.name,
    c.id,
    c.code,
    c.name,
    sum(e.amount)::numeric(14,2),
    count(*)::integer
  from public.expenses e
  join public.branches b on b.id = e.branch_id
  join public.expense_categories c on c.id = e.category_id
  where e.deleted_at is null
    and e.spent_on between p_from and p_to
    and (p_branch_id is null or e.branch_id = p_branch_id)
  group by e.branch_id, b.name, c.id, c.code, c.name
  order by b.name, sum(e.amount) desc;
$$;

-- ---------------------------------------------------------------------
-- 5. OYLIK JAMLANMASI — o'qituvchilar bo'yicha (TZ 4.12)
-- ---------------------------------------------------------------------

create or replace function public.report_payroll(
  p_period date
)
returns table (
  payroll_run_id uuid,
  teacher_id     uuid,
  teacher_name   text,
  status         public.payroll_status,
  gross_total    numeric,
  deductions     numeric,
  net_total      numeric,
  hours          numeric
)
language sql
stable
as $$
  select
    t.payroll_run_id,
    t.teacher_id,
    te.full_name,
    t.status,
    t.gross_total,
    t.deductions_total,
    t.net_total,
    coalesce((
      select sum(l.hours) from public.lessons l
       where l.teacher_id = t.teacher_id
         and l.day between r.period_from and r.period_to
         and l.kind in ('held', 'substituted')
    ), 0)
  from public.v_payroll_totals t
  join public.payroll_runs r on r.id = t.payroll_run_id
  join public.teachers te on te.id = t.teacher_id
  where t.period = date_trunc('month', p_period)::date
    and t.status <> 'cancelled'
  order by te.full_name;
$$;

comment on function public.report_payroll(date) is
  'TZ 4.12 — oylik jamlanmasi, ushlanmalar bilan.';

-- ---------------------------------------------------------------------
-- 6. KONTINGENT HARAKATI (TZ 4.12)
-- ---------------------------------------------------------------------

create or replace function public.report_enrollment(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id     uuid,
  branch_name   text,
  joined        integer,
  left_school   integer,
  active_now    integer,
  academic_leave integer
)
language sql
stable
as $$
  select
    b.id,
    b.name,
    count(*) filter (where s.enrolled_on between p_from and p_to)::integer,
    count(*) filter (where s.left_on between p_from and p_to)::integer,
    count(*) filter (where s.status = 'active')::integer,
    count(*) filter (where s.status = 'academic_leave')::integer
  from public.branches b
  left join public.students s
         on s.branch_id = b.id and s.deleted_at is null
  where b.deleted_at is null
    and (p_branch_id is null or b.id = p_branch_id)
  group by b.id, b.name
  order by b.name;
$$;

-- ---------------------------------------------------------------------
-- 7. KASSA HISOBOTI — kunlik naqd pul harakati (TZ 4.7.1.4)
-- ---------------------------------------------------------------------

create or replace function public.report_cash(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  day          date,
  branch_id    uuid,
  branch_name  text,
  cash_in      numeric,
  cash_out     numeric,
  net          numeric,
  receipts     integer
)
language sql
stable
as $$
  with days as (
    select g.day::date as day from generate_series(p_from, p_to, interval '1 day') g(day)
  ),
  b as (
    select id, name from public.branches
     where deleted_at is null and (p_branch_id is null or id = p_branch_id)
  ),
  inflow as (
    select p.paid_on as day, p.branch_id,
           sum(p.amount) as amount, count(*) as cnt
      from public.payments p
     where p.channel = 'cash' and p.status = 'confirmed'
       and p.paid_on between p_from and p_to
     group by 1, 2
  ),
  outflow as (
    select e.spent_on as day, e.branch_id, sum(e.amount) as amount
      from public.expenses e
     where e.payment_method = 'cash' and e.deleted_at is null
       and e.spent_on between p_from and p_to
     group by 1, 2
  )
  select
    d.day, b.id, b.name,
    coalesce(i.amount, 0)::numeric(14,2),
    coalesce(o.amount, 0)::numeric(14,2),
    (coalesce(i.amount, 0) - coalesce(o.amount, 0))::numeric(14,2),
    coalesce(i.cnt, 0)::integer
  from days d
  cross join b
  left join inflow  i on i.day = d.day and i.branch_id = b.id
  left join outflow o on o.day = d.day and o.branch_id = b.id
  where coalesce(i.amount, 0) <> 0 or coalesce(o.amount, 0) <> 0
  order by d.day, b.name;
$$;

comment on function public.report_cash(date, date, uuid) is
  'TZ 4.7.1.4 — kun oxirida kassa qoldig''ini solishtirish uchun.';

-- ---------------------------------------------------------------------
-- 8. XIZMATLARDAN FOYDALANISH — kunlik xizmatlar statistikasi (TZ 4.12)
-- ---------------------------------------------------------------------

create or replace function public.report_service_usage(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id      uuid,
  branch_name    text,
  service_id     uuid,
  service_name   text,
  billing_type   public.billing_type,
  subscribers    integer,
  absence_days   integer,
  billed_days    numeric,
  amount         numeric
)
language sql
stable
as $$
  select
    sv.branch_id,
    b.name,
    sv.id,
    sv.name,
    sv.billing_type,
    (select count(distinct ss.student_id)::integer
       from public.student_services ss
      where ss.service_id = sv.id
        and ss.starts_on <= p_to
        and (ss.ends_on is null or ss.ends_on >= p_from)),
    (select count(*)::integer
       from public.absences a
      where (a.service_id = sv.id or a.service_id is null)
        and a.branch_id = sv.branch_id
        and a.day between p_from and p_to),
    coalesce((select sum(l.quantity) from public.invoice_lines l
               join public.invoices i on i.id = l.invoice_id
              where l.service_id = sv.id
                and i.status <> 'cancelled'
                and i.period between date_trunc('month', p_from)::date and p_to), 0),
    coalesce((select sum(l.amount) from public.invoice_lines l
               join public.invoices i on i.id = l.invoice_id
              where l.service_id = sv.id
                and i.status <> 'cancelled'
                and i.period between date_trunc('month', p_from)::date and p_to), 0)::numeric(14,2)
  from public.services sv
  join public.branches b on b.id = sv.branch_id
  where sv.deleted_at is null
    and (p_branch_id is null or sv.branch_id = p_branch_id)
  order by b.name, sv.sort_order, sv.name;
$$;

-- ---------------------------------------------------------------------
-- 9. HISOBLANMA HOLATI — buxgalter boshqaruv paneli uchun
-- ---------------------------------------------------------------------

create or replace function public.report_invoice_status(
  p_period    date,
  p_branch_id uuid default null
)
returns table (
  branch_id    uuid,
  branch_name  text,
  status       public.invoice_status,
  invoices     integer,
  total         numeric,
  has_preliminary boolean
)
language sql
stable
as $$
  select
    t.branch_id,
    b.name,
    t.status,
    count(*)::integer,
    sum(t.total)::numeric(14,2),
    bool_or(t.has_preliminary)
  from public.v_invoice_totals t
  join public.branches b on b.id = t.branch_id
  where t.period = date_trunc('month', p_period)::date
    and (p_branch_id is null or t.branch_id = p_branch_id)
  group by t.branch_id, b.name, t.status
  order by b.name, t.status;
$$;

-- =====================================================================
--  HUQUQLAR
--
--  `security invoker` bo'lgani uchun RLS chaqiruvchiga qo'llaniladi —
--  qo'shimcha tekshiruv shart emas, ijarachilar ajratilishi avtomatik.
-- =====================================================================

do $do$
declare f text;
begin
  foreach f in array array[
    'public.report_pnl(date, date, uuid)',
    'public.report_revenue_mix(date, date, uuid)',
    'public.report_debts(uuid, numeric)',
    'public.report_advances(uuid)',
    'public.report_expenses(date, date, uuid)',
    'public.report_payroll(date)',
    'public.report_enrollment(date, date, uuid)',
    'public.report_cash(date, date, uuid)',
    'public.report_service_usage(date, date, uuid)',
    'public.report_invoice_status(date, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

grant select on public.v_invoice_totals, public.v_student_balances,
                public.v_payroll_totals to authenticated;
