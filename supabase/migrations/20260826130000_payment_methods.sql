-- =====================================================================
--  38 — TO'LOV USULI: NAQD, KARTA, CLICK, PAYME…
--
--  MUAMMO. Hozir `payments.channel` bor: `cash` / `bank` / `proof`.
--  Bu — pul QAYSI YO'L bilan kelgani (kassa, bank vypiskasi, chek
--  rasmi). Lekin buxgalterga BOSHQA savol kerak:
--
--      "Bu pul naqdmi, plastik kartadanmi, Click orqalimi?"
--
--  Farqi amaliy va katta. Ota-ona kassaga kelib plastik karta bilan
--  to'lasa, yozuv `channel = 'cash'` bo'ladi — chunki to'lovni kassir
--  qabul qilgan. Lekin pul kassa yashigida emas, bank hisobida.
--  Shu sababli "kassada qancha naqd bo'lishi kerak" degan raqam
--  hech qachon to'g'ri chiqmasdi va oy oxirida hisob kelishmasdi.
--
--  YECHIM. `payment_methods` — maktabga tegishli ma'lumotnoma.
--  Standart qiymatlar bilan keladi, lekin maktab o'zi qo'sha oladi:
--  yangi to'lov tizimi chiqsa dasturchi kerak emas (TZ 4.4.1 ruhi).
--
--  `is_cash` bayrog'i eng muhim ustun: kassa hisoboti aynan shu
--  bo'yicha ajratiladi, `channel` bo'yicha emas.
-- =====================================================================

create table if not exists public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete cascade,

  code        text not null,
  name        text not null,

  -- Naqd pulmi? Kassa qoldig'i shu bo'yicha hisoblanadi.
  is_cash     boolean not null default false,

  is_active   boolean not null default true,
  sort_order  smallint not null default 100,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint payment_methods_code_check check (code ~ '^[a-z][a-z0-9_]{1,29}$'),
  constraint payment_methods_name_check check (length(btrim(name)) between 1 and 60)
);

create unique index if not exists payment_methods_code_uniq
  on public.payment_methods (school_id, code) where deleted_at is null;

create index if not exists payment_methods_lookup
  on public.payment_methods (school_id, sort_order)
  where deleted_at is null and is_active;

comment on table public.payment_methods is
  'To''lov usuli: naqd, plastik karta, Click, Payme… `channel` pul '
  'qaysi YO''L bilan kelganini, bu esa QAYSI VOSITADA to''langanini '
  'bildiradi. Kassa qoldig''i `is_cash` bo''yicha hisoblanadi.';

comment on column public.payment_methods.is_cash is
  'Rost bo''lsa — pul kassa yashigiga tushadi. Yolg''on bo''lsa bank '
  'hisobiga. Kassada karta bilan to''langan pul naqd EMAS.';

-- --- updated_at -------------------------------------------------------
drop trigger if exists trg_payment_methods_touch on public.payment_methods;
create trigger trg_payment_methods_touch
  before update on public.payment_methods
  for each row execute function app.touch_updated_at();

-- =====================================================================
--  RLS — ma'lumotnoma naqshi (migratsiya 36 dagi `(select …)` shakli)
-- =====================================================================

alter table public.payment_methods enable row level security;

drop policy if exists payment_methods_select on public.payment_methods;
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using (school_id = (select app.school_id())
      or (select app.is_platform_admin()));

drop policy if exists payment_methods_insert on public.payment_methods;
create policy payment_methods_insert on public.payment_methods
  for insert to authenticated
  with check (school_id = (select app.school_id())
          and (select app.may_write('services.manage')));

drop policy if exists payment_methods_update on public.payment_methods;
create policy payment_methods_update on public.payment_methods
  for update to authenticated
  using (school_id = (select app.school_id())
     and (select app.may_write('services.manage')))
  with check (school_id = (select app.school_id())
          and (select app.may_write('services.manage')));

grant select, insert, update on public.payment_methods to authenticated;

select app.attach_audit_trigger('payment_methods');

-- =====================================================================
--  STANDART QIYMATLAR
-- =====================================================================

create or replace function app.seed_payment_methods(p_school_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.payment_methods
    (school_id, code, name, is_cash, sort_order)
  values
    (p_school_id, 'cash',     'Naqd pul',         true,  10),
    (p_school_id, 'card',     'Plastik karta',    false, 20),
    (p_school_id, 'click',    'Click',            false, 30),
    (p_school_id, 'payme',    'Payme',            false, 40),
    (p_school_id, 'uzum',     'Uzum Bank',        false, 50),
    (p_school_id, 'transfer', 'Bank o''tkazmasi', false, 60)
  on conflict do nothing;
$$;

comment on function app.seed_payment_methods(uuid) is
  'Standart to''lov usullari. Maktab keyin o''zi qo''shishi mumkin.';

do $do$
declare s uuid;
begin
  for s in select id from public.schools where deleted_at is null loop
    perform app.seed_payment_methods(s);
  end loop;
end $do$;

-- Yangi maktabga ham avtomatik.
create or replace function app.seed_methods_on_school()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.seed_payment_methods(new.id);
  return new;
end;
$$;

drop trigger if exists trg_schools_seed_methods on public.schools;
create trigger trg_schools_seed_methods
  after insert on public.schools
  for each row execute function app.seed_methods_on_school();

-- =====================================================================
--  TO'LOV VA XARAJATGA BOG'LASH
-- =====================================================================

alter table public.payments
  add column if not exists method_id uuid references public.payment_methods(id);

create index if not exists payments_method_idx
  on public.payments (school_id, method_id);

comment on column public.payments.method_id is
  'To''lov qaysi vositada amalga oshirilgan. Trigger avtomatik '
  'to''ldiradi, shuning uchun hech qachon bo''sh qolmaydi.';

--  Xarajat ham SHU ma'lumotnomani ishlatadi. Shundagina "naqd
--  qancha kirdi, naqd qancha chiqdi" degan savol bitta o'lchovda
--  javob oladi. Eski `payment_method` matn ustuni QOLADI — u endi
--  `method_id` dan kelib chiqib avtomatik to'ldiriladi.
alter table public.expenses
  add column if not exists method_id uuid references public.payment_methods(id);

create index if not exists expenses_method_idx
  on public.expenses (school_id, method_id);

-- =====================================================================
--  AVTOMATIK TO'LDIRISH
--
--  To'lov bazaga BESHTA turli funksiyadan tushadi: kassa, chek
--  tasdiqlash, bank vypiskasi, sinf bo'yicha to'lov, tuzatuv yozuvi.
--  Har birini alohida tahrirlash o'rniga bitta trigger qo'yiladi —
--  keyin qo'shiladigan yangi yo'l ham o'zi to'g'ri ishlaydi.
-- =====================================================================

create or replace function app.fill_payment_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if new.method_id is not null then
    return new;
  end if;

  --  `channel` dan eng ehtimollisi tanlanadi. Bu TAXMIN, lekin bo'sh
  --  qoldirishdan yaxshi: hisobot butun ma'lumotni qamraydi.
  --  Chek rasmi odatda bank ilovasidan olinadi.
  v_code := case new.channel when 'cash' then 'cash' else 'transfer' end;

  select id into new.method_id
    from public.payment_methods
   where school_id = new.school_id and code = v_code and deleted_at is null;

  return new;
end;
$$;

drop trigger if exists trg_payments_fill_method on public.payments;
create trigger trg_payments_fill_method
  before insert on public.payments
  for each row execute function app.fill_payment_method();

--  Xarajatda bog'lanish IKKI TOMONLAMA: foydalanuvchi usulni tanlasa
--  eski `payment_method` ustuni undan kelib chiqadi (eski hisobotlar
--  ishlashda davom etsin), tanlamasa — aksincha.
create or replace function app.fill_expense_method()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_is_cash boolean;
begin
  if new.method_id is not null then
    select is_cash into v_is_cash
      from public.payment_methods where id = new.method_id;
    new.payment_method := case when v_is_cash then 'cash' else 'bank' end;
  else
    select id into new.method_id
      from public.payment_methods
     where school_id = new.school_id and deleted_at is null
       and code = case when new.payment_method = 'cash' then 'cash'
                       else 'transfer' end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expenses_fill_method on public.expenses;
create trigger trg_expenses_fill_method
  before insert or update on public.expenses
  for each row execute function app.fill_expense_method();

-- =====================================================================
--  ESKI YOZUVLARNI TO'LDIRISH
--
--  DIQQAT: `payments` va `expenses` da davr qulfi triggeri bor va
--  eski oylar YOPIQ. Oddiy UPDATE darhol rad etiladi — va bu TO'G'RI
--  xatti-harakat, uni o'zgartirmaymiz.
--
--  Shuning uchun backfill vaqtida triggerlar vaqtincha o'chiriladi
--  va DARHOL qaytariladi:
--    · davr qulfi — texnik ustunni to'ldirish moliyaviy o'zgarish emas;
--    · audit — minglab ma'nosiz jurnal yozuvi kerak emas, ular
--      haqiqiy o'zgarishlarni ko'mib yuboradi.
-- =====================================================================

alter table public.payments disable trigger trg_payments_period_guard;
alter table public.payments disable trigger trg_payments_audit;
alter table public.payments disable trigger trg_payments_touch;
alter table public.expenses disable trigger trg_expenses_period_guard;
alter table public.expenses disable trigger trg_expenses_audit;
alter table public.expenses disable trigger trg_expenses_touch;
alter table public.expenses disable trigger trg_expenses_fill_method;
--  Oylikdan avtomatik chiqqan xarajat qo'lda tahrirlanmaydi (TZ 4.10.2).
--  Bu qoida joyida qoladi; faqat mana shu backfill uchun ochiladi.
alter table public.expenses disable trigger trg_expenses_guard_payroll;

update public.payments p
   set method_id = m.id
  from public.payment_methods m
 where m.school_id = p.school_id
   and m.deleted_at is null
   and p.method_id is null
   and m.code = case p.channel when 'cash' then 'cash' else 'transfer' end;

update public.expenses e
   set method_id = m.id
  from public.payment_methods m
 where m.school_id = e.school_id
   and m.deleted_at is null
   and e.method_id is null
   and m.code = case when e.payment_method = 'cash' then 'cash'
                     else 'transfer' end;

alter table public.payments enable trigger trg_payments_period_guard;
alter table public.payments enable trigger trg_payments_audit;
alter table public.payments enable trigger trg_payments_touch;
alter table public.expenses enable trigger trg_expenses_period_guard;
alter table public.expenses enable trigger trg_expenses_audit;
alter table public.expenses enable trigger trg_expenses_touch;
alter table public.expenses enable trigger trg_expenses_fill_method;
alter table public.expenses enable trigger trg_expenses_guard_payroll;

-- =====================================================================
--  KASSA TO'LOVI — usulni tanlash bilan
--
--  Eski to'rt argumentli variant O'CHIRILADI, saqlanmaydi. Agar
--  ikkalasi ham qolsa, to'rtta argument bilan chaqirilganda Postgres
--  "function is not unique" xatosini beradi — panel darhol buziladi.
-- =====================================================================

drop function if exists public.register_cash_payment(uuid, numeric, date, text);

create or replace function public.register_cash_payment(
  p_student_id uuid,
  p_amount     numeric,
  p_paid_on    date default current_date,
  p_note       text default null,
  p_method_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school     uuid;
  v_branch     uuid;
  v_payment_id uuid;
  v_no         bigint;
  v_code       text;
  v_prefix     text;
  v_balance    numeric(14,2);
  v_method     uuid := p_method_id;
  v_method_nm  text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasi noldan katta bo''lishi kerak' using errcode = '22023';
  end if;

  select school_id, branch_id into v_school, v_branch
    from public.students where id = p_student_id and deleted_at is null;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(v_branch);
  perform app.assert_period_open(v_school, p_paid_on, v_branch);

  --  Usul ko'rsatilmasa — naqd. Kassa oynasidan kelgan to'lov odatda
  --  shunday bo'ladi va eski chaqiruvlar buzilmaydi.
  if v_method is null then
    select id, name into v_method, v_method_nm
      from public.payment_methods
     where school_id = v_school and code = 'cash' and deleted_at is null;
  else
    --  Begona maktabning yoki o'chirilgan usul berilmasin.
    select name into v_method_nm
      from public.payment_methods
     where id = v_method and school_id = v_school
       and deleted_at is null and is_active;

    if v_method_nm is null then
      raise exception 'To''lov usuli topilmadi' using errcode = '22023';
    end if;
  end if;

  --  Kassada qabul qilingan to'lov darhol haqiqiy: pul topshirilgan.
  --  `channel` KASSA bo'lib qoladi, hatto karta bilan to'langanda
  --  ham — chunki to'lovni kassir qabul qilgan. Naqdligini `method`
  --  hal qiladi.
  insert into public.payments
    (school_id, branch_id, student_id, amount, channel, status,
     paid_on, note, method_id, created_by, confirmed_by, confirmed_at)
  values
    (v_school, v_branch, p_student_id, p_amount, 'cash', 'confirmed',
     p_paid_on, p_note, v_method, (select auth.uid()), (select auth.uid()), now())
  returning id into v_payment_id;

  -- TZ 4.7.1.5 — raqamlar FILIAL bo'yicha uzluksiz ketma-ketlikda.
  v_no := app.next_counter(v_school, v_branch, 'cash_receipt');

  select coalesce(nullif(upper(left(regexp_replace(name, '[^[:alnum:]]', '', 'g'), 3)), ''), 'FL')
    into v_prefix from public.branches where id = v_branch;

  v_code := 'KV-' || v_prefix || '-' || lpad(v_no::text, 6, '0');

  insert into public.cash_receipts
    (school_id, branch_id, payment_id, receipt_no, receipt_code, issued_by)
  values
    (v_school, v_branch, v_payment_id, v_no, v_code, (select auth.uid()));

  select balance into v_balance
    from public.v_student_balances where student_id = p_student_id;

  -- TZ 4.7.1.3 — kvitansiya raqami Telegram orqali ota-onaga yuboriladi.
  perform app.enqueue_for_student(
    p_student_id, 'payment_received',
    jsonb_build_object(
      'amount', to_char(p_amount, 'FM999G999G999G990'),
      'receipt', v_code,
      'balance', to_char(coalesce(v_balance, 0), 'FM999G999G999G990'),
      'date', to_char(p_paid_on, 'DD.MM.YYYY')));

  return jsonb_build_object(
    'payment_id',   v_payment_id,
    'receipt_no',   v_no,
    'receipt_code', v_code,
    'method_id',    v_method,
    'method_name',  v_method_nm,
    'balance',      v_balance);
end;
$$;

comment on function public.register_cash_payment(uuid, numeric, date, text, uuid) is
  'TZ 4.7.1 — kassa to''lovi va raqamlangan kvitansiya. `p_method_id` '
  'berilmasa naqd deb hisoblanadi. Raqam atomar olinadi (TZ 4.7.1.5).';

revoke all on function public.register_cash_payment(uuid, numeric, date, text, uuid)
  from public, anon;
grant execute on function public.register_cash_payment(uuid, numeric, date, text, uuid)
  to authenticated, service_role;

-- =====================================================================
--  HISOBOT — QAYSI USULDA QANCHA
-- =====================================================================

create or replace function public.report_payment_methods(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  method_id   uuid,
  method_name text,
  is_cash     boolean,
  payments    integer,
  amount      numeric,
  share       numeric
)
language sql
stable
as $$
  with paid as (
    select p.method_id, p.amount
      from public.payments p
     where p.status = 'confirmed'
       and p.paid_on between p_from and p_to
       and (p_branch_id is null or p.branch_id = p_branch_id)
  ),
  total as (select coalesce(sum(amount), 0) as s from paid)
  select
    m.id, m.name, m.is_cash,
    count(paid.method_id)::integer,
    coalesce(sum(paid.amount), 0)::numeric(14,2),
    (case when total.s > 0
          then round(100.0 * coalesce(sum(paid.amount), 0) / total.s, 1)
          else 0 end)::numeric(5,1)
  from public.payment_methods m
  cross join total
  left join paid on paid.method_id = m.id
  where m.deleted_at is null
  group by m.id, m.name, m.is_cash, m.sort_order, total.s
  having count(paid.method_id) > 0
  order by sum(paid.amount) desc nulls last, m.sort_order;
$$;

comment on function public.report_payment_methods(date, date, uuid) is
  'Qaysi to''lov usulida qancha yig''ilgan va ulushi necha foiz.';

revoke all on function public.report_payment_methods(date, date, uuid)
  from public, anon;
grant execute on function public.report_payment_methods(date, date, uuid)
  to authenticated, service_role;

-- =====================================================================
--  KASSA HISOBOTI — endi USUL bo'yicha ajratiladi
--
--  Ilgari `p.channel = 'cash'` edi. Kassada plastik karta orqali
--  to'langan pul ham shu kanalda turadi — natijada "kassada qancha
--  naqd bor" raqami har doim oshib ketardi va kassir kamomad bilan
--  qolardi.
--
--  `coalesce(m.is_cash, …)` — usul biriktirilmagan yozuv uchun eski
--  mantiq saqlanadi. Hisobotda teshik qolmaydi.
-- =====================================================================

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
      left join public.payment_methods m on m.id = p.method_id
     where p.status = 'confirmed'
       and coalesce(m.is_cash, p.channel = 'cash')
       and p.paid_on between p_from and p_to
     group by 1, 2
  ),
  outflow as (
    select e.spent_on as day, e.branch_id, sum(e.amount) as amount
      from public.expenses e
      left join public.payment_methods m on m.id = e.method_id
     where e.deleted_at is null
       and coalesce(m.is_cash, e.payment_method = 'cash')
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
  'TZ 4.7.1.4 — kunlik naqd harakati. Naqdlik `payment_methods.is_cash` '
  'bo''yicha aniqlanadi: kassada karta bilan to''langan pul naqd emas.';
