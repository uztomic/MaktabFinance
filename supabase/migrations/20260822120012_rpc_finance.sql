-- =====================================================================
--  12 — MOLIYAVIY AMALLAR (TZ 5.4.6, 5.4.7)
--
--  "Moliyaviy amallar (hisoblanma shakllantirish, to'lovni yopish,
--   oylik hisobi, qayta hisoblash, oyni qulflash) FAQAT SERVER TOMONDA
--   bajariladi."
--
--  10-migratsiyada moliyaviy jadvallarga mijoz uchun INSERT/UPDATE
--  siyosati YARATILMAGAN. Demak hisoblanma yoki to'lov yozuvini
--  PostgREST orqali yozib bo'lmaydi — yagona yo'l shu fayldagi
--  funksiyalar.
--
--  Har bir funksiya:
--    1. huquqni tekshiradi        (app.assert_may_write)
--    2. filialni tekshiradi       (app.assert_branch)
--    3. davr qulfini tekshiradi   (app.assert_period_open)
--    4. bitta tranzaksiyada yozadi (TZ 5.4.7 — funksiya = tranzaksiya)
--    5. audit jurnaliga tushadi   (triggerlar avtomatik, TZ 5.4.10)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. XIZMAT KONTEKSTI
--
--  Edge Function `service_role` bilan ishlaydi va unda foydalanuvchi
--  JWT si bo'lmaydi. Bunday chaqiruvda rol tekshiruvi o'tkazib
--  yuboriladi — xavfsizlik allaqachon Edge Function ichida
--  ta'minlangan (u service_role kalitini talab qiladi).
-- ---------------------------------------------------------------------

create or replace function app.is_service_context()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'service_role'
  ) = 'service_role';
$$;

comment on function app.is_service_context() is
  'JWT yo''q yoki role = service_role bo''lsa TRUE. Edge Function va cron '
  'chaqiruvlarini foydalanuvchi chaqiruvidan ajratadi.';

-- 03-migratsiyadagi versiyani almashtiradi: endi xizmat konteksti
-- hisobga olinadi.
create or replace function app.assert_may_write(p_permission text)
returns void
language plpgsql
stable
as $$
begin
  if app.is_service_context() then
    return;  -- Edge Function / cron — o'z tekshiruvi bor.
  end if;

  if app.is_readonly_session() then
    raise exception 'Texnik yordam sessiyasi faqat o''qish rejimida (TZ 4.13.5.4)'
      using errcode = '42501';
  end if;
  if not app.school_is_writable() then
    raise exception 'Maktab cheklash rejimida: yangi yozuv kiritib bo''lmaydi (TZ 4.13.4)'
      using errcode = '42501';
  end if;
  if not app.can(p_permission) then
    raise exception 'Ruxsat yo''q: %', p_permission
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app.assert_branch(p_branch_id uuid)
returns void
language plpgsql
stable
as $$
begin
  if app.is_service_context() then
    return;
  end if;
  if not app.has_branch(p_branch_id) then
    raise exception 'Bu filialga kirish huquqi yo''q'
      using errcode = '42501';
  end if;
end;
$$;

-- =====================================================================
--  1. DAVR SHU SHARTNOMA UCHUN HISOBLANADIMI? (TZ 12.2.1)
--
--  "Yozgi ta'til oylarida to'lov olinadimi? To'lov 9 oyga
--   taqsimlanadimi yoki 12 oyga?"
--
--  Javob shartnomadagi `billing_months` va maktab sozlamasidagi
--  o'quv yili boshlanish oyi orqali beriladi — kodda qat'iy emas.
-- =====================================================================

create or replace function app.is_billable_month(
  p_school_id      uuid,
  p_billing_months smallint,
  p_period         date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(p_billing_months, 12) >= 12 then true
    else (
      (extract(month from p_period)::int
       - coalesce((app.school_setting(p_school_id, 'academic_year_start_month',
                                      '9'::jsonb))::int, 9)
       + 12) % 12
    ) < p_billing_months
  end;
$$;

comment on function app.is_billable_month(uuid, smallint, date) is
  'TZ 12.2.1 — to''lov 9 oyga taqsimlansa yozgi oylarda hisoblanma '
  'shakllantirilmaydi. O''quv yili boshi maktab sozlamasidan olinadi.';

-- =====================================================================
--  2. HISOBLANMA SHAKLLANTIRISH (TZ 4.6)
--
--  Bitta amal bilan butun filial uchun (TZ 4.6.1).
--  Takroriy chaqiruvda DUBLIKAT YARATILMAYDI (TZ 4.6.8) — mavjud
--  hisoblanma qatorlari qayta quriladi, tasdiqlangani esa tegilmaydi
--  (TZ 4.6.7).
-- =====================================================================

create or replace function public.generate_invoices(
  p_branch_id uuid,
  p_period    date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      if v_covered >= v_month_days then
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
$$;

comment on function public.generate_invoices(uuid, date) is
  'TZ 4.6.1 — bitta amal bilan filial uchun oylik hisoblanma. Idempotent: '
  'takroriy chaqiruvda dublikat yaratilmaydi (TZ 4.6.8), tasdiqlangan '
  'hisoblanmaga tegilmaydi (TZ 4.6.7).';

-- =====================================================================
--  3. YAKUNIY HISOBLANMA (TZ 4.6.1)
--
--  Kunlik xizmatlarni yo'qlik qayd etuvi asosida qayta hisoblaydi.
--  TZ 4.6.1.2 — faqat qayd etuv TO'LIQ kiritilgandan keyin ishlaydi.
-- =====================================================================

create or replace function public.finalize_invoices(
  p_branch_id uuid,
  p_period    date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school    uuid;
  v_period    date := date_trunc('month', p_period)::date;
  v_month_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_method    text;
  v_gaps      int;
  v_gap_list  text;

  r           record;
  v_qty       numeric(10,2);
  v_amount    numeric(14,2);
  v_diff      numeric(14,2);
  v_next_inv  uuid;
  v_finalized int := 0;
  v_carried   numeric(14,2) := 0;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  if v_school is null then
    raise exception 'Filial topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('invoices.generate');
  perform app.assert_branch(p_branch_id);
  perform app.assert_period_open(v_school, v_period, p_branch_id);

  -- --- TZ 4.6.1.2 — qayd etuv to'liqligini tekshirish ---------------
  select count(*), string_agg(distinct to_char(day, 'DD.MM') || ' ' || class_name, ', ')
    into v_gaps, v_gap_list
    from app.absence_gaps(p_branch_id, v_period, v_month_end);

  if v_gaps > 0 then
    raise exception
      'Yo''qlik qayd etuvi to''liq emas: % ta sinf-kun belgilanmagan (%). Qayta hisoblash TZ 4.6.1.2 ga ko''ra to''xtatildi.',
      v_gaps, left(v_gap_list, 300)
      using errcode = '23514';
  end if;

  -- TZ 4.6.1.3 — farqni ko'chirish usuli sozlamadan.
  v_method := coalesce(
    app.school_setting(v_school, 'billing.daily_diff_method', '"recalculate"'::jsonb) #>> '{}',
    'recalculate');

  for r in
    select l.id as line_id, l.invoice_id, l.service_id, l.unit_price, l.amount,
           i.student_id, i.branch_id, l.source
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where i.branch_id = p_branch_id
       and i.period = v_period
       and i.status in ('preliminary', 'final')
       and l.is_preliminary
  loop
    v_qty := app.billable_days(
               r.student_id, r.service_id,
               greatest(v_period, (r.source ->> 'from')::date),
               least(v_month_end, (r.source ->> 'to')::date));
    v_amount := round(r.unit_price * v_qty, 2);
    v_diff := v_amount - r.amount;

    if v_method = 'carryover' and v_diff <> 0 then
      -- Joriy oy qatori o'zgarmaydi, farq keyingi oyga ko'chiriladi.
      select id into v_next_inv
        from public.invoices
       where student_id = r.student_id
         and period = (v_period + interval '1 month')::date
         and status <> 'cancelled';

      if v_next_inv is not null then
        insert into public.invoice_lines
          (school_id, invoice_id, kind, service_id, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (v_school, v_next_inv, 'carryover', r.service_id,
           'O''tgan oy tuzatuvi (' || to_char(v_period, 'MM.YYYY') || ')',
           1, v_diff, v_diff, 90,
           jsonb_build_object('from_period', v_period,
                              'from_line', r.line_id,
                              'actual_days', v_qty));
        v_carried := v_carried + v_diff;
      end if;

      -- Qator endi yakuniy deb belgilanadi (summasi o'zgarmadi).
      update public.invoice_lines
         set is_preliminary = false,
             source = r.source || jsonb_build_object(
               'stage', 'final', 'actual_days', v_qty,
               'diff_method', 'carryover', 'diff', v_diff)
       where id = r.line_id;
    else
      -- Joriy oy qatorining o'zi qayta hisoblanadi.
      update public.invoice_lines
         set quantity = v_qty,
             amount = v_amount,
             is_preliminary = false,
             description = replace(description, ' (dastlabki)', ''),
             source = r.source || jsonb_build_object(
               'stage', 'final', 'actual_days', v_qty,
               'diff_method', 'recalculate', 'diff', v_diff)
       where id = r.line_id;
    end if;
  end loop;

  update public.invoices
     set status = 'final', finalized_at = now()
   where branch_id = p_branch_id
     and period = v_period
     and status = 'preliminary';

  get diagnostics v_finalized = row_count;

  return jsonb_build_object(
    'period', v_period,
    'branch_id', p_branch_id,
    'finalized', v_finalized,
    'method', v_method,
    'carried_amount', v_carried);
end;
$$;

comment on function public.finalize_invoices(uuid, date) is
  'TZ 4.6.1 — kunlik xizmatlarni yo''qlik asosida qayta hisoblaydi. '
  'Qayd etuv to''liq bo''lmasa ishga tushmaydi (TZ 4.6.1.2).';

-- =====================================================================
--  4. HISOBLANMANI TASDIQLASH (TZ 4.6.7)
-- =====================================================================

create or replace function public.approve_invoices(
  p_branch_id uuid,
  p_period    date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_period date := date_trunc('month', p_period)::date;
  v_count  int;
begin
  select school_id into v_school from public.branches where id = p_branch_id;

  perform app.assert_may_write('invoices.generate');
  perform app.assert_branch(p_branch_id);
  perform app.assert_period_open(v_school, v_period, p_branch_id);

  update public.invoices
     set status = 'approved',
         approved_at = now(),
         approved_by = (select auth.uid())
   where branch_id = p_branch_id
     and period = v_period
     and status in ('preliminary', 'final');

  get diagnostics v_count = row_count;

  return jsonb_build_object('approved', v_count, 'period', v_period);
end;
$$;

comment on function public.approve_invoices(uuid, date) is
  'TZ 4.6.7 — tasdiqlangandan keyin hisoblanma qulflanadi, o''zgartirish '
  'faqat tuzatuvchi yozuv orqali.';

-- =====================================================================
--  5. KASSA TO'LOVI (TZ 4.7.1)
-- =====================================================================

create or replace function public.register_cash_payment(
  p_student_id uuid,
  p_amount     numeric,
  p_paid_on    date default current_date,
  p_note       text default null
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

  -- Naqd to'lov darhol haqiqiy hisoblanadi — pul kassada.
  insert into public.payments
    (school_id, branch_id, student_id, amount, channel, status,
     paid_on, note, created_by, confirmed_by, confirmed_at)
  values
    (v_school, v_branch, p_student_id, p_amount, 'cash', 'confirmed',
     p_paid_on, p_note, (select auth.uid()), (select auth.uid()), now())
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
    'balance',      v_balance);
end;
$$;

comment on function public.register_cash_payment(uuid, numeric, date, text) is
  'TZ 4.7.1 — naqd to''lov va raqamlangan kvitansiya. Raqam atomar '
  'olinadi, ketma-ketlik uzilmaydi (TZ 4.7.1.5).';

-- =====================================================================
--  6. TO'LOVNI BEKOR QILISH (TZ 5.4.8 — o'chirilmaydi)
-- =====================================================================

create or replace function public.cancel_payment(
  p_payment_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid; v_branch uuid; v_paid date;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Bekor qilish sababi ko''rsatilishi shart' using errcode = '22023';
  end if;

  select school_id, branch_id, paid_on into v_school, v_branch, v_paid
    from public.payments where id = p_payment_id;

  if v_school is null then
    raise exception 'To''lov topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(v_branch);
  perform app.assert_period_open(v_school, v_paid, v_branch);

  update public.payments
     set status = 'cancelled', cancelled_reason = p_reason
   where id = p_payment_id;

  update public.cash_receipts
     set cancelled_at = now()
   where payment_id = p_payment_id;

  return jsonb_build_object('payment_id', p_payment_id, 'status', 'cancelled');
end;
$$;

-- =====================================================================
--  7. CHEK TASDIQLASH (TZ 4.7.3)
--
--  MUHIM QOIDA: chek rasmi qarzdorlikni YOPMAYDI. `payments` yozuvi
--  faqat buxgalter tasdiqlagandan keyin yaratiladi (TZ 4.7.3.5).
-- =====================================================================

create or replace function public.confirm_payment_proof(
  p_proof_id uuid,
  p_amount   numeric default null,
  p_paid_on  date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p            public.payment_proofs%rowtype;
  v_amount     numeric(14,2);
  v_paid       date;
  v_payment_id uuid;
  v_balance    numeric(14,2);
begin
  select * into p from public.payment_proofs where id = p_proof_id;
  if not found then
    raise exception 'Chek topilmadi' using errcode = '22023';
  end if;
  if p.status <> 'pending' then
    raise exception 'Chek allaqachon ko''rib chiqilgan (%)' , p.status using errcode = '22023';
  end if;

  v_amount := coalesce(p_amount, p.amount_claimed);
  v_paid   := coalesce(p_paid_on, p.submitted_at::date);

  if v_amount is null or v_amount <= 0 then
    raise exception 'To''lov summasi ko''rsatilmagan' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(p.branch_id);
  perform app.assert_period_open(p.school_id, v_paid, p.branch_id);

  insert into public.payments
    (school_id, branch_id, student_id, amount, channel, status,
     paid_on, note, created_by, confirmed_by, confirmed_at)
  values
    (p.school_id, p.branch_id, p.student_id, v_amount, 'proof', 'confirmed',
     v_paid, 'Telegram chek #' || left(p.id::text, 8),
     (select auth.uid()), (select auth.uid()), now())
  returning id into v_payment_id;

  update public.payment_proofs
     set status = 'confirmed', payment_id = v_payment_id,
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_proof_id;

  select balance into v_balance
    from public.v_student_balances where student_id = p.student_id;

  perform app.enqueue_for_student(
    p.student_id, 'proof_confirmed',
    jsonb_build_object(
      'amount', to_char(v_amount, 'FM999G999G999G990'),
      'balance', to_char(coalesce(v_balance, 0), 'FM999G999G999G990')));

  return jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount);
end;
$$;

comment on function public.confirm_payment_proof(uuid, numeric, date) is
  'TZ 4.7.3.5 — buxgalter tasdiqlagandan keyin to''lov haqiqiy hisoblanadi. '
  'Shu paytgacha chek qarzdorlikka ta''sir qilmaydi.';

create or replace function public.reject_payment_proof(
  p_proof_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payment_proofs%rowtype;
begin
  select * into p from public.payment_proofs where id = p_proof_id;
  if not found then
    raise exception 'Chek topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(p.branch_id);

  update public.payment_proofs
     set status = 'rejected', reject_reason = p_reason,
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_proof_id;

  perform app.enqueue_for_student(
    p.student_id, 'proof_rejected',
    jsonb_build_object('reason', coalesce(p_reason, '')));

  return jsonb_build_object('proof_id', p_proof_id, 'status', 'rejected');
end;
$$;

-- =====================================================================
--  8. BANK VYPISKASI (TZ 4.7.2)
--
--  Edge Function faylni tahlil qiladi va qatorlarni jsonb massiv
--  sifatida shu funksiyaga beradi. Biriktirish server tomonda.
-- =====================================================================

create or replace function public.import_bank_rows(
  p_statement_id uuid,
  p_rows         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st        public.bank_statements%rowtype;
  v_row     jsonb;
  v_no      int := 0;
  v_added   int := 0;
  v_dupes   int := 0;
  v_matched int := 0;
  v_total   int := 0;
  v_code    text;
  v_student uuid;
  v_row_id  uuid;
  v_payment uuid;
begin
  select * into st from public.bank_statements where id = p_statement_id;
  if not found then
    raise exception 'Vypiska topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(st.branch_id);

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_no := v_no + 1;
    v_total := v_total + 1;

    -- TZ 4.7.2.2 — to'lov maqsadidan to'lov kodini ajratib olamiz.
    -- Naqsh: 2-4 harf, chiziqcha, 3-8 raqam (MK-1042).
    v_code := (regexp_match(
                 upper(coalesce(v_row ->> 'purpose', '')),
                 '([A-Z]{2,4}-[0-9]{3,8})'))[1];

    v_student := null;
    if v_code is not null then
      select id into v_student
        from public.students
       where school_id = st.school_id
         and upper(payment_code) = v_code
         and deleted_at is null;
    end if;

    -- TZ 4.7.2.4 — takroriy yuklashda dublikat yaratilmaydi.
    insert into public.bank_statement_rows
      (school_id, statement_id, row_no, doc_no, paid_on, amount,
       payer_name, purpose, payment_code, student_id)
    values
      (st.school_id, p_statement_id, v_no,
       nullif(v_row ->> 'doc_no', ''),
       (v_row ->> 'paid_on')::date,
       (v_row ->> 'amount')::numeric,
       nullif(v_row ->> 'payer_name', ''),
       nullif(v_row ->> 'purpose', ''),
       v_code, v_student)
    on conflict do nothing
    returning id into v_row_id;

    if v_row_id is null then
      v_dupes := v_dupes + 1;
      continue;
    end if;
    v_added := v_added + 1;

    -- Kod bo'yicha topilgan bo'lsa — to'lov yozuvi yaratiladi.
    if v_student is not null then
      insert into public.payments
        (school_id, branch_id, student_id, amount, channel, status,
         paid_on, note, created_by, confirmed_by, confirmed_at)
      values
        (st.school_id, st.branch_id, v_student,
         (v_row ->> 'amount')::numeric, 'bank', 'confirmed',
         (v_row ->> 'paid_on')::date,
         'Vypiska: ' || coalesce(v_row ->> 'doc_no', ''),
         (select auth.uid()), (select auth.uid()), now())
      returning id into v_payment;

      update public.bank_statement_rows
         set payment_id = v_payment, match_kind = 'auto',
             matched_at = now(), matched_by = (select auth.uid())
       where id = v_row_id;

      v_matched := v_matched + 1;

      perform app.enqueue_for_student(
        v_student, 'payment_received',
        jsonb_build_object(
          'amount', to_char((v_row ->> 'amount')::numeric, 'FM999G999G999G990'),
          'receipt', coalesce(v_row ->> 'doc_no', '—'),
          'date', to_char((v_row ->> 'paid_on')::date, 'DD.MM.YYYY')));
    end if;
  end loop;

  update public.bank_statements
     set rows_total = v_added, rows_matched = v_matched, processed_at = now()
   where id = p_statement_id;

  return jsonb_build_object(
    'total', v_total, 'added', v_added, 'duplicates', v_dupes,
    'matched', v_matched,
    -- TZ 4.7.2.6 — avtomatik biriktirish darajasi kamida 80%.
    'match_rate', case when v_added > 0
                       then round(100.0 * v_matched / v_added, 1)
                       else 0 end);
end;
$$;

comment on function public.import_bank_rows(uuid, jsonb) is
  'TZ 4.7.2 — vypiska qatorlarini yuklaydi va to''lov kodi bo''yicha '
  'avtomatik biriktiradi. Dublikat yaratmaydi (TZ 4.7.2.4).';

-- Qo'lda biriktirish (TZ 4.7.2.3)
create or replace function public.match_statement_row(
  p_row_id     uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.bank_statement_rows%rowtype;
  st        public.bank_statements%rowtype;
  v_payment uuid;
begin
  select * into r from public.bank_statement_rows where id = p_row_id;
  if not found then
    raise exception 'Vypiska qatori topilmadi' using errcode = '22023';
  end if;
  if r.payment_id is not null then
    raise exception 'Bu qator allaqachon biriktirilgan' using errcode = '22023';
  end if;

  select * into st from public.bank_statements where id = r.statement_id;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(st.branch_id);
  perform app.assert_period_open(st.school_id, r.paid_on, st.branch_id);

  insert into public.payments
    (school_id, branch_id, student_id, amount, channel, status,
     paid_on, note, created_by, confirmed_by, confirmed_at)
  values
    (st.school_id, st.branch_id, p_student_id, r.amount, 'bank', 'confirmed',
     r.paid_on, 'Vypiska (qo''lda): ' || coalesce(r.doc_no, ''),
     (select auth.uid()), (select auth.uid()), now())
  returning id into v_payment;

  update public.bank_statement_rows
     set student_id = p_student_id, payment_id = v_payment,
         match_kind = 'manual', matched_at = now(), matched_by = (select auth.uid())
   where id = p_row_id;

  update public.bank_statements
     set rows_matched = rows_matched + 1
   where id = r.statement_id;

  return jsonb_build_object('payment_id', v_payment);
end;
$$;

-- =====================================================================
--  9. OYNI YOPISH (TZ 5.4.9)
-- =====================================================================

create or replace function public.lock_period(
  p_period    date,
  p_branch_id uuid default null,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_period date := date_trunc('month', p_period)::date;
begin
  if p_branch_id is not null then
    select school_id into v_school from public.branches where id = p_branch_id;
    perform app.assert_branch(p_branch_id);
  else
    v_school := app.school_id();
  end if;

  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('period.close');

  insert into public.closed_periods (school_id, period, branch_id, closed_by, note)
  values (v_school, v_period, p_branch_id, (select auth.uid()), p_note)
  on conflict do nothing;

  return jsonb_build_object('school_id', v_school, 'period', v_period,
                            'branch_id', p_branch_id, 'closed', true);
end;
$$;

comment on function public.lock_period(date, uuid, text) is
  'TZ 5.4.9 — davrni qulflaydi. Shundan keyin o''sha davr yozuvlari '
  'tahrirlanmaydi (guard_closed_period triggeri to''xtatadi).';

-- =====================================================================
--  HUQUQLAR
--
--  Bu funksiyalar `authenticated` uchun ochiq, lekin har biri o'z
--  ichida huquqni tekshiradi. `anon` uchun hech biri ochilmaydi.
-- =====================================================================

do $do$
declare f text;
begin
  foreach f in array array[
    'public.generate_invoices(uuid, date)',
    'public.finalize_invoices(uuid, date)',
    'public.approve_invoices(uuid, date)',
    'public.register_cash_payment(uuid, numeric, date, text)',
    'public.cancel_payment(uuid, text)',
    'public.confirm_payment_proof(uuid, numeric, date)',
    'public.reject_payment_proof(uuid, text)',
    'public.import_bank_rows(uuid, jsonb)',
    'public.match_statement_row(uuid, uuid)',
    'public.lock_period(date, uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
