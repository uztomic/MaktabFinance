-- =====================================================================
--  ARALASH TO'LOV
--
--  Ota-ona bir to'lovni ikki usulda qilishi mumkin: bir qismi naqd,
--  qolgani kartadan. Ilgari buni yozishning yo'li yo'q edi — kassir
--  yo ikkita alohida to'lov kiritardi (kvitansiya ham ikkita, oila
--  chalkashadi), yo hammasini bitta usulga yozardi (kassa hisoboti
--  buziladi).
--
--  NEGA "Aralash" degan oddiy usul QO'SHILMADI: kassa hisobotining
--  butun ma'nosi naqd bilan naqdsizni ajratishda. Kun oxirida
--  sandiqdagi pul tizimdagi raqamga to'g'ri kelishi kerak. "Aralash"
--  degan bitta yozuv bu savolga javob bera olmaydi.
--
--  Shuning uchun: HAR QISM alohida to'lov yozuvi (o'z usuli bilan),
--  lekin KVITANSIYA BITTA. Oila bitta qog'oz oladi, buxgalteriya
--  esa aniq raqamlarni ko'radi.
-- =====================================================================

--  Bir amalda kiritilgan qismlarni bog'lab turadi. Kvitansiya
--  guruhning birinchi to'loviga ulanadi, lekin butun guruhni
--  qamraydi.
alter table public.payments
  add column if not exists split_group_id uuid;

comment on column public.payments.split_group_id is
  'Aralash to''lov qismlarini bog''laydi. Bitta kvitansiya, bir necha '
  'usul. Oddiy to''lovda null.';

create index if not exists payments_split_group_idx
  on public.payments (split_group_id)
  where split_group_id is not null;

-- =====================================================================
--  ARALASH TO'LOVNI YOZISH
--
--  p_parts: [{"method_id": "...", "amount": 500000}, ...]
-- =====================================================================
create or replace function public.register_split_payment(
  p_student_id uuid,
  p_parts      jsonb,
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
  v_group      uuid := gen_random_uuid();
  v_first      uuid;
  v_total      numeric(14,2) := 0;
  v_no         bigint;
  v_code       text;
  v_prefix     text;
  v_balance    numeric(14,2);
  v_payment_id uuid;
  v_method_nm  text;
  v_parts      jsonb := '[]'::jsonb;
  part         jsonb;
  v_amount     numeric(14,2);
  v_method     uuid;
  v_count      int := 0;
begin
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) < 2 then
    raise exception 'Aralash to''lovda kamida ikkita qism bo''lishi kerak'
      using errcode = '22023';
  end if;

  select school_id, branch_id into v_school, v_branch
    from public.students where id = p_student_id and deleted_at is null;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(v_branch);
  perform app.assert_period_open(v_school, p_paid_on, v_branch);

  for part in select * from jsonb_array_elements(p_parts)
  loop
    v_amount := (part ->> 'amount')::numeric(14,2);
    v_method := nullif(part ->> 'method_id', '')::uuid;

    if v_amount is null or v_amount <= 0 then
      raise exception 'Har bir qism summasi noldan katta bo''lishi kerak'
        using errcode = '22023';
    end if;

    --  Begona maktabning yoki o'chirilgan usuli berilmasin.
    select name into v_method_nm
      from public.payment_methods
     where id = v_method and school_id = v_school
       and deleted_at is null and is_active;

    if v_method_nm is null then
      raise exception 'To''lov usuli topilmadi' using errcode = '22023';
    end if;

    --  `channel` KASSA bo'lib qoladi — to'lovni kassir qabul qilgan.
    --  Naqdligini `method` hal qiladi (20260826130000).
    insert into public.payments
      (school_id, branch_id, student_id, amount, channel, status,
       paid_on, note, method_id, split_group_id,
       created_by, confirmed_by, confirmed_at)
    values
      (v_school, v_branch, p_student_id, v_amount, 'cash', 'confirmed',
       p_paid_on, p_note, v_method, v_group,
       (select auth.uid()), (select auth.uid()), now())
    returning id into v_payment_id;

    if v_first is null then v_first := v_payment_id; end if;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
    v_parts := v_parts || jsonb_build_object(
      'payment_id', v_payment_id,
      'method_id',  v_method,
      'method_name', v_method_nm,
      'amount',     v_amount);
  end loop;

  -- TZ 4.7.1.5 — raqamlar FILIAL bo'yicha uzluksiz ketma-ketlikda.
  --  Guruhga BITTA raqam: oila bitta to'lov qilgan, bitta qog'oz oladi.
  v_no := app.next_counter(v_school, v_branch, 'cash_receipt');

  select coalesce(nullif(upper(left(regexp_replace(name, '[^[:alnum:]]', '', 'g'), 3)), ''), 'FL')
    into v_prefix from public.branches where id = v_branch;

  v_code := 'KV-' || v_prefix || '-' || lpad(v_no::text, 6, '0');

  insert into public.cash_receipts
    (school_id, branch_id, payment_id, receipt_no, receipt_code, issued_by)
  values
    (v_school, v_branch, v_first, v_no, v_code, (select auth.uid()));

  select balance into v_balance
    from public.v_student_balances where student_id = p_student_id;

  -- TZ 4.7.1.3 — kvitansiya raqami ota-onaga yuboriladi. Summa
  --  JAMI: oila uchun bu bitta to'lov.
  perform app.enqueue_for_student(
    p_student_id, 'payment_received',
    jsonb_build_object(
      'amount',  to_char(v_total, 'FM999G999G999G990'),
      'receipt', v_code,
      'balance', to_char(coalesce(v_balance, 0), 'FM999G999G999G990'),
      'date',    to_char(p_paid_on, 'DD.MM.YYYY')));

  return jsonb_build_object(
    'split_group_id', v_group,
    'payment_id',     v_first,
    'receipt_no',     v_no,
    'receipt_code',   v_code,
    'total',          v_total,
    'parts',          v_parts,
    'part_count',     v_count,
    'balance',        v_balance);
end;
$$;

comment on function public.register_split_payment(uuid, jsonb, date, text) is
  'Aralash to''lov: har qism o''z usuli bilan alohida yoziladi, '
  'kvitansiya bitta. Kassa hisoboti naqd va naqdsizni ajrata olishi '
  'uchun qismlar birlashtirilmaydi.';

grant execute on function public.register_split_payment(uuid, jsonb, date, text)
  to authenticated;
