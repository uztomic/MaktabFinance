-- =====================================================================
--  IKKI XIL TO'LOV TURI
--
--    1) OYLIK OBUNA   — oyiga 770 000 so'm (asos), filial va o'quvchi
--                       qo'shimchasi avvalgidek.
--    2) SOTIB OLISH   — bir martalik 770 $, keyin har yili server uchun
--                       70 $. Hisob-faktura so'mda chiqadi: dollar
--                       kursi platforma sozlamasida (billing.usd_rate).
--
--  Maktabning turi `school_subscriptions.billing_model` da. Super admin
--  uni maktab kartochkasida almashtiradi (set_billing_model).
-- =====================================================================

alter table public.school_subscriptions
  add column if not exists billing_model text not null default 'subscription'
  check (billing_model in ('subscription', 'purchase'));

comment on column public.school_subscriptions.billing_model is
  'subscription — oylik obuna; purchase — bir martalik sotib olish + yillik server to''lovi.';

update public.platform_settings set value = '770000'::jsonb where key = 'billing.base_monthly';

insert into public.platform_settings (key, value, note) values
  ('billing.purchase_usd',      '770'::jsonb,   'Sotib olish narxi, $ (bir martalik)'),
  ('billing.server_yearly_usd', '70'::jsonb,    'Server uchun yillik to''lov, $ (sotib olganlar)'),
  ('billing.usd_rate',          '12100'::jsonb, '1 $ necha so''m — sotib olish hisob-fakturasi uchun')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
--  Hisob-faktura: sotib olgan maktabga YILIGA bir marta.
--  Birinchisi — sotib olish narxi, keyingilari — yillik server.
-- ---------------------------------------------------------------------
create or replace function public.issue_subscription_invoice(
  p_school_id uuid,
  p_period    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', coalesce(p_period, current_date))::date;
  v_price  jsonb;
  v_sub    public.school_subscriptions%rowtype;
  v_total  numeric;
  v_due    date;
  v_id     uuid;
  v_rate   numeric;
  v_first  boolean;
  v_usd    numeric;
begin
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  select id into v_id
    from public.subscription_invoices
   where school_id = p_school_id and period = v_period and status <> 'void';
  if found then
    return jsonb_build_object('invoice_id', v_id, 'created', false,
                              'period', v_period);
  end if;

  select * into v_sub
    from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled'
   limit 1;

  v_price := public.school_price(p_school_id);
  v_due := coalesce(v_sub.next_payment_date, v_period + 4);

  -- --- Sotib olgan maktab ----------------------------------------------
  if v_sub.billing_model = 'purchase' then
    --  Oxirgi 12 oyda hisob-faktura bo'lsa — yangisi kerak emas.
    if exists (select 1 from public.subscription_invoices
                where school_id = p_school_id and status <> 'void'
                  and note like 'purchase:%'
                  and period > (v_period - interval '12 months')::date) then
      return jsonb_build_object('created', false, 'period', v_period,
                                'reason', 'yearly_already_issued');
    end if;

    v_rate  := coalesce(app.billing_num('billing.usd_rate'), 12100);
    v_first := not exists (select 1 from public.subscription_invoices
                            where school_id = p_school_id and status <> 'void'
                              and note like 'purchase:%');
    v_usd   := case when v_first
                 then coalesce(app.billing_num('billing.purchase_usd'), 770)
                 else coalesce(app.billing_num('billing.server_yearly_usd'), 70) end;
    v_total := round(v_usd * v_rate, -3);

    insert into public.subscription_invoices (
      school_id, period, due_date, setup_fee, base_amount,
      branches_count, branches_extra, branches_amount,
      students_count, students_included, students_extra_steps, students_amount,
      total_amount, note)
    values (
      p_school_id, v_period, v_due, 0, v_total,
      (v_price ->> 'branches_count')::int, 0, 0,
      (v_price ->> 'students_count')::int, (v_price ->> 'students_count')::int, 0, 0,
      v_total,
      'purchase:' || case when v_first then 'license' else 'server' end
        || ' ' || v_usd || '$ × ' || v_rate)
    returning id into v_id;

    update public.school_subscriptions
       set monthly_amount = round(coalesce(app.billing_num('billing.server_yearly_usd'), 70) * v_rate / 12, -3)
     where id = v_sub.id;

    perform app.plog('invoice_issued', 'subscription_invoices',
                     v_id::text, p_school_id, null,
                     jsonb_build_object('period', v_period, 'total', v_total,
                                        'model', 'purchase', 'usd', v_usd));

    return jsonb_build_object('invoice_id', v_id, 'created', true,
                              'period', v_period, 'total', v_total,
                              'due_date', v_due, 'model', 'purchase', 'usd', v_usd);
  end if;

  -- --- Oylik obuna (avvalgidek) ----------------------------------------
  v_total := (v_price ->> 'monthly_total')::numeric
           + (v_price ->> 'setup_fee')::numeric;

  insert into public.subscription_invoices (
    school_id, period, due_date,
    setup_fee, base_amount,
    branches_count, branches_extra, branches_amount,
    students_count, students_included, students_extra_steps, students_amount,
    total_amount)
  values (
    p_school_id, v_period, v_due,
    (v_price ->> 'setup_fee')::numeric,
    (v_price ->> 'base_amount')::numeric,
    (v_price ->> 'branches_count')::int,
    (v_price ->> 'branches_extra')::int,
    (v_price ->> 'branches_amount')::numeric,
    (v_price ->> 'students_count')::int,
    (v_price ->> 'students_included')::int,
    (v_price ->> 'students_extra_steps')::int,
    (v_price ->> 'students_amount')::numeric,
    v_total)
  returning id into v_id;

  if v_sub.id is not null then
    update public.school_subscriptions
       set monthly_amount = (v_price ->> 'monthly_total')::numeric
     where id = v_sub.id;
  end if;

  perform app.plog('invoice_issued', 'subscription_invoices',
                   v_id::text, p_school_id, null,
                   jsonb_build_object('period', v_period, 'total', v_total));

  return jsonb_build_object('invoice_id', v_id, 'created', true,
                            'period', v_period, 'total', v_total,
                            'due_date', v_due, 'breakdown', v_price);
end;
$$;

-- ---------------------------------------------------------------------
--  To'lov turini almashtirish — faqat platforma admini.
-- ---------------------------------------------------------------------
create or replace function public.set_billing_model(
  p_school_id uuid,
  p_model     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := app.require_platform_admin();
  v_old   text;
begin
  if p_model not in ('subscription', 'purchase') then
    raise exception 'Noto''g''ri to''lov turi: %', p_model using errcode = '22023';
  end if;

  select billing_model into v_old from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled' limit 1;
  if not found then
    raise exception 'Maktabda faol obuna yo''q' using errcode = 'P0002';
  end if;

  update public.school_subscriptions set billing_model = p_model
   where school_id = p_school_id and status <> 'cancelled';

  perform app.plog('billing_model_changed', 'school_subscriptions', p_school_id::text,
                   p_school_id, jsonb_build_object('model', v_old),
                   jsonb_build_object('model', p_model, 'admin_id', v_admin));

  return jsonb_build_object('school_id', p_school_id, 'model', p_model);
end;
$$;

revoke all on function public.set_billing_model(uuid, text) from public, anon;
grant execute on function public.set_billing_model(uuid, text) to authenticated;
