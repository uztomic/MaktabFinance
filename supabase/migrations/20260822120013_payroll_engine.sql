-- =====================================================================
--  13 — OYLIK DVIGATELI (TZ 4.11)
--
--  ENG MUHIM QOIDA — TZ 4.11.10:
--      "Formula parametrlari kodga yozilmaydi. Stavkalar, tariflar,
--       ustamalar foizi va ushlanma stavkalari sozlamada saqlanadi va
--       maktab bo'yicha farq qilishi mumkin."
--
--  Shuning uchun bu faylda BIRORTA HAM raqam yo'q: na stavka, na foiz,
--  na tarif. Hammasi `payroll_settings` dan o'qiladi. Buxgalter
--  formulani bergach faqat o'sha jadval yangilanadi — kod o'zgarmaydi.
--
--  TZ 4.11.7 — har bir komponent ALOHIDA `payroll_lines` qatori bo'ladi
--  va `source` maydonida raqam qayerdan kelgani saqlanadi. Shu tufayli
--  qaydnomada "bu 1 200 000 qayerdan chiqdi?" degan savolga javob bor.
--
--  TZ 4.11.11 — hisoblash FAQAT SERVER TOMONDA.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O'QITUVCHIGA BIRIKTIRILGAN USTAMALAR (TZ 12.1.6)
--
--  "Qo'shimchalar: sinf rahbarligi, daftar tekshirish, to'garak —
--   qancha va qanday hisoblanadi?"
--
--  Ustamalar KATALOGI `payroll_settings.allowances` da (nomi, turi,
--  foizi). Kim qaysi ustamani oladi — shu jadvalda.
-- ---------------------------------------------------------------------

create table if not exists public.teacher_allowances (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id)  on delete cascade,
  teacher_id     uuid not null references public.teachers(id) on delete cascade,
  -- payroll_settings.allowances dagi element kodi.
  code           text not null,
  -- To'ldirilgan bo'lsa katalogdagi standart qiymatni bekor qiladi.
  value_override numeric(14,2),
  starts_on      date not null default current_date,
  ends_on        date,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.teacher_allowances is
  'TZ 12.1.6 — kim sinf rahbari, kim to''garak olib boradi. Ustama '
  'MIQDORI payroll_settings.allowances katalogidan keladi (TZ 4.11.10).';

create index if not exists teacher_allowances_teacher_idx
  on public.teacher_allowances(teacher_id, code);

select app.attach_touch_trigger('teacher_allowances');
select app.attach_audit_trigger('teacher_allowances');

-- ---------------------------------------------------------------------
-- 2. AVANSLAR (TZ 4.11.6, 12.1.8)
-- ---------------------------------------------------------------------

create table if not exists public.teacher_advances (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id)  on delete restrict,
  branch_id   uuid not null references public.branches(id) on delete restrict,
  teacher_id  uuid not null references public.teachers(id) on delete restrict,
  -- Qaysi oy oyligidan ushlab qolinadi.
  period      date not null,
  amount      numeric(14,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  note        text,
  created_by  uuid references public.app_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint teacher_advances_period_is_month
    check (period = date_trunc('month', period)::date)
);

comment on table public.teacher_advances is
  'TZ 4.11.6 — avans to''lovlari. Oylik hisobida MANFIY qator sifatida '
  'hisobga olinadi.';

create index if not exists teacher_advances_teacher_idx
  on public.teacher_advances(teacher_id, period);

select app.attach_audit_trigger('teacher_advances');
select app.attach_period_guard('teacher_advances', 'period');

-- --- RLS ------------------------------------------------------------

alter table public.teacher_allowances enable row level security;
alter table public.teacher_advances   enable row level security;

create policy teacher_allowances_select on public.teacher_allowances
  for select to authenticated
  using (school_id = app.school_id() or app.is_platform_admin());
create policy teacher_allowances_insert on public.teacher_allowances
  for insert to authenticated
  with check (school_id = app.school_id() and app.may_write('teachers.manage'));
create policy teacher_allowances_update on public.teacher_allowances
  for update to authenticated
  using (school_id = app.school_id() and app.may_write('teachers.manage'))
  with check (school_id = app.school_id() and app.may_write('teachers.manage'));

create policy teacher_advances_select on public.teacher_advances
  for select to authenticated
  using ((school_id = app.school_id() and app.can('payroll.view'))
         or app.is_platform_admin());
create policy teacher_advances_insert on public.teacher_advances
  for insert to authenticated
  with check (school_id = app.school_id() and app.may_write('payroll.manage'));

grant select, insert, update on public.teacher_allowances to authenticated;
grant select, insert         on public.teacher_advances   to authenticated;

-- =====================================================================
--  3. DAVRDAGI DARS SOATLARI
--
--  TZ 4.11.2 — bo'lib o'tgan, o'rniga kirilgan va o'tkazilmagan darslar.
--  Uchalasi ALOHIDA qaytariladi, chunki har biriga boshqa qoida
--  qo'llaniladi (TZ 12.1.4, 12.1.5).
-- =====================================================================

create or replace function app.teacher_hours(
  p_teacher_id uuid,
  p_from       date,
  p_to         date
)
returns table (
  branch_id     uuid,
  held_hours    numeric,
  subst_hours   numeric,
  unheld_hours  numeric,
  unheld_detail jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.branch_id,
    coalesce(sum(l.hours) filter (where l.kind = 'held'), 0)        as held_hours,
    coalesce(sum(l.hours) filter (where l.kind = 'substituted'), 0) as subst_hours,
    coalesce(sum(l.hours) filter (where l.kind = 'not_held'), 0)    as unheld_hours,
    -- Sabab bo'yicha taqsimot — to'lash qoidasi sababga bog'liq
    -- (TZ 12.1.5: bayram boshqa, o'qituvchi kelmagani boshqa).
    coalesce((
      select jsonb_object_agg(t.reason, t.hours)
        from (
          select coalesce(l2.reason, 'unspecified') as reason,
                 sum(l2.hours) as hours
            from public.lessons l2
           where l2.teacher_id = p_teacher_id
             and l2.branch_id = l.branch_id
             and l2.day between p_from and p_to
             and l2.kind = 'not_held'
           group by 1
        ) t
    ), '{}'::jsonb) as unheld_detail
  from public.lessons l
  where l.teacher_id = p_teacher_id
    and l.day between p_from and p_to
  group by l.branch_id;
$$;

comment on function app.teacher_hours(uuid, date, date) is
  'TZ 4.11.2 — filial kesimida bo''lib o''tgan, o''rniga kirilgan va '
  'o''tkazilmagan soatlar. O''tkazilmaganlar sabab bo''yicha ajratiladi.';

-- =====================================================================
--  4. OYLIK HISOBI (TZ 4.11.3)
--
--  Barcha parametr `payroll_settings` dan. Standart qiymatlar
--  16-migratsiyada seed qilinadi va buxgalter ularni o'zgartiradi.
-- =====================================================================

create or replace function public.calc_payroll(
  p_teacher_id uuid,
  p_period     date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t             public.teachers%rowtype;
  v_period      date := date_trunc('month', p_period)::date;
  v_month_end   date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_from        date;
  v_to          date;
  v_run_id      uuid;
  v_primary_br  uuid;

  -- Sozlamalar (TZ 4.11.10 — hammasi bazadan)
  v_base_type   text;
  v_hours_norm  numeric;
  v_hour_price  numeric;
  v_cat_factors jsonb;
  v_cat_factor  numeric;
  v_subst_pct   numeric;
  v_unheld_pol  jsonb;
  v_allowances  jsonb;
  v_deductions  jsonb;
  v_rounding    jsonb;
  v_period_cfg  jsonb;
  v_snapshot    jsonb;

  h             record;
  a             jsonb;
  d             jsonb;
  al            record;
  ent           record;

  v_base        numeric(14,2) := 0;
  v_gross       numeric(14,2) := 0;
  v_sort        smallint := 0;
  v_val         numeric(14,2);
  v_hours_total numeric := 0;
  v_paid_pct    numeric;
  v_net         numeric(14,2);
  v_rounded     numeric(14,2);
begin
  select * into t from public.teachers where id = p_teacher_id and deleted_at is null;
  if not found then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payroll.manage');
  perform app.assert_period_open(t.school_id, v_period, null);

  -- --- Sozlamalarni o'qish ------------------------------------------
  v_period_cfg  := app.payroll_setting(t.school_id, 'period', v_period,
                     '{"start_day":1,"end_day":0}'::jsonb);
  v_base_type   := app.payroll_setting(t.school_id, 'base_type', v_period,
                     '"fixed"'::jsonb) #>> '{}';
  v_hours_norm  := (app.payroll_setting(t.school_id, 'hours_per_rate', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  v_hour_price  := (app.payroll_setting(t.school_id, 'hour_price', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  v_cat_factors := app.payroll_setting(t.school_id, 'category_factors', v_period, '{}'::jsonb);
  v_subst_pct   := (app.payroll_setting(t.school_id, 'substitution_percent', v_period,
                     '100'::jsonb) #>> '{}')::numeric;
  v_unheld_pol  := app.payroll_setting(t.school_id, 'unheld_lesson_policy', v_period, '{}'::jsonb);
  v_allowances  := app.payroll_setting(t.school_id, 'allowances', v_period, '[]'::jsonb);
  v_deductions  := app.payroll_setting(t.school_id, 'deductions', v_period, '[]'::jsonb);
  v_rounding    := app.payroll_setting(t.school_id, 'rounding', v_period,
                     '{"step":1,"mode":"nearest"}'::jsonb);

  -- TZ 12.1.10 — hisob davri qaysi sanadan qaysi sanagacha.
  v_from := v_period + ((v_period_cfg ->> 'start_day')::int - 1);
  v_to   := case when coalesce((v_period_cfg ->> 'end_day')::int, 0) = 0
                 then v_month_end
                 else v_period + ((v_period_cfg ->> 'end_day')::int - 1) end;

  -- TZ 12.1.3 — soat narxi toifa yoki stajga bog'liq bo'lishi mumkin.
  v_cat_factor := coalesce((v_cat_factors ->> coalesce(t.category, ''))::numeric, 1);

  v_snapshot := jsonb_build_object(
    'base_type', v_base_type, 'hours_per_rate', v_hours_norm,
    'hour_price', v_hour_price, 'category', t.category,
    'category_factor', v_cat_factor, 'substitution_percent', v_subst_pct,
    'unheld_lesson_policy', v_unheld_pol, 'allowances', v_allowances,
    'deductions', v_deductions, 'rounding', v_rounding,
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'rate_factor', t.rate_factor, 'base_salary', t.base_salary);

  -- --- Hisob yozuvi (idempotent: qayta hisoblasa qatorlar quriladi) --
  select id into v_run_id
    from public.payroll_runs
   where teacher_id = p_teacher_id and period = v_period and status <> 'cancelled';

  if v_run_id is null then
    insert into public.payroll_runs
      (school_id, teacher_id, period, status, period_from, period_to, settings_snapshot)
    values
      (t.school_id, p_teacher_id, v_period, 'draft', v_from, v_to, v_snapshot)
    returning id into v_run_id;
  else
    -- TZ 4.11.8 — tasdiqlangan hisob qayta hisoblanmaydi.
    if exists (select 1 from public.payroll_runs where id = v_run_id and status = 'approved') then
      raise exception 'Oylik allaqachon tasdiqlangan — qayta hisoblab bo''lmaydi (TZ 4.11.8)'
        using errcode = '42501';
    end if;
    delete from public.payroll_lines where payroll_run_id = v_run_id;
    update public.payroll_runs
       set settings_snapshot = v_snapshot, calculated_at = now(),
           period_from = v_from, period_to = v_to
     where id = v_run_id;
  end if;

  select branch_id into v_primary_br
    from public.teacher_branches
   where teacher_id = p_teacher_id
   order by load_share desc limit 1;

  select coalesce(sum(held_hours + subst_hours), 0) into v_hours_total
    from app.teacher_hours(p_teacher_id, v_from, v_to);

  -- =================================================================
  --  1-QISM: ASOSIY HAQ (TZ 12.1.1 — qat'iy / stavka / soatbay / aralash)
  -- =================================================================

  if v_base_type = 'fixed' then
    v_base := round(t.base_salary * t.rate_factor, 2);
    if v_base > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy oylik',
         t.rate_factor, t.base_salary, v_base, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor',
                            'base_salary', t.base_salary,
                            'rate_factor', t.rate_factor));
      v_sort := v_sort + 1;
    end if;

  elsif v_base_type = 'rate' then
    -- Stavka bo'yicha: norma soat × stavka ulushi × soat narxi × toifa.
    v_base := round(v_hours_norm * t.rate_factor * v_hour_price * v_cat_factor, 2);
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'base',
       'Stavka (' || trim(to_char(v_hours_norm * t.rate_factor, 'FM999990.99')) || ' soat)',
       v_hours_norm * t.rate_factor, round(v_hour_price * v_cat_factor, 2), v_base, v_sort,
       jsonb_build_object('formula',
                          'hours_per_rate * rate_factor * hour_price * category_factor',
                          'hours_per_rate', v_hours_norm,
                          'rate_factor', t.rate_factor,
                          'hour_price', v_hour_price,
                          'category_factor', v_cat_factor));
    v_sort := v_sort + 1;

  else
    -- 'hourly' va 'mixed': haqiqiy o'tilgan soatlar, FILIAL KESIMIDA
    -- (TZ 4.11.4 — bir nechta filialda ishlagan xodim).
    for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
    loop
      if h.held_hours > 0 then
        v_val := round(h.held_hours * v_hour_price * v_cat_factor, 2);
        v_base := v_base + v_val;
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'lessons', 'O''tilgan darslar',
           h.held_hours, round(v_hour_price * v_cat_factor, 2), v_val, v_sort,
           jsonb_build_object('formula', 'held_hours * hour_price * category_factor',
                              'held_hours', h.held_hours,
                              'hour_price', v_hour_price,
                              'category_factor', v_cat_factor,
                              'from', v_from, 'to', v_to));
        v_sort := v_sort + 1;
      end if;
    end loop;

    -- 'mixed': qat'iy qism ham qo'shiladi.
    if v_base_type = 'mixed' and t.base_salary > 0 then
      v_val := round(t.base_salary * t.rate_factor, 2);
      v_base := v_base + v_val;
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy qism',
         t.rate_factor, t.base_salary, v_val, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor'));
      v_sort := v_sort + 1;
    end if;
  end if;

  -- =================================================================
  --  2-QISM: O'RNIGA KIRILGAN VA O'TKAZILMAGAN DARSLAR
  --          (TZ 12.1.4, 12.1.5)
  -- =================================================================

  for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
  loop
    -- --- O'rniga kirilgan darslar (TZ 12.1.4) -----------------------
    if h.subst_hours > 0 then
      v_val := round(h.subst_hours * v_hour_price * v_cat_factor * v_subst_pct / 100, 2);
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, h.branch_id, 'substitution',
         'O''rniga kirilgan darslar (' || trim(to_char(v_subst_pct, 'FM990.9')) || '%)',
         h.subst_hours,
         round(v_hour_price * v_cat_factor * v_subst_pct / 100, 2), v_val, v_sort,
         jsonb_build_object('formula',
                            'subst_hours * hour_price * category_factor * substitution_percent / 100',
                            'subst_hours', h.subst_hours,
                            'substitution_percent', v_subst_pct));
      v_sort := v_sort + 1;
    end if;

    -- --- O'tkazilmagan darslar (TZ 12.1.5) --------------------------
    -- Bayram/karantin to'lanishi va o'qituvchi kelmagani to'lanmasligi
    -- SOZLAMADA belgilanadi — kodda emas.
    for ent in select key as reason, value::text::numeric as hours
                 from jsonb_each(h.unheld_detail)
    loop
      v_paid_pct := coalesce(
        (v_unheld_pol -> ent.reason ->> 'paid_percent')::numeric,
        (v_unheld_pol -> 'default'   ->> 'paid_percent')::numeric,
        0);

      if v_paid_pct > 0 and ent.hours > 0 then
        v_val := round(ent.hours * v_hour_price * v_cat_factor * v_paid_pct / 100, 2);
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'unheld',
           'O''tkazilmagan dars — ' || ent.reason ||
             ' (' || trim(to_char(v_paid_pct, 'FM990.9')) || '%)',
           ent.hours,
           round(v_hour_price * v_cat_factor * v_paid_pct / 100, 2), v_val, v_sort,
           jsonb_build_object('reason', ent.reason, 'paid_percent', v_paid_pct,
                              'hours', ent.hours));
        v_sort := v_sort + 1;
      end if;
    end loop;
  end loop;

  -- Ustama bazasi — shu paytgacha yig'ilgan musbat summa.
  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- =================================================================
  --  3-QISM: USTAMALAR (TZ 12.1.6)
  -- =================================================================

  for al in
    select ta.code, ta.value_override
      from public.teacher_allowances ta
     where ta.teacher_id = p_teacher_id
       and ta.starts_on <= v_to
       and (ta.ends_on is null or ta.ends_on >= v_from)
     order by ta.code
  loop
    a := null;
    select value into a
      from jsonb_array_elements(v_allowances) value
     where value ->> 'code' = al.code
     limit 1;

    if a is null then
      continue;  -- katalogda yo'q ustama e'tiborsiz qoldiriladi
    end if;

    v_val := case
      when coalesce(a ->> 'type', 'fixed') = 'percent'
        then round(v_gross * coalesce(al.value_override, (a ->> 'value')::numeric) / 100, 2)
      else round(coalesce(al.value_override, (a ->> 'value')::numeric), 2)
    end;

    if v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'allowance',
         coalesce(a ->> 'name', al.code), 1, v_val, v_val, v_sort,
         jsonb_build_object('code', al.code,
                            'type', a ->> 'type',
                            'value', coalesce(al.value_override, (a ->> 'value')::numeric),
                            'base', case when coalesce(a ->> 'type', 'fixed') = 'percent'
                                         then v_gross else null end,
                            'overridden', al.value_override is not null));
      v_sort := v_sort + 1;
    end if;
  end loop;

  -- Ushlanma bazasi — barcha musbat qatorlar (TZ 12.1.7).
  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- =================================================================
  --  4-QISM: USHLANMALAR (TZ 4.11.5, 12.1.7) — MANFIY QATORLAR
  -- =================================================================

  for d in select value from jsonb_array_elements(v_deductions) value
  loop
    v_val := case
      when coalesce(d ->> 'type', 'percent') = 'percent'
        then round(v_gross * (d ->> 'value')::numeric / 100, 2)
      else round((d ->> 'value')::numeric, 2)
    end;

    if v_val > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'deduction',
         coalesce(d ->> 'name', d ->> 'code'), 1, -v_val, -v_val, v_sort,
         jsonb_build_object('code', d ->> 'code', 'type', d ->> 'type',
                            'value', (d ->> 'value')::numeric,
                            'base', v_gross));
      v_sort := v_sort + 1;
    end if;
  end loop;

  -- =================================================================
  --  5-QISM: AVANS (TZ 4.11.6) — MANFIY QATOR
  -- =================================================================

  for al in
    select adv.id, adv.amount, adv.paid_on, adv.branch_id
      from public.teacher_advances adv
     where adv.teacher_id = p_teacher_id and adv.period = v_period
     order by adv.paid_on
  loop
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, al.branch_id, 'advance',
       'Avans (' || to_char(al.paid_on, 'DD.MM.YYYY') || ')',
       1, -al.amount, -al.amount, v_sort,
       jsonb_build_object('advance_id', al.id, 'paid_on', al.paid_on));
    v_sort := v_sort + 1;
  end loop;

  -- =================================================================
  --  6-QISM: YAXLITLASH (TZ 12.1.9)
  -- =================================================================

  select coalesce(sum(amount), 0) into v_net
    from public.payroll_lines where payroll_run_id = v_run_id;

  v_rounded := app.round_money(
    v_net,
    coalesce((v_rounding ->> 'step')::numeric, 1),
    coalesce(v_rounding ->> 'mode', 'nearest'));

  if v_rounded <> v_net then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'rounding', 'Yaxlitlash',
       1, v_rounded - v_net, v_rounded - v_net, 99,
       jsonb_build_object('before', v_net, 'after', v_rounded,
                          'step', v_rounding ->> 'step',
                          'mode', v_rounding ->> 'mode'));
  end if;

  return jsonb_build_object(
    'payroll_run_id', v_run_id,
    'teacher_id',     p_teacher_id,
    'period',         v_period,
    'period_from',    v_from,
    'period_to',      v_to,
    'gross',          v_gross,
    'net',            v_rounded,
    'hours',          v_hours_total);
end;
$$;

comment on function public.calc_payroll(uuid, date) is
  'TZ 4.11.3 — oylik summani formula asosida hisoblaydi. Formulaning '
  'BARCHA parametri payroll_settings dan olinadi (TZ 4.11.10). Har bir '
  'komponent alohida qator bo''lib, source maydonida qayerdan kelgani '
  'saqlanadi (TZ 4.11.7).';

-- =====================================================================
--  5. GURUH BO'YICHA HISOBLASH
--
--  TZ 5.7 — 100 xodim uchun 30 soniyagacha.
-- =====================================================================

create or replace function public.calc_payroll_batch(p_period date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  r        record;
  v_ok     int := 0;
  v_fail   int := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  perform app.assert_may_write('payroll.manage');

  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;

  for r in
    select id, full_name from public.teachers
     where school_id = v_school and is_active and deleted_at is null
     order by full_name
  loop
    begin
      perform public.calc_payroll(r.id, p_period);
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_object('teacher', r.full_name, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('calculated', v_ok, 'failed', v_fail, 'errors', v_errors);
end;
$$;

-- =====================================================================
--  6. TASDIQLASH VA AVTOMATIK XARAJAT (TZ 4.11.8, 4.11.9, 4.10.2)
--
--  Oylik xarajat sifatida QO'LDA KIRITILMAYDI — u shu yerda avtomatik
--  yaratiladi. Bir nechta filialda ishlagan xodim uchun summa filiallar
--  bo'yicha ULUSHGA MUVOFIQ taqsimlanadi, qoldiq esa asosiy filialga
--  qo'shiladi — shunda filiallar yig'indisi jamlangan summaga ANIQ
--  teng bo'ladi (TZ 4.12.4).
-- =====================================================================

create or replace function public.approve_payroll(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          public.payroll_runs%rowtype;
  v_net      numeric(14,2);
  v_cat      uuid;
  v_teacher  text;
  v_expense  uuid;
  sh         record;
  v_total_sh numeric := 0;
  v_alloc    numeric(14,2) := 0;
  v_amount   numeric(14,2);
  v_primary  uuid;
  v_count    int := 0;
begin
  select * into r from public.payroll_runs where id = p_run_id;
  if not found then
    raise exception 'Oylik hisobi topilmadi' using errcode = '22023';
  end if;
  if r.status = 'approved' then
    raise exception 'Bu hisob allaqachon tasdiqlangan' using errcode = '22023';
  end if;

  perform app.assert_may_write('payroll.approve');
  perform app.assert_period_open(r.school_id, r.period, null);

  select net_total into v_net from public.v_payroll_totals where payroll_run_id = p_run_id;
  select full_name into v_teacher from public.teachers where id = r.teacher_id;

  if coalesce(v_net, 0) <= 0 then
    -- Nol yoki manfiy oylik uchun xarajat yozuvi yaratilmaydi.
    update public.payroll_runs
       set status = 'approved', approved_at = now(), approved_by = (select auth.uid())
     where id = p_run_id;
    return jsonb_build_object('payroll_run_id', p_run_id,
                              'net', coalesce(v_net, 0), 'expenses_created', 0);
  end if;

  select id into v_cat from public.expense_categories
   where school_id = r.school_id and code = 'salary' limit 1;

  if v_cat is null then
    insert into public.expense_categories (school_id, code, name, is_system)
    values (r.school_id, 'salary', 'Ish haqi', true)
    returning id into v_cat;
  end if;

  select branch_id into v_primary
    from public.teacher_branches where teacher_id = r.teacher_id
    order by load_share desc limit 1;

  select coalesce(sum(load_share), 0) into v_total_sh
    from public.teacher_branches where teacher_id = r.teacher_id;

  if v_total_sh <= 0 or v_primary is null then
    raise exception 'O''qituvchiga filial biriktirilmagan — xarajat taqsimlanmaydi'
      using errcode = '22023';
  end if;

  for sh in
    select branch_id, load_share
      from public.teacher_branches
     where teacher_id = r.teacher_id
     -- Asosiy filial OXIRIDA: qoldiq unga tushadi.
     order by (branch_id = v_primary), branch_id
  loop
    v_count := v_count + 1;

    if sh.branch_id = v_primary then
      v_amount := v_net - v_alloc;
    else
      v_amount := round(v_net * sh.load_share / v_total_sh, 2);
      v_alloc := v_alloc + v_amount;
    end if;

    if v_amount > 0 then
      insert into public.expenses
        (school_id, branch_id, category_id, amount, spent_on, payment_method,
         note, payroll_run_id, created_by)
      values
        (r.school_id, sh.branch_id, v_cat, v_amount, r.period_to, 'bank',
         'Oylik: ' || v_teacher || ' (' || to_char(r.period, 'MM.YYYY') || ')',
         p_run_id, (select auth.uid()))
      returning id into v_expense;
    end if;
  end loop;

  update public.payroll_runs
     set status = 'approved', approved_at = now(),
         approved_by = (select auth.uid()), expense_id = v_expense
   where id = p_run_id;

  return jsonb_build_object(
    'payroll_run_id', p_run_id, 'net', v_net, 'expenses_created', v_count);
end;
$$;

comment on function public.approve_payroll(uuid) is
  'TZ 4.11.9 — tasdiqlangan oylik AVTOMATIK xarajat sifatida qayd '
  'etiladi (TZ 4.10.2 — qo''lda kiritilmaydi). Bir nechta filialda '
  'ishlaganda summa ulushga muvofiq taqsimlanadi va filiallar yig''indisi '
  'jamlangan summaga aniq teng bo''ladi (TZ 4.12.4).';

-- Avtomatik yaratilgan xarajatni qo'lda o'zgartirib bo'lmaydi (TZ 4.10.2).
create or replace function app.guard_payroll_expense()
returns trigger
language plpgsql
as $$
begin
  if coalesce(old.payroll_run_id, new.payroll_run_id) is not null
     and not app.is_service_context() then
    raise exception
      'Bu xarajat oylik hisobidan avtomatik yaratilgan va qo''lda o''zgartirilmaydi (TZ 4.10.2)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_expenses_guard_payroll on public.expenses;
create trigger trg_expenses_guard_payroll
  before update on public.expenses
  for each row execute function app.guard_payroll_expense();

do $do$
declare f text;
begin
  foreach f in array array[
    'public.calc_payroll(uuid, date)',
    'public.calc_payroll_batch(date)',
    'public.approve_payroll(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

grant execute on function app.teacher_hours(uuid, date, date) to authenticated, service_role;
