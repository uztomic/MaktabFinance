-- =====================================================================
--  OLDINDAN TO'LOV
--
--  Ota-ona bir yillik yoki yarim yillik to'lovni oldindan berishi
--  odatiy hol. Texnik jihatdan bu ilgari ham ishlardi: ortiqcha
--  to'lov balansni manfiyga chiqaradi va avans bo'lib turadi.
--
--  Lekin SUMMANI KASSIR O'ZI HISOBLASHI kerak edi. 1 700 000 ni
--  o'n ikkiga ko'paytirish oson ko'rinadi, aslida esa yo'q:
--
--    · to'lov 9 oyga taqsimlangan bo'lsa yozgi oylar hisoblanmaydi
--    · chegirma bor bo'lsa har oydan ayriladi
--    · qo'shimcha xizmatlar (ovqat, transport) ham qo'shiladi
--    · o'quvchi oy o'rtasida kelgan bo'lsa birinchi oy to'liq emas
--
--  Qo'lda hisoblanganda bularning bittasi albatta unutiladi va
--  keyin "nega qarz chiqdi" degan savol tug'iladi.
--
--  Bu funksiya hisobni o'zi qiladi va qaysi oylar qoplanishini
--  ochiq ko'rsatadi. Hech narsa yozmaydi — faqat taklif.
-- =====================================================================

-- =====================================================================
--  BITTA O'QUVCHI, BITTA OY — qancha bo'ladi?
--
--  Mantiq `generate_invoices` bilan bir xil (20260822120012). Alohida
--  funksiya qilingani ataylab: oldindan to'lov ham, kelajakdagi
--  hisobotlar ham shu yagona joydan foydalanishi kerak, aks holda
--  raqamlar bir-biriga mos kelmay qoladi.
-- =====================================================================

create or replace function app.student_month_amount(
  p_student_id uuid,
  p_period     date
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
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

  if r.tuition_amount > 0 then
    v_tuition := case
      when v_covered >= v_month_days then r.tuition_amount
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
$$;

comment on function app.student_month_amount(uuid, date) is
  'Bitta o''quvchining bitta oydagi summasi. Mantiq generate_invoices '
  'bilan bir xil: proporsional o''qish to''lovi + xizmatlar − chegirma. '
  'Hisoblanmaydigan oyda 0.';

-- =====================================================================
--  OLDINDAN TO'LOV TAKLIFI
--
--  p_months — nechta HISOBLANADIGAN oy. Yozgi ta'til oylari
--  sanalmaydi: "6 oy" degani olti marta to'lov, olti kalendar oy
--  emas.
-- =====================================================================

create or replace function public.prepay_quote(
  p_student_id uuid,
  p_months     int  default 12,
  p_from       date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school   uuid;
  v_branch   uuid;
  v_start    date;
  v_first    date;
  v_period   date;
  v_amount   numeric(14,2);
  v_total    numeric(14,2) := 0;
  v_months   jsonb := '[]'::jsonb;
  v_taken    int := 0;
  v_tried    int := 0;
  v_balance  numeric(14,2);
  v_ay_start int;
  v_left     int := 0;
begin
  select st.school_id, st.branch_id into v_school, v_branch
    from public.students st
   where st.id = p_student_id and st.deleted_at is null;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;
  perform app.assert_branch(v_branch);

  --  Boshlanish: hisoblanma qurilmagan birinchi oy. Shunda allaqachon
  --  hisoblangan oy ikki marta to'lanmaydi.
  if p_from is not null then
    v_start := date_trunc('month', p_from)::date;
  else
    select coalesce(max(i.period) + interval '1 month',
                    date_trunc('month', current_date))::date
      into v_start
      from public.invoices i
     where i.student_id = p_student_id and i.status <> 'cancelled';
  end if;

  --  Kelasi 36 oy ichida kerakli sonda hisoblanadigan oy qidiriladi.
  --  Cheklov kerak: 9 oylik shartnomada yozgi oylar o'tkazib
  --  yuboriladi va tsikl cheksiz aylanib ketishi mumkin.
  v_period := v_start;
  while v_taken < p_months and v_tried < 36 loop
    v_amount := app.student_month_amount(p_student_id, v_period);
    if v_amount > 0 then
      v_taken := v_taken + 1;
      v_total := v_total + v_amount;
      v_months := v_months || jsonb_build_object(
        'period', v_period, 'amount', v_amount);
      --  BIRINCHI HISOBLANADIGAN oy — boshlanish shu. Qidiruv
      --  boshlangan sana emas: yozda qidirib, kuzda topilishi mumkin
      --  va "iyundan boshlab" degan yozuv chalg'itadi.
      if v_first is null then v_first := v_period; end if;
    end if;
    v_period := (v_period + interval '1 month')::date;
    v_tried := v_tried + 1;
  end loop;

  v_first := coalesce(v_first, v_start);

  --  Joriy holat: musbat — qarz, manfiy — avans.
  select balance into v_balance
    from public.v_student_balances where student_id = p_student_id;
  v_balance := coalesce(v_balance, 0);

  --  O'quv yili oxirigacha nechta hisoblanadigan oy qolgan — panel
  --  "yil oxirigacha" tugmasini shundan quradi.
  v_ay_start := coalesce(
    (app.school_setting(v_school, 'academic_year_start_month', '9'::jsonb))::int,
    9);
  v_period := v_first;
  for i in 1 .. 24 loop
    --  Keyingi o'quv yili boshlanishi bilan to'xtaymiz. Sanash
    --  BIRINCHI hisoblanadigan oydan boshlanadi — aks holda yozda
    --  turib so'ralganda hisob darhol nolga tushib qoladi.
    exit when extract(month from v_period)::int = v_ay_start
              and v_period > v_first;
    if app.student_month_amount(p_student_id, v_period) > 0 then
      v_left := v_left + 1;
    end if;
    v_period := (v_period + interval '1 month')::date;
  end loop;

  return jsonb_build_object(
    'from',           v_first,
    'months',         v_months,
    'month_count',    v_taken,
    'total',          v_total,
    'balance',        v_balance,
    --  Kassirga kerak bo'lgan yagona raqam: qancha olish kerak.
    --  Qarzi bo'lsa qo'shiladi, avansi bo'lsa ayriladi.
    'to_pay',         greatest(0, v_total + v_balance),
    'months_left_in_year', v_left);
end;
$$;

comment on function public.prepay_quote(uuid, int, date) is
  'Oldindan to''lov taklifi: nechta oy, qaysi oylar, jami qancha. '
  'Yozgi ta''til oylari sanalmaydi. Hech narsa yozmaydi.';

grant execute on function public.prepay_quote(uuid, int, date) to authenticated;
