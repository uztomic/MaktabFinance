-- =====================================================================
--  "0 YARATILDI, 227 O'TKAZIB YUBORILDI" — NEGA?
--
--  `generate_invoices` faqat sonni qaytaradi. Buxgalter tugmani bosadi,
--  "O'tkazib yuborildi: 227" ni ko'radi va nima qilishini bilmaydi:
--  tizim buzilganmi, ma'lumot yo'qmi, yoki hammasi to'g'rimi?
--
--  Amalda sabablar butunlay boshqa-boshqa va har biriga boshqacha
--  javob kerak:
--
--    · shartnoma keyinroq boshlanadi  → hammasi joyida, davrni almashtiring
--    · yozgi ta'til (9 oylik to'lov)  → hammasi joyida, shunday bo'lishi kerak
--    · o'quvchi ketgan                → hammasi joyida
--    · shartnoma umuman yo'q          → MUAMMO, kiritish kerak
--
--  Ikkinchi vazifasi: KUTILAYOTGAN SUMMA. Hisoblanma hali
--  yaratilmagan davrda "qancha yig'iladi?" degan savolga javob yo'q
--  edi — ekran bo'sh ro'yxatni ko'rsatardi va tamom. Direktor esa
--  oyni rejalashtirish uchun aynan shu raqamni qidiradi.
--
--  Bu funksiya HECH NARSA YOZMAYDI — faqat sanaydi. Mantiq
--  `generate_invoices` dagi bilan bir xil (20260822120012, 200-380
--  qatorlar), shuning uchun raqamlar mos tushadi. Kunlik xizmatlar
--  u yerda ham taxminiy (ish kunlari bo'yicha) hisoblanadi va oy
--  oxirida `finalize_invoices` yo'qlik asosida qayta hisoblaydi.
-- =====================================================================

create or replace function public.invoice_skip_reasons(
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
  v_school    uuid;
  v_period    date := date_trunc('month', p_period)::date;
  v_month_end date := (date_trunc('month', p_period)
                       + interval '1 month - 1 day')::date;
  r           record;
  v_from      date;
  v_to        date;

  v_ok          int := 0;   -- hisoblanma quriladi
  v_not_started int := 0;   -- shartnoma yoki qabul keyinroq
  v_ended       int := 0;   -- shartnoma tugagan
  v_left        int := 0;   -- o'quvchi ketgan
  v_summer      int := 0;   -- to'lov 9 oyga taqsimlangan
  v_no_contract int := 0;   -- faol shartnoma yo'q
  v_first       date;        -- birinchi hisoblanadigan oy

  --  Kutilayotgan summa.
  v_month_days int := extract(day from (date_trunc('month', p_period)
                       + interval '1 month - 1 day'))::int;
  v_covered    int;
  v_tuition    numeric(14,2);
  v_price      numeric(14,2);
  v_qty        numeric(10,2);
  v_svc_from   date;
  v_svc_to     date;
  v_disc_kind  public.discount_kind;
  v_disc_value numeric;
  sv           record;

  v_sum_tuition  numeric(14,2) := 0;
  v_sum_service  numeric(14,2) := 0;
  v_sum_discount numeric(14,2) := 0;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  if v_school is null then
    raise exception 'Filial topilmadi' using errcode = '22023';
  end if;
  perform app.assert_branch(p_branch_id);

  --  Faol shartnomasi yo'qlar: `generate_invoices` ularni umuman
  --  ko'rmaydi (INNER JOIN), shuning uchun "o'tkazib yuborildi" ga
  --  ham tushmaydi. Aynan shu eng jimgina yo'qoladigan hol.
  select count(*) into v_no_contract
    from public.students st
   where st.branch_id = p_branch_id
     and st.deleted_at is null
     and st.status = 'active'
     and not exists (
       select 1 from public.contracts c
        where c.student_id = st.id and c.is_active);

  --  Birinchi hisoblanadigan oy. "Davrni almashtiring" deyish
  --  yetarli emas — QAYSI davrga o'tishni ham aytish kerak.
  select min(date_trunc('month',
           greatest(c.starts_on, coalesce(st.enrolled_on, c.starts_on))))::date
    into v_first
    from public.students st
    join public.contracts c
      on c.student_id = st.id and c.is_active
   where st.branch_id = p_branch_id
     and st.deleted_at is null
     and st.status = 'active'
     and (c.ends_on is null or c.ends_on >= v_period)
     and (st.left_on is null or st.left_on >= v_period);

  for r in
    select st.id as student_id, st.branch_id,
           st.enrolled_on, st.left_on,
           c.id as contract_id, c.tuition_amount,
           c.starts_on, c.ends_on, c.billing_months
      from public.students st
      join public.contracts c
        on c.student_id = st.id and c.is_active
     where st.branch_id = p_branch_id
       and st.deleted_at is null
       and st.status = 'active'
  loop
    v_from := greatest(v_period, r.starts_on,
                       coalesce(r.enrolled_on, v_period));
    v_to   := least(v_month_end,
                    coalesce(r.ends_on,  v_month_end),
                    coalesce(r.left_on,  v_month_end));

    if v_to < v_from then
      --  Sababni ajratamiz — foydalanuvchiga aynan shu kerak.
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

    -- ---- Kutilayotgan summa (generate_invoices bilan bir xil) -----
    v_covered := (v_to - v_from) + 1;

    --  1) O'qish to'lovi — oy o'rtasida kelganga proporsional.
    if r.tuition_amount > 0 then
      v_tuition := case
        when v_covered >= v_month_days then r.tuition_amount
        else round(r.tuition_amount * v_covered / v_month_days, 2)
      end;
      v_sum_tuition := v_sum_tuition + v_tuition;
    else
      v_tuition := 0;
    end if;

    --  2) Qo'shimcha xizmatlar.
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
        v_sum_service := v_sum_service + case
          when (v_svc_to - v_svc_from) + 1 >= v_month_days then v_price
          else round(v_price * ((v_svc_to - v_svc_from) + 1) / v_month_days, 2)
        end;

      elsif sv.billing_type = 'daily' then
        --  Taxminiy: ish kunlari bo'yicha. Oy oxirida yo'qlik
        --  asosida qayta hisoblanadi.
        v_qty := app.working_days(v_school, r.branch_id, v_svc_from, v_svc_to);
        v_sum_service := v_sum_service + round(v_price * v_qty, 2);

      else  -- one_time
        if sv.sub_from between v_from and v_to then
          v_sum_service := v_sum_service + v_price;
        end if;
      end if;
    end loop;

    --  3) Chegirma — faqat o'qish to'lovidan.
    select kind, value into v_disc_kind, v_disc_value
      from app.contract_discount(r.contract_id);

    if v_disc_kind is not null and coalesce(v_disc_value, 0) > 0
       and v_tuition > 0 then
      v_sum_discount := v_sum_discount + case
        when v_disc_kind = 'percent' then round(v_tuition * v_disc_value / 100, 2)
        else least(v_disc_value, v_tuition)
      end;
    end if;
  end loop;

  return jsonb_build_object(
    'period',      v_period,
    'ok',          v_ok,
    'not_started', v_not_started,
    'ended',       v_ended,
    'left',        v_left,
    'summer',      v_summer,
    'no_contract', v_no_contract,
    'first_period', v_first,
    'expected_tuition',  v_sum_tuition,
    'expected_service',  v_sum_service,
    'expected_discount', v_sum_discount,
    'expected_total',    v_sum_tuition + v_sum_service - v_sum_discount);
end;
$$;

comment on function public.invoice_skip_reasons(uuid, date) is
  'Davrda nechta o''quvchi hisoblanmaga tushadi, tushmaganlari NEGA '
  'tushmaydi va qancha summa kutilyapti. Faqat o''qiydi — mantiq '
  'generate_invoices bilan bir xil.';

grant execute on function public.invoice_skip_reasons(uuid, date)
  to authenticated;
