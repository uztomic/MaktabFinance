-- =====================================================================
--  QAYTA SHAKLLANTIRISHDA QO'LDA QO'SHILGAN QATOR O'CHMAYDI
--
--  `add_invoice_discount` hisoblanmaga qo'lda chegirma qo'shadi.
--  `generate_invoices` esa tasdiqlanmagan hisoblanmani qayta
--  quradi va shu paytgacha hamma qatorni o'chirib tashlardi.
--
--  Natija ko'rinmas bo'lardi: direktor qarzni kechiradi, kimdir
--  "Hisoblanma" sahifasida qayta shakllantiradi va qarz qaytadi.
--  Hech qanday xato chiqmaydi.
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
      --  QO'LDA QO'SHILGAN QATOR SAQLANADI.
      --
      --  Ilgari bu yerda hisoblanmaning BARCHA qatori o'chirilib
      --  qaytadan yozilardi. Direktor kassada bergan chegirma esa
      --  hech qayerdan kelib chiqmaydi — u faqat shu qatorda
      --  yashaydi. Ya'ni hisoblanma qayta shakllantirilsa,
      --  kechirilgan qarz jimgina qaytib kelardi.
      delete from public.invoice_lines
       where invoice_id = v_invoice_id
         and coalesce((source ->> 'manual')::boolean, false) = false;
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
