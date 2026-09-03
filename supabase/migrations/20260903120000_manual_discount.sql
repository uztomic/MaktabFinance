-- =====================================================================
--  QO'LDA BERILGAN CHEGIRMA
--
--  Shartnomadagi chegirma allaqachon bor va u har oy o'z-o'zidan
--  qo'llanadi. Lekin kassada boshqa holat uchraydi: ota-ona kelib
--  1 500 000 o'rniga 1 400 000 to'laydi va direktor qolganini
--  kechiradi. Bugungacha buning yo'li yo'q edi — bola qarzdor bo'lib
--  qolardi va ro'yxatda qizil rangda turaverardi.
--
--  Yechim: hisoblanmaga alohida MANFIY qator qo'shiladi. Shartnoma
--  o'zgarmaydi (u kelasi oyga ham ta'sir qilardi), faqat shu oy
--  kamayadi.
--
--  Uch narsa ataylab qat'iy:
--
--    1. SABAB majburiy. Qarzni kechirish — pul qarori; kim, qachon
--       va nima uchun qilgani ma'lum bo'lishi shart.
--    2. Tasdiqlangan hisoblanmaga tegilmaydi (TZ 4.6.7).
--    3. Chegirma hisoblanma summasidan oshmaydi — aks holda maktab
--       bolaga qarzdor bo'lib qolardi.
--
--  Va eng muhimi: `generate_invoices` qayta qurganda bu qator
--  O'CHMAYDI. Ilgari u hisoblanmaning BARCHA qatorini o'chirib qayta
--  yozardi; qo'lda berilgan chegirma esa hech qayerda saqlanmagan
--  bo'lardi va jimgina yo'qolardi. Shuning uchun `source->>'manual'`
--  belgisi bor qatorlar chetlab o'tiladi.
-- =====================================================================

-- --- 1) Ruxsat --------------------------------------------------------
--  Kassir to'lov qabul qiladi, lekin qarzni KECHIRA olmaydi — bu
--  boshqa darajadagi qaror. Kerak bo'lsa direktor uni alohida
--  odamga qo'shimcha ruxsat sifatida beradi (`user_permissions`).
insert into public.role_permissions (role, permission, allowed)
values ('director', 'invoices.discount', true),
       ('accountant', 'invoices.discount', true)
on conflict do nothing;

-- --- 2) Chegirma qo'shish ---------------------------------------------
create or replace function public.add_invoice_discount(
  p_student_id uuid,
  p_period     date,
  p_amount     numeric,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school   uuid;
  v_branch   uuid;
  v_period   date := date_trunc('month', p_period)::date;
  v_invoice  uuid;
  v_status   public.invoice_status;
  v_total    numeric(14,2);
  v_sort     smallint;
  v_line     uuid;
  v_balance  numeric(14,2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Chegirma summasi noldan katta bo''lishi kerak'
      using errcode = '22023';
  end if;

  if coalesce(length(btrim(p_reason)), 0) < 3 then
    raise exception 'Chegirma sababi yozilishi shart'
      using errcode = '22023';
  end if;

  select school_id, branch_id into v_school, v_branch
    from public.students
   where id = p_student_id and deleted_at is null;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('invoices.discount');
  perform app.assert_branch(v_branch);
  perform app.assert_period_open(v_school, v_period, v_branch);

  select i.id, i.status into v_invoice, v_status
    from public.invoices i
   where i.student_id = p_student_id
     and i.period = v_period
     and i.status <> 'cancelled';

  if v_invoice is null then
    raise exception 'Bu oy uchun hisoblanma yo''q — avval hisoblanma shakllantiring'
      using errcode = '22023';
  end if;

  -- TZ 4.6.7 — tasdiqlangan hisoblanma qulflangan.
  if v_status = 'approved' then
    raise exception 'Hisoblanma tasdiqlangan — chegirma kiritib bo''lmaydi'
      using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0) into v_total
    from public.invoice_lines where invoice_id = v_invoice;

  if p_amount > v_total then
    raise exception 'Chegirma hisoblanma summasidan (%) oshmasligi kerak',
      to_char(v_total, 'FM999G999G999G990') using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.invoice_lines where invoice_id = v_invoice;

  insert into public.invoice_lines
    (school_id, invoice_id, kind, description,
     quantity, unit_price, amount, sort_order, source)
  values
    (v_school, v_invoice, 'discount',
     'Chegirma — ' || btrim(p_reason),
     1, -p_amount, -p_amount, v_sort,
     jsonb_build_object(
       'manual', true,
       'reason', btrim(p_reason),
       'by',     (select auth.uid()),
       'at',     now()))
  returning id into v_line;

  select balance into v_balance
    from public.v_student_balances where student_id = p_student_id;

  return jsonb_build_object(
    'line_id',       v_line,
    'invoice_id',    v_invoice,
    'discount',      p_amount,
    'invoice_total', v_total - p_amount,
    'balance',       v_balance);
end;
$$;

comment on function public.add_invoice_discount(uuid, date, numeric, text) is
  'Shu oyning hisoblanmasiga qo''lda chegirma qo''shadi. Shartnomaga '
  'tegmaydi — kelasi oy avvalgidek hisoblanadi. Sabab majburiy, '
  'tasdiqlangan hisoblanmaga tegmaydi.';

grant execute on function public.add_invoice_discount(uuid, date, numeric, text)
  to authenticated;

-- --- 3) Xato berilgan chegirmani olib tashlash ------------------------
create or replace function public.remove_invoice_discount(
  p_line_id uuid,
  p_reason  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school  uuid := app.school_id();
  v_row     public.invoice_lines%rowtype;
  v_branch  uuid;
  v_period  date;
  v_status  public.invoice_status;
begin
  select * into v_row from public.invoice_lines
   where id = p_line_id and school_id = v_school;

  if not found then
    raise exception 'Qator topilmadi' using errcode = '22023';
  end if;

  --  Faqat QO'LDA berilgani. Shartnomadagi chegirma qatori bu yerdan
  --  o'chirilmaydi — u shartnomadan kelib chiqadi va o'chirilsa
  --  keyingi qayta qurishda baribir qaytadi.
  if v_row.kind <> 'discount'
     or coalesce((v_row.source ->> 'manual')::boolean, false) = false then
    raise exception 'Bu qator qo''lda berilgan chegirma emas'
      using errcode = '22023';
  end if;

  select i.branch_id, i.period, i.status into v_branch, v_period, v_status
    from public.invoices i where i.id = v_row.invoice_id;

  perform app.assert_may_write('invoices.discount');
  perform app.assert_branch(v_branch);
  perform app.assert_period_open(v_school, v_period, v_branch);

  if v_status = 'approved' then
    raise exception 'Hisoblanma tasdiqlangan — o''zgartirib bo''lmaydi'
      using errcode = '42501';
  end if;

  delete from public.invoice_lines where id = p_line_id;

  return jsonb_build_object('removed', 1, 'invoice_id', v_row.invoice_id);
end;
$$;

comment on function public.remove_invoice_discount(uuid, text) is
  'Xato berilgan qo''lda chegirmani olib tashlaydi. O''chirish audit '
  'jurnalida qoladi.';

grant execute on function public.remove_invoice_discount(uuid, text)
  to authenticated;
