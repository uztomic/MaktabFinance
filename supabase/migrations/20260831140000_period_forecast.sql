-- =====================================================================
--  DAVR PROGNOZI — sinflar kesimi va oylik bilan
--
--  `invoice_skip_reasons` (20260831130000) faqat umumiy summani
--  qaytarardi. Direktorga esa bundan kam foyda: "310 mln" degan raqam
--  bilan nima qilish kerakligi noma'lum. Kerakli savollar boshqacha:
--
--    · qaysi sinf qancha keltiradi?
--    · shu puldan oylikka qancha ketadi?
--    · qo'lda nima qoladi?
--
--  Shuning uchun bitta funksiya: daromad sinflar kesimida + oylik.
--  Ikkita alohida funksiya qilinmadi — o'quvchilar bo'ylab tsikl
--  bitta, uni ikki joyda takrorlash raqamlar bir-biriga mos
--  kelmasligiga olib boradi.
--
--  OYLIK QAYTA HISOBLANMAYDI. `calc_payroll` yagona manba bo'lib
--  qoladi, bu yerda faqat allaqachon hisoblangani o'qiladi. Aks holda
--  ikki joyda ikki xil formula paydo bo'lardi va qaysi biri to'g'ri
--  ekanini hech kim ayta olmasdi. Oyligi hisoblanmagan o'qituvchi
--  soni alohida qaytariladi — raqam to'liq emasligi ko'rinib tursin.
--
--  Funksiya HECH NARSA YOZMAYDI.
-- =====================================================================

create or replace function public.period_forecast(
  p_branch_id uuid,
  p_period    date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
        when v_covered >= v_month_days then r.tuition_amount
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
$$;

comment on function public.period_forecast(uuid, date) is
  'Davr prognozi: kutilayotgan daromad (sinflar kesimida), hisoblangan '
  'oylik va qo''lda qoladigan summa. Nega hisoblanmagani ham '
  'qaytariladi. Faqat o''qiydi.';

grant execute on function public.period_forecast(uuid, date) to authenticated;

--  Endi bitta funksiya hammasini qaytaradi. Ikkitasini saqlash
--  raqamlar bir-biriga mos kelmasligiga olib boradi.
drop function if exists public.invoice_skip_reasons(uuid, date);
