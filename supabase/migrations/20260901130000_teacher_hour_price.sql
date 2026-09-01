-- =====================================================================
--  SHAXSIY SOAT NARXI
--
--  Soat narxi butun maktabga bitta edi. Amalda esa har xil bo'ladi:
--  tajribali fan o'qituvchisi bilan to'garak rahbari bir xil haq
--  olmaydi. Ilgari bunday holatda yagona yo'l maktabning umumiy
--  narxini o'zgartirish edi va u HAMMAGA tegardi.
--
--  Endi xodimda o'z narxi bo'lishi mumkin. Bo'sh bo'lsa — maktabning
--  umumiy narxi ishlaydi, ya'ni mavjud xodimlarda hech narsa
--  o'zgarmaydi.
-- =====================================================================

alter table public.teachers
  add column if not exists hour_price numeric(12,2);

comment on column public.teachers.hour_price is
  'Shaxsiy soat narxi. Bo''sh bo''lsa maktabning umumiy narxi '
  '(payroll_settings.hour_price) ishlatiladi.';

alter table public.teachers
  drop constraint if exists teachers_hour_price_positive;
alter table public.teachers
  add constraint teachers_hour_price_positive
  check (hour_price is null or hour_price >= 0);

CREATE OR REPLACE FUNCTION public.calc_payroll(p_teacher_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  --  Oylik turi HAR XODIMGA alohida bo'lishi mumkin.
  --
  --  Maktabda bir vaqtning o'zida qat'iy oylik oladigan sinf rahbari
  --  ham, soatbay ishlaydigan to'garak rahbari ham bo'ladi. Ilgari tur
  --  butun maktabga BITTA edi va ikkinchisining oyligi noto'g'ri
  --  chiqardi. O'qituvchi kartochkasida tanlanmagan bo'lsa — maktab
  --  sozlamasi ishlatiladi.
  v_base_type   := coalesce(
    nullif(t.base_type, ''),
    app.payroll_setting(t.school_id, 'base_type', v_period,
                        '"fixed"'::jsonb) #>> '{}');
  v_hours_norm  := (app.payroll_setting(t.school_id, 'hours_per_rate', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  --  SOAT NARXI: avval xodimning shaxsiysi, keyin maktabniki.
  --
  --  Maktabda umumiy narx bo'ladi, lekin ayrim xodim boshqacha
  --  kelishadi: tajribali fan o'qituvchisi bilan to'garak rahbari
  --  bir xil soat haqi olmaydi. Ilgari bunday holatda yagona yo'l
  --  butun maktabning narxini o'zgartirish edi — u esa hammaga
  --  tegardi.
  v_hour_price  := coalesce(
    t.hour_price,
    (app.payroll_setting(t.school_id, 'hour_price', v_period,
       '0'::jsonb) #>> '{}')::numeric);
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
    'rate_factor', t.rate_factor, 'base_salary', t.base_salary,
    'base_type_per_teacher', t.base_type is not null);

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
    --  Qo'lda kiritilgan tuzatish SAQLANADI: bu funksiya faqat
    --  o'zi yaratgan qatorlarni tozalaydi. Mukofot yoki jarima
    --  formuladan kelib chiqmaydi — har qayta hisoblashda yo'qolib
    --  ketsa, uni qayta kiritish esdan chiqadi.
    delete from public.payroll_lines
     where payroll_run_id = v_run_id
       and source_kind <> 'manual';
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
    --  Soat narxi sozlanmagan bo'lsa nol chiqadi. Nol qatorni yozish
    --  o'qituvchiga "stavka: 0 so'm" deb ko'rsatadi va bu xatolikni
    --  yashiradi. Sozlama muammosi alohida tekshiruvda
    --  ogohlantirish bo'lib chiqadi (payroll_config_issues).
    if v_base <> 0 then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'base',
       'Stavka (' || app.fmt_num(v_hours_norm * t.rate_factor) || ' soat)',
       v_hours_norm * t.rate_factor, round(v_hour_price * v_cat_factor, 2), v_base, v_sort,
       jsonb_build_object('formula',
                          'hours_per_rate * rate_factor * hour_price * category_factor',
                          'hours_per_rate', v_hours_norm,
                          'rate_factor', t.rate_factor,
                          'hour_price', v_hour_price,
                          'category_factor', v_cat_factor));
    v_sort := v_sort + 1;
    end if;

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
    v_val := round(h.subst_hours * v_hour_price * v_cat_factor * v_subst_pct / 100, 2);
    if h.subst_hours > 0 and v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, h.branch_id, 'substitution',
         'O''rniga kirilgan darslar (' || app.fmt_num(v_subst_pct) || '%)',
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

      v_val := round(ent.hours * v_hour_price * v_cat_factor * v_paid_pct / 100, 2);
      if v_paid_pct > 0 and ent.hours > 0 and v_val <> 0 then
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'unheld',
           'O''tkazilmagan dars — ' || ent.reason ||
             ' (' || app.fmt_num(v_paid_pct) || '%)',
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
$function$
;
