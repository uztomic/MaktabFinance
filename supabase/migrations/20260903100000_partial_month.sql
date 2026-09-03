-- =====================================================================
--  OY O'RTASIDA KELGAN O'QUVCHI — TO'LIQ OYMI YOKI KUNLAR BO'YICHAMI?
--
--  3-sentabrda qo'shilgan o'quvchiga 1 600 000 o'rniga 1 493 333
--  hisoblandi: 28 kun / 30 kun. Hisob to'g'ri edi, lekin QOIDA
--  kodda qat'iy yozilgan edi va maktabdan so'ralmagan.
--
--  Amalda ikkala yo'l ham uchraydi. Ko'p maktab oy o'rtasida
--  kelgan bolaga ham to'liq oylik yozadi — o'rin band qilingan,
--  o'qituvchi ishlagan. Boshqalari esa kunlab hisoblaydi.
--
--  Endi bu sozlama: `billing.partial_month`
--     "prorate" — kunlar bo'yicha (avvalgidek, standart)
--     "full"    — to'liq oy
--
--  Standart qiymat o'zgarmadi: mavjud maktablarda hisob avvalgidek
--  qoladi.
--
--  UCHALA joyda ham bir xil qo'llanadi — hisoblanma, bitta oy
--  summasi va davr prognozi. Aks holda hisoblanma bir xil, prognoz
--  boshqacha chiqib, qaysi biri to'g'ri ekani noma'lum bo'lardi.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.generate_invoices(p_branch_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_school     uuid;
  v_period     date := date_trunc('month', p_period)::date;
  v_month_end  date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_month_days int  := extract(day from (date_trunc('month', p_period) + interval '1 month - 1 day'))::int;

  r            record;
  s            record;

  v_invoice_id uuid;
  v_from       date;
  v_to         date;
  v_covered    int;
  v_tuition    numeric(14,2);
  v_disc_kind  public.discount_kind;
  v_disc_value numeric;
  v_discount   numeric(14,2);
  v_price      numeric(14,2);
  v_qty        numeric(10,2);
  v_amount     numeric(14,2);
  v_svc_from   date;
  v_svc_to     date;
  v_sort       smallint;

  v_partial    text;
  v_created    int := 0;
  v_rebuilt    int := 0;
  v_locked     int := 0;
  v_skipped    int := 0;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  if v_school is null then
    raise exception 'Filial topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('invoices.generate');
  perform app.assert_branch(p_branch_id);
  perform app.assert_period_open(v_school, v_period, p_branch_id);

  --  Oy o'rtasida kelgan yoki ketgan o'quvchi: to'liq oy uchunmi
  --  yoki kunlar bo'yichami? Maktab qaroriga bog'liq, shuning
  --  uchun kodda emas, sozlamada.
  v_partial := coalesce(
    app.school_setting(v_school, 'billing.partial_month',
                       '"prorate"'::jsonb) #>> '{}', 'prorate');

  for r in
    select st.id            as student_id,
           st.branch_id,
           st.enrolled_on,
           st.left_on,
           c.id             as contract_id,
           c.tuition_amount,
           c.starts_on,
           c.ends_on,
           c.due_day,
           c.billing_months
      from public.students st
      join public.contracts c
        on c.student_id = st.id and c.is_active
     where st.branch_id = p_branch_id
       and st.deleted_at is null
       -- TZ 4.3.6 — akademik ta'tilda hisoblanma shakllantirilmaydi.
       and st.status = 'active'
     order by st.class_name, st.full_name
  loop
    -- --- Davr chegaralari: o'quvchi va shartnoma bilan kesishma ------
    v_from := greatest(v_period,   r.starts_on, coalesce(r.enrolled_on, v_period));
    v_to   := least(v_month_end,
                    coalesce(r.ends_on, v_month_end),
                    coalesce(r.left_on, v_month_end));

    if v_to < v_from then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if not app.is_billable_month(v_school, r.billing_months, v_period) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_covered := (v_to - v_from) + 1;

    -- --- Hisoblanma sarlavhasi (TZ 4.6.8 — dublikat yaratilmaydi) ----
    select id into v_invoice_id
      from public.invoices
     where student_id = r.student_id and period = v_period and status <> 'cancelled';

    if v_invoice_id is null then
      insert into public.invoices
        (school_id, branch_id, student_id, contract_id, period, status, due_date)
      values
        (v_school, r.branch_id, r.student_id, r.contract_id, v_period, 'preliminary',
         v_period + (r.due_day - 1))
      returning id into v_invoice_id;
      v_created := v_created + 1;
    else
      -- TZ 4.6.7 — tasdiqlangan hisoblanma QULFLANGAN.
      if exists (select 1 from public.invoices
                  where id = v_invoice_id and status = 'approved') then
        v_locked := v_locked + 1;
        continue;
      end if;
      -- TZ 4.6.6 — tasdiqlanmagan hisoblanma qayta quriladi.
      -- O'chirish audit jurnaliga tushadi (before qiymati saqlanadi).
      delete from public.invoice_lines where invoice_id = v_invoice_id;
      v_rebuilt := v_rebuilt + 1;
    end if;

    v_sort := 0;

    -- --- 1) O'qish to'lovi (TZ 4.6.5 — proporsional) -----------------
    if r.tuition_amount > 0 then
      if v_covered >= v_month_days or v_partial = 'full' then
        v_tuition := r.tuition_amount;
        v_qty := 1;
        v_price := r.tuition_amount;
      else
        -- Oy o'rtasida qo'shilgan yoki chiqqan o'quvchi.
        v_price := round(r.tuition_amount / v_month_days, 2);
        v_qty := v_covered;
        v_tuition := round(r.tuition_amount * v_covered / v_month_days, 2);
      end if;

      insert into public.invoice_lines
        (school_id, invoice_id, kind, description, quantity, unit_price, amount, sort_order, source)
      values
        (v_school, v_invoice_id, 'tuition', 'O''qish to''lovi',
         v_qty, v_price, v_tuition, v_sort,
         jsonb_build_object(
           'contract_id', r.contract_id,
           'month_days', v_month_days,
           'covered_days', v_covered,
           'from', v_from, 'to', v_to));
      v_sort := v_sort + 1;
    else
      v_tuition := 0;
    end if;

    -- --- 2) Qo'shimcha xizmatlar (TZ 4.4, 4.6.4) ---------------------
    for s in
      select sv.id as service_id, sv.name, sv.billing_type,
             ss.starts_on as sub_from, ss.ends_on as sub_to
        from public.student_services ss
        join public.services sv on sv.id = ss.service_id
       where ss.student_id = r.student_id
         and sv.is_active
         and sv.deleted_at is null
         and ss.starts_on <= v_to
         and (ss.ends_on is null or ss.ends_on >= v_from)
       order by sv.sort_order, sv.name
    loop
      v_svc_from := greatest(v_from, s.sub_from);
      v_svc_to   := least(v_to, coalesce(s.sub_to, v_to));
      if v_svc_to < v_svc_from then
        continue;
      end if;

      -- TZ 4.4.5 — davr boshida amal qilgan narx. Bugun narx o'zgarsa
      -- ham o'tgan davr hisoblanmasi o'zgarmaydi.
      v_price := app.service_price_on(s.service_id, v_period);
      if v_price is null then
        continue;  -- narx belgilanmagan xizmat hisoblanmaga tushmaydi
      end if;

      if s.billing_type = 'monthly_fixed' then
        -- To'liq summa, foydalanishdan qat'i nazar (TZ 4.4.1).
        if (v_svc_to - v_svc_from) + 1 >= v_month_days then
          v_qty := 1; v_amount := v_price;
        else
          v_qty := (v_svc_to - v_svc_from) + 1;
          v_amount := round(v_price * v_qty / v_month_days, 2);
          v_price := round(v_price / v_month_days, 2);
        end if;

        insert into public.invoice_lines
          (school_id, invoice_id, kind, service_id, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (v_school, v_invoice_id, 'service', s.service_id, s.name,
           v_qty, v_price, v_amount, v_sort,
           jsonb_build_object('billing_type', 'monthly_fixed',
                              'from', v_svc_from, 'to', v_svc_to));

      elsif s.billing_type = 'daily' then
        -- TZ 4.6.1 — oy boshida DASTLABKI (taxminiy) summa: ish kunlari
        -- bo'yicha. Oy oxirida finalize_invoices yo'qlik asosida
        -- qayta hisoblaydi.
        v_qty := app.working_days(v_school, r.branch_id, v_svc_from, v_svc_to);
        v_amount := round(v_price * v_qty, 2);

        insert into public.invoice_lines
          (school_id, invoice_id, kind, service_id, description,
           quantity, unit_price, amount, is_preliminary, sort_order, source)
        values
          (v_school, v_invoice_id, 'service', s.service_id,
           s.name || ' (dastlabki)',
           v_qty, v_price, v_amount, true, v_sort,
           jsonb_build_object('billing_type', 'daily', 'stage', 'preliminary',
                              'working_days', v_qty,
                              'from', v_svc_from, 'to', v_svc_to));

      else -- one_time
        -- Faqat yozilish sanasi shu davrga tushsa (TZ 4.4.1).
        if s.sub_from between v_from and v_to then
          insert into public.invoice_lines
            (school_id, invoice_id, kind, service_id, description,
             quantity, unit_price, amount, sort_order, source)
          values
            (v_school, v_invoice_id, 'service', s.service_id, s.name,
             1, v_price, v_price, v_sort,
             jsonb_build_object('billing_type', 'one_time', 'on', s.sub_from));
        else
          continue;
        end if;
      end if;

      v_sort := v_sort + 1;
    end loop;

    -- --- 3) Chegirma (TZ 4.6.2 misolidagidek alohida MANFIY qator) ---
    select kind, value into v_disc_kind, v_disc_value
      from app.contract_discount(r.contract_id);

    if v_disc_kind is not null and coalesce(v_disc_value, 0) > 0 and v_tuition > 0 then
      v_discount := case
        when v_disc_kind = 'percent' then round(v_tuition * v_disc_value / 100, 2)
        else least(v_disc_value, v_tuition)
      end;

      if v_discount > 0 then
        insert into public.invoice_lines
          (school_id, invoice_id, kind, description, quantity, unit_price, amount, sort_order, source)
        values
          (v_school, v_invoice_id, 'discount',
           'Chegirma' ||
             case when v_disc_kind = 'percent'
                  then ' (' || trim(to_char(v_disc_value, 'FM999990.99')) || '%)'
                  else '' end,
           1, -v_discount, -v_discount, v_sort,
           jsonb_build_object('kind', v_disc_kind, 'value', v_disc_value,
                              'base', v_tuition));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'period',    v_period,
    'branch_id', p_branch_id,
    'created',   v_created,
    'rebuilt',   v_rebuilt,
    'locked',    v_locked,
    'skipped',   v_skipped);
end;
$function$
;

CREATE OR REPLACE FUNCTION app.student_month_amount(p_student_id uuid, p_period date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r            record;
  sv           record;
  v_school     uuid;
  v_period     date := date_trunc('month', p_period)::date;
  v_month_end  date := (date_trunc('month', p_period)
                        + interval '1 month - 1 day')::date;
  v_month_days int  := extract(day from (date_trunc('month', p_period)
                        + interval '1 month - 1 day'))::int;
  v_from       date;
  v_to         date;
  v_covered    int;
  v_partial    text;
  v_tuition    numeric(14,2) := 0;
  v_svc        numeric(14,2) := 0;
  v_disc       numeric(14,2) := 0;
  v_price      numeric(14,2);
  v_qty        numeric(10,2);
  v_svc_from   date;
  v_svc_to     date;
  v_disc_kind  public.discount_kind;
  v_disc_value numeric;
begin
  select st.school_id, st.branch_id, st.enrolled_on, st.left_on,
         c.id as contract_id, c.tuition_amount, c.starts_on, c.ends_on,
         c.billing_months
    into r
    from public.students st
    join public.contracts c on c.student_id = st.id and c.is_active
   where st.id = p_student_id and st.deleted_at is null;

  if not found then return 0; end if;
  v_school := r.school_id;

  v_from := greatest(v_period, r.starts_on,
                     coalesce(r.enrolled_on, v_period));
  v_to   := least(v_month_end,
                  coalesce(r.ends_on, v_month_end),
                  coalesce(r.left_on, v_month_end));

  if v_to < v_from then return 0; end if;
  if not app.is_billable_month(v_school, r.billing_months, v_period) then
    return 0;
  end if;

  v_covered := (v_to - v_from) + 1;

  v_partial := coalesce(
    app.school_setting(v_school, 'billing.partial_month',
                       '"prorate"'::jsonb) #>> '{}', 'prorate');

  if r.tuition_amount > 0 then
    v_tuition := case
      when v_covered >= v_month_days or v_partial = 'full'
      then r.tuition_amount
      else round(r.tuition_amount * v_covered / v_month_days, 2)
    end;
  end if;

  for sv in
    select s2.id as service_id, s2.billing_type,
           ss.starts_on as sub_from, ss.ends_on as sub_to
      from public.student_services ss
      join public.services s2 on s2.id = ss.service_id
     where ss.student_id = p_student_id
       and s2.is_active and s2.deleted_at is null
       and ss.starts_on <= v_to
       and (ss.ends_on is null or ss.ends_on >= v_from)
  loop
    v_svc_from := greatest(v_from, sv.sub_from);
    v_svc_to   := least(v_to, coalesce(sv.sub_to, v_to));
    if v_svc_to < v_svc_from then continue; end if;

    v_price := app.service_price_on(sv.service_id, v_period);
    if v_price is null then continue; end if;

    if sv.billing_type = 'monthly_fixed' then
      v_svc := v_svc + case
        when (v_svc_to - v_svc_from) + 1 >= v_month_days then v_price
        else round(v_price * ((v_svc_to - v_svc_from) + 1) / v_month_days, 2)
      end;
    elsif sv.billing_type = 'daily' then
      v_qty := app.working_days(v_school, r.branch_id, v_svc_from, v_svc_to);
      v_svc := v_svc + round(v_price * v_qty, 2);
    else
      if sv.sub_from between v_from and v_to then
        v_svc := v_svc + v_price;
      end if;
    end if;
  end loop;

  select kind, value into v_disc_kind, v_disc_value
    from app.contract_discount(r.contract_id);

  if v_disc_kind is not null and coalesce(v_disc_value, 0) > 0
     and v_tuition > 0 then
    v_disc := case
      when v_disc_kind = 'percent' then round(v_tuition * v_disc_value / 100, 2)
      else least(v_disc_value, v_tuition)
    end;
  end if;

  return v_tuition + v_svc - v_disc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.period_forecast(p_branch_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_school     uuid;
  v_period     date := date_trunc('month', p_period)::date;
  v_month_end  date := (date_trunc('month', p_period)
                        + interval '1 month - 1 day')::date;
  v_month_days int  := extract(day from (date_trunc('month', p_period)
                        + interval '1 month - 1 day'))::int;
  r            record;
  sv           record;
  v_from       date;
  v_to         date;
  v_covered    int;

  --  Bitta o'quvchi bo'yicha.
  v_tuition    numeric(14,2);
  v_stu_svc    numeric(14,2);
  v_stu_disc   numeric(14,2);
  v_stu_total  numeric(14,2);
  v_price      numeric(14,2);
  v_qty        numeric(10,2);
  v_svc_from   date;
  v_svc_to     date;
  v_disc_kind  public.discount_kind;
  v_disc_value numeric;

  --  Nega hisoblanmaydi.
  v_partial     text;
  v_ok          int := 0;
  v_not_started int := 0;
  v_ended       int := 0;
  v_left        int := 0;
  v_summer      int := 0;
  v_no_contract int := 0;
  v_first       date;

  --  Daromad.
  v_sum_tuition  numeric(14,2) := 0;
  v_sum_service  numeric(14,2) := 0;
  v_sum_discount numeric(14,2) := 0;

  --  Sinf kesimi. Jadval emas, jsonb: sinflar soni kichik va panelga
  --  bitta so'rov bilan boradi.
  v_by_class jsonb := '{}'::jsonb;
  v_classes  jsonb;
  v_cls      text;
  v_row      jsonb;

  --  Oylik.
  v_pay_net      numeric(14,2) := 0;
  v_pay_runs     int := 0;
  v_pay_teachers int := 0;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  if v_school is null then
    raise exception 'Filial topilmadi' using errcode = '22023';
  end if;
  perform app.assert_branch(p_branch_id);

  v_partial := coalesce(
    app.school_setting(v_school, 'billing.partial_month',
                       '"prorate"'::jsonb) #>> '{}', 'prorate');

  --  Faol shartnomasi yo'qlar: `generate_invoices` ularni INNER JOIN
  --  sababli umuman ko'rmaydi, shuning uchun "o'tkazib yuborildi"
  --  soniga ham tushmaydi. Eng jimgina yo'qoladigan hol.
  select count(*) into v_no_contract
    from public.students st
   where st.branch_id = p_branch_id
     and st.deleted_at is null
     and st.status = 'active'
     and not exists (
       select 1 from public.contracts c
        where c.student_id = st.id and c.is_active);

  --  Birinchi hisoblanadigan oy. "Davrni almashtiring" deyish yetarli
  --  emas — QAYSI davrga o'tishni ham aytish kerak.
  select min(date_trunc('month',
           greatest(c.starts_on, coalesce(st.enrolled_on, c.starts_on))))::date
    into v_first
    from public.students st
    join public.contracts c on c.student_id = st.id and c.is_active
   where st.branch_id = p_branch_id
     and st.deleted_at is null
     and st.status = 'active'
     and (c.ends_on is null or c.ends_on >= v_period)
     and (st.left_on is null or st.left_on >= v_period);

  -- =================================================================
  --  DAROMAD — mantiq `generate_invoices` bilan bir xil
  --  (20260822120012, 200-380 qatorlar).
  -- =================================================================
  for r in
    select st.id as student_id, st.branch_id, st.class_name,
           st.enrolled_on, st.left_on,
           c.id as contract_id, c.tuition_amount,
           c.starts_on, c.ends_on, c.billing_months
      from public.students st
      join public.contracts c on c.student_id = st.id and c.is_active
     where st.branch_id = p_branch_id
       and st.deleted_at is null
       and st.status = 'active'
  loop
    v_from := greatest(v_period, r.starts_on,
                       coalesce(r.enrolled_on, v_period));
    v_to   := least(v_month_end,
                    coalesce(r.ends_on, v_month_end),
                    coalesce(r.left_on, v_month_end));

    if v_to < v_from then
      if r.starts_on > v_month_end
         or coalesce(r.enrolled_on, v_period) > v_month_end then
        v_not_started := v_not_started + 1;
      elsif r.left_on is not null and r.left_on < v_period then
        v_left := v_left + 1;
      else
        v_ended := v_ended + 1;
      end if;
      continue;
    end if;

    if not app.is_billable_month(v_school, r.billing_months, v_period) then
      v_summer := v_summer + 1;
      continue;
    end if;

    v_ok := v_ok + 1;
    v_covered := (v_to - v_from) + 1;

    --  1) O'qish to'lovi — oy o'rtasida kelganga proporsional.
    if r.tuition_amount > 0 then
      v_tuition := case
        when v_covered >= v_month_days or v_partial = 'full'
        then r.tuition_amount
        else round(r.tuition_amount * v_covered / v_month_days, 2)
      end;
    else
      v_tuition := 0;
    end if;

    --  2) Qo'shimcha xizmatlar.
    v_stu_svc := 0;
    for sv in
      select s2.id as service_id, s2.billing_type,
             ss.starts_on as sub_from, ss.ends_on as sub_to
        from public.student_services ss
        join public.services s2 on s2.id = ss.service_id
       where ss.student_id = r.student_id
         and s2.is_active
         and s2.deleted_at is null
         and ss.starts_on <= v_to
         and (ss.ends_on is null or ss.ends_on >= v_from)
    loop
      v_svc_from := greatest(v_from, sv.sub_from);
      v_svc_to   := least(v_to, coalesce(sv.sub_to, v_to));
      if v_svc_to < v_svc_from then continue; end if;

      v_price := app.service_price_on(sv.service_id, v_period);
      if v_price is null then continue; end if;

      if sv.billing_type = 'monthly_fixed' then
        v_stu_svc := v_stu_svc + case
          when (v_svc_to - v_svc_from) + 1 >= v_month_days then v_price
          else round(v_price * ((v_svc_to - v_svc_from) + 1) / v_month_days, 2)
        end;

      elsif sv.billing_type = 'daily' then
        --  Taxminiy: ish kunlari bo'yicha. Oy oxirida
        --  `finalize_invoices` yo'qlik asosida qayta hisoblaydi.
        v_qty := app.working_days(v_school, r.branch_id, v_svc_from, v_svc_to);
        v_stu_svc := v_stu_svc + round(v_price * v_qty, 2);

      else  -- one_time
        if sv.sub_from between v_from and v_to then
          v_stu_svc := v_stu_svc + v_price;
        end if;
      end if;
    end loop;

    --  3) Chegirma — faqat o'qish to'lovidan.
    select kind, value into v_disc_kind, v_disc_value
      from app.contract_discount(r.contract_id);

    v_stu_disc := 0;
    if v_disc_kind is not null and coalesce(v_disc_value, 0) > 0
       and v_tuition > 0 then
      v_stu_disc := case
        when v_disc_kind = 'percent' then round(v_tuition * v_disc_value / 100, 2)
        else least(v_disc_value, v_tuition)
      end;
    end if;

    v_sum_tuition  := v_sum_tuition  + v_tuition;
    v_sum_service  := v_sum_service  + v_stu_svc;
    v_sum_discount := v_sum_discount + v_stu_disc;

    --  Sinf kesimi — chegirmasi AYRILGAN summa bilan, chunki direktor
    --  sinfdan qancha PUL kelishini biladi, hisoblanma qatorlarini
    --  emas.
    v_stu_total := v_tuition + v_stu_svc - v_stu_disc;
    v_cls := coalesce(nullif(r.class_name, ''), '—');
    v_row := coalesce(v_by_class -> v_cls,
                      jsonb_build_object('students', 0, 'total', 0));
    v_by_class := jsonb_set(v_by_class, array[v_cls], jsonb_build_object(
      'students', (v_row ->> 'students')::int + 1,
      'total',    (v_row ->> 'total')::numeric + v_stu_total));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'class_name', e.k,
           'students',   (e.v ->> 'students')::int,
           'total',      (e.v ->> 'total')::numeric
         ) order by e.k), '[]'::jsonb)
    into v_classes
    from jsonb_each(v_by_class) as e(k, v);

  -- =================================================================
  --  OYLIK — o'qiladi, qayta hisoblanmaydi.
  -- =================================================================
  select count(*), coalesce(sum(t.net_total), 0)
    into v_pay_runs, v_pay_net
    from public.v_payroll_totals t
   where t.school_id = v_school
     and t.period    = v_period
     and t.status   <> 'cancelled';

  select count(*) into v_pay_teachers
    from public.teachers te
   where te.school_id = v_school
     and te.deleted_at is null
     and te.is_active;

  return jsonb_build_object(
    'period', v_period,

    'ok',           v_ok,
    'not_started',  v_not_started,
    'ended',        v_ended,
    'left',         v_left,
    'summer',       v_summer,
    'no_contract',  v_no_contract,
    'first_period', v_first,

    'expected_tuition',  v_sum_tuition,
    'expected_service',  v_sum_service,
    'expected_discount', v_sum_discount,
    'expected_total',    v_sum_tuition + v_sum_service - v_sum_discount,

    'by_class', v_classes,

    'payroll_net',      v_pay_net,
    'payroll_runs',     v_pay_runs,
    'payroll_teachers', v_pay_teachers,
    --  Nechta o'qituvchining oyligi hali hisoblanmagan. Noldan katta
    --  bo'lsa "qo'lda qoladi" raqami to'liq emas.
    'payroll_missing',  greatest(v_pay_teachers - v_pay_runs, 0),

    'net', v_sum_tuition + v_sum_service - v_sum_discount - v_pay_net);
end;
$function$
;
