-- =====================================================================
--  28 — SINF HISOBOTI VA TAHRIRLASH FUNKSIYALARI
--
--  Beshta yangi server funksiyasi:
--    · report_by_class          — "qaysi sinfdan qancha yig'ildi"
--    · edit_payment             — to'lovni tahrirlash (audit bilan)
--    · revise_payment_proof     — chekni qayta ko'rib chiqish
--    · promote_classes          — yillik ko'chirish (5-A → 6-A)
--    · assign_service_to_class  — butun sinfga xizmat biriktirish
--
--  TAHRIRLASH HAQIDA: moliyaviy jadvallarga mijozdan yozish 10-migratsiyada
--  ataylab yopilgan (TZ 5.4.6). Shuning uchun tahrirlash shu funksiyalar
--  orqali bo'ladi — ular huquq, filial va davr qulfini tekshiradi, audit
--  triggeri esa eski/yangi qiymatni o'zi yozadi (TZ 5.4.10). RLS ochilmaydi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SINF KESIMIDAGI HISOBOT (TZ 4.12)
--
--  `security invoker` — RLS chaqiruvchiga qo'llanadi, ya'ni hisobot
--  avtomatik ravishda faqat o'z maktabi va ochiq filiallari bo'yicha
--  chiqadi. Bu `report_pnl` bilan bir xil naqsh.
-- ---------------------------------------------------------------------

create or replace function public.report_by_class(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  class_id      uuid,
  class_name    text,
  grade_level   smallint,
  branch_id     uuid,
  branch_name   text,
  teacher_name  text,
  students      integer,
  charged       numeric,
  collected     numeric,
  debt          numeric,
  avg_per_student numeric
)
language sql
stable
as $$
  select
    c.id,
    c.name,
    c.grade_level,
    c.branch_id,
    b.name,
    te.full_name,
    count(distinct s.id)::integer as students,
    coalesce(inv.charged, 0)::numeric(14,2),
    coalesce(pay.collected, 0)::numeric(14,2),
    coalesce(bal.debt, 0)::numeric(14,2),
    case when count(distinct s.id) > 0
         then round(coalesce(inv.charged, 0) / count(distinct s.id), 2)
         else 0 end
  from public.classes c
  join public.branches b on b.id = c.branch_id
  left join public.teachers te on te.id = c.teacher_id
  left join public.students s
         on s.class_id = c.id and s.deleted_at is null
  -- Hisoblangan: shu sinf o'quvchilarining davrga tushgan hisoblanmalari
  left join lateral (
    select sum(t.total) as charged
      from public.v_invoice_totals t
      join public.students s2 on s2.id = t.student_id
     where s2.class_id = c.id
       and t.status <> 'cancelled'
       and t.period between date_trunc('month', p_from)::date and p_to
  ) inv on true
  -- Yig'ilgan: FAQAT tasdiqlangan to'lovlar (TZ 4.7.3)
  left join lateral (
    select sum(p.amount) as collected
      from public.payments p
      join public.students s3 on s3.id = p.student_id
     where s3.class_id = c.id
       and p.status = 'confirmed'
       and p.paid_on between p_from and p_to
  ) pay on true
  -- Joriy qarzdorlik (davrga bog'liq emas — bugungi holat)
  left join lateral (
    select sum(v.balance) filter (where v.balance > 0) as debt
      from public.v_student_balances v
      join public.students s4 on s4.id = v.student_id
     where s4.class_id = c.id
  ) bal on true
  where c.deleted_at is null
    and (p_branch_id is null or c.branch_id = p_branch_id)
  group by c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
           inv.charged, pay.collected, bal.debt
  order by c.grade_level nulls last, c.name;
$$;

comment on function public.report_by_class(date, date, uuid) is
  'TZ 4.12 — sinf kesimidagi moliyaviy hisobot: qaysi sinfdan qancha '
  'hisoblangan, yig''ilgan va qancha qarzdorlik qolgan.';

-- ---------------------------------------------------------------------
-- 2. TO'LOVNI TAHRIRLASH
--
--  Kvitansiya raqami ota-onaga allaqachon yuborilgan bo'lishi mumkin.
--  Shuning uchun SUMMA o'zgarsa ota-onaga tuzatish xabari yuboriladi —
--  aks holda uning qo'lidagi raqam bazadagidan farq qiladi.
-- ---------------------------------------------------------------------

create or replace function public.edit_payment(
  p_payment_id uuid,
  p_amount     numeric,
  p_paid_on    date,
  p_note       text default null,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p           public.payments%rowtype;
  v_receipt   text;
  v_balance   numeric(14,2);
  v_changed   boolean;
begin
  select * into p from public.payments where id = p_payment_id;
  if not found then
    raise exception 'To''lov topilmadi' using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'To''lov summasi noldan katta bo''lishi kerak'
      using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(p.branch_id);

  -- Eski VA yangi sana — ikkalasi ham ochiq davrda bo'lishi kerak,
  -- aks holda yozuvni yopilgan davrdan ko'chirib chiqarish mumkin edi.
  perform app.assert_period_open(p.school_id, p.paid_on, p.branch_id);
  perform app.assert_period_open(p.school_id, p_paid_on, p.branch_id);

  v_changed := (p.amount <> p_amount);

  update public.payments
     set amount  = p_amount,
         paid_on = p_paid_on,
         note    = coalesce(p_note, note)
   where id = p_payment_id;

  select balance into v_balance
    from public.v_student_balances where student_id = p.student_id;

  -- Kassa kvitansiyasi bo'lsa va summa o'zgargan bo'lsa — ota-onaga
  -- tuzatish xabari (TZ 4.9 uslubi).
  if v_changed then
    select receipt_code into v_receipt
      from public.cash_receipts where payment_id = p_payment_id;

    perform app.enqueue_for_student(
      p.student_id, 'payment_corrected',
      jsonb_build_object(
        'old_amount', to_char(p.amount, 'FM999G999G999G990'),
        'amount',     to_char(p_amount, 'FM999G999G999G990'),
        'receipt',    coalesce(v_receipt, '—'),
        'balance',    to_char(coalesce(v_balance, 0), 'FM999G999G999G990'),
        'reason',     coalesce(p_reason, '')));
  end if;

  return jsonb_build_object(
    'payment_id',  p_payment_id,
    'old_amount',  p.amount,
    'amount',      p_amount,
    'notified',    v_changed,
    'balance',     v_balance);
end;
$$;

comment on function public.edit_payment(uuid, numeric, date, text, text) is
  'To''lovni tahrirlash. Audit triggeri eski/yangi qiymatni yozadi '
  '(TZ 5.4.10). Summa o''zgarsa ota-onaga tuzatish xabari ketadi.';

-- ---------------------------------------------------------------------
-- 3. CHEKNI QAYTA KO'RIB CHIQISH
--
--  Rad etilgan chekni tasdiqlash yoki tasdiqlangan chekning summasini
--  tuzatish. Har ikkala holatda bog'liq to'lov yozuvi ham to'g'rilanadi.
-- ---------------------------------------------------------------------

create or replace function public.revise_payment_proof(
  p_proof_id uuid,
  p_action   text,               -- 'confirm' | 'reject' | 'amend'
  p_amount   numeric default null,
  p_reason   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr        public.payment_proofs%rowtype;
  v_payment uuid;
begin
  select * into pr from public.payment_proofs where id = p_proof_id;
  if not found then
    raise exception 'Chek topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payments.create');
  perform app.assert_branch(pr.branch_id);

  -- --- Rad etilganni tasdiqlash --------------------------------------
  if p_action = 'confirm' then
    if pr.payment_id is not null then
      raise exception 'Bu chek allaqachon tasdiqlangan' using errcode = '22023';
    end if;
    if p_amount is null or p_amount <= 0 then
      raise exception 'Summa ko''rsatilmagan' using errcode = '22023';
    end if;

    perform app.assert_period_open(pr.school_id, pr.submitted_at::date, pr.branch_id);

    insert into public.payments
      (school_id, branch_id, student_id, amount, channel, status,
       paid_on, note, created_by, confirmed_by, confirmed_at)
    values
      (pr.school_id, pr.branch_id, pr.student_id, p_amount, 'proof', 'confirmed',
       pr.submitted_at::date,
       'Telegram chek #' || left(pr.id::text, 8) || ' (qayta ko''rildi)',
       (select auth.uid()), (select auth.uid()), now())
    returning id into v_payment;

    update public.payment_proofs
       set status = 'confirmed', payment_id = v_payment,
           reject_reason = null,
           reviewed_by = (select auth.uid()), reviewed_at = now()
     where id = p_proof_id;

    perform app.enqueue_for_student(
      pr.student_id, 'proof_confirmed',
      jsonb_build_object('amount', to_char(p_amount, 'FM999G999G999G990'),
                         'balance', '—'));

  -- --- Tasdiqlanganni rad etish --------------------------------------
  elsif p_action = 'reject' then
    if pr.payment_id is not null then
      -- Bog'liq to'lovni bekor qilamiz (yozuv o'chirilmaydi, TZ 5.4.8).
      update public.payments
         set status = 'cancelled',
             cancelled_reason = coalesce(p_reason, 'Chek qayta ko''rildi')
       where id = pr.payment_id;
    end if;

    update public.payment_proofs
       set status = 'rejected', payment_id = null,
           reject_reason = p_reason,
           reviewed_by = (select auth.uid()), reviewed_at = now()
     where id = p_proof_id;

    perform app.enqueue_for_student(
      pr.student_id, 'proof_rejected',
      jsonb_build_object('reason', coalesce(p_reason, '')));

  -- --- Summani tuzatish ----------------------------------------------
  elsif p_action = 'amend' then
    if pr.payment_id is null then
      raise exception 'Bu chekka to''lov bog''lanmagan' using errcode = '22023';
    end if;
    if p_amount is null or p_amount <= 0 then
      raise exception 'Summa ko''rsatilmagan' using errcode = '22023';
    end if;

    perform public.edit_payment(
      pr.payment_id, p_amount, null, null, p_reason);

    update public.payment_proofs
       set amount_claimed = p_amount,
           reviewed_by = (select auth.uid()), reviewed_at = now()
     where id = p_proof_id;

  else
    raise exception 'Noma''lum amal: %', p_action using errcode = '22023';
  end if;

  return jsonb_build_object('proof_id', p_proof_id, 'action', p_action);
end;
$$;

comment on function public.revise_payment_proof(uuid, text, numeric, text) is
  'Chekni qayta ko''rib chiqish: rad etilganni tasdiqlash, tasdiqlanganni '
  'rad etish yoki summasini tuzatish.';

-- ---------------------------------------------------------------------
-- 4. YILLIK KO'CHIRISH (5-A → 6-A)
--
--  Bitiruvchi sinf o'quvchilari KO'CHIRILMAYDI — ular ro'yxatda qoladi
--  va maktab ular bilan nima qilishni o'zi hal qiladi (chiqarish yoki
--  qoldirish). Funksiya faqat nechtasi ekanini qaytaradi.
-- ---------------------------------------------------------------------

create or replace function public.promote_classes(
  p_from_year   text,
  p_to_year     text,
  p_branch_id   uuid default null,
  p_final_grade smallint default 11
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c            record;
  v_target     uuid;
  v_new_name   text;
  v_moved      int := 0;
  v_classes    int := 0;
  v_graduating int := 0;
  v_school     uuid;
begin
  perform app.assert_may_write('students.manage');

  v_school := app.school_id();
  if v_school is null and p_branch_id is not null then
    select school_id into v_school from public.branches where id = p_branch_id;
  end if;
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;

  for c in
    select cl.*, count(s.id) as student_count
      from public.classes cl
      left join public.students s
             on s.class_id = cl.id and s.deleted_at is null
                and s.status = 'active'
     where cl.school_id = v_school
       and cl.academic_year = p_from_year
       and cl.deleted_at is null
       and cl.is_active
       and (p_branch_id is null or cl.branch_id = p_branch_id)
     group by cl.id
     order by cl.grade_level nulls last, cl.name
  loop
    -- Bitiruvchi sinf — ko'chirilmaydi.
    if c.grade_level is not null and c.grade_level >= p_final_grade then
      v_graduating := v_graduating + c.student_count;
      continue;
    end if;

    -- Yangi nom: "5-A" → "6-A". Bosqich raqami almashtiriladi.
    v_new_name := case
      when c.grade_level is not null
       and c.name ~ ('^' || c.grade_level || '\M')
      then regexp_replace(c.name, '^' || c.grade_level, (c.grade_level + 1)::text)
      else c.name
    end;

    select id into v_target
      from public.classes
     where branch_id = c.branch_id
       and academic_year = p_to_year
       and name = v_new_name
       and deleted_at is null;

    if v_target is null then
      insert into public.classes
        (school_id, branch_id, name, grade_level, teacher_id,
         capacity, academic_year)
      values
        (c.school_id, c.branch_id, v_new_name,
         coalesce(c.grade_level + 1, null), c.teacher_id,
         c.capacity, p_to_year)
      returning id into v_target;
      v_classes := v_classes + 1;
    end if;

    update public.students
       set class_id = v_target
     where class_id = c.id
       and status = 'active'
       and deleted_at is null;

    get diagnostics v_moved = row_count;
  end loop;

  -- Eski o'quv yili sinflari arxivga o'tadi (o'chirilmaydi).
  update public.classes
     set is_active = false
   where school_id = v_school
     and academic_year = p_from_year
     and deleted_at is null
     and (p_branch_id is null or branch_id = p_branch_id);

  return jsonb_build_object(
    'from_year',   p_from_year,
    'to_year',     p_to_year,
    'classes_created', v_classes,
    'students_moved',  v_moved,
    'graduating',      v_graduating);
end;
$$;

comment on function public.promote_classes(text, text, uuid, smallint) is
  'Yillik ko''chirish: 5-A → 6-A. Bitiruvchi sinf o''quvchilari '
  'ko''chirilmaydi, faqat soni qaytariladi. Eski yil sinflari arxivga o''tadi.';

-- ---------------------------------------------------------------------
-- 5. SINFGA OMMAVIY XIZMAT BIRIKTIRISH (TZ 4.4.2)
-- ---------------------------------------------------------------------

create or replace function public.assign_service_to_class(
  p_class_id   uuid,
  p_service_id uuid,
  p_starts_on  date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school  uuid;
  v_branch  uuid;
  v_added   int := 0;
  v_skipped int := 0;
begin
  select school_id, branch_id into v_school, v_branch
    from public.classes where id = p_class_id and deleted_at is null;

  if v_school is null then
    raise exception 'Sinf topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('services.manage');
  perform app.assert_branch(v_branch);

  -- Xizmat shu filialga tegishlimi?
  if not exists (
    select 1 from public.services
     where id = p_service_id and branch_id = v_branch and deleted_at is null
  ) then
    raise exception 'Xizmat bu filialga tegishli emas' using errcode = '22023';
  end if;

  with target as (
    select s.id
      from public.students s
     where s.class_id = p_class_id
       and s.status = 'active'
       and s.deleted_at is null
       -- Allaqachon amaldagi yozuvi borlarni o'tkazib yuboramiz.
       and not exists (
         select 1 from public.student_services ss
          where ss.student_id = s.id
            and ss.service_id = p_service_id
            and (ss.ends_on is null or ss.ends_on >= p_starts_on)
       )
  ),
  inserted as (
    insert into public.student_services
      (school_id, student_id, service_id, starts_on, created_by)
    select v_school, t.id, p_service_id, p_starts_on, (select auth.uid())
      from target t
    returning 1
  )
  select count(*) into v_added from inserted;

  select count(*) into v_skipped
    from public.students s
   where s.class_id = p_class_id
     and s.status = 'active'
     and s.deleted_at is null;

  return jsonb_build_object(
    'added',   v_added,
    'skipped', greatest(0, v_skipped - v_added));
end;
$$;

comment on function public.assign_service_to_class(uuid, uuid, date) is
  'Butun sinfga xizmat biriktiradi. Allaqachon yozilganlarni o''tkazib '
  'yuboradi — takroriy chaqiruv dublikat yaratmaydi.';

-- =====================================================================
--  HUQUQLAR
-- =====================================================================

do $do$
declare f text;
begin
  foreach f in array array[
    'public.report_by_class(date, date, uuid)',
    'public.edit_payment(uuid, numeric, date, text, text)',
    'public.revise_payment_proof(uuid, text, numeric, text)',
    'public.promote_classes(text, text, uuid, smallint)',
    'public.assign_service_to_class(uuid, uuid, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

-- =====================================================================
--  BOT MATNI: to'lov tuzatildi (TZ 5.6.5 — matn bazada)
-- =====================================================================

insert into public.translations (scope, key, lang, text, school_id)
values
('bot', 'payment_corrected', 'uz',
 E'✏️ To''lovingiz tuzatildi.\n\nOldingi summa: {old_amount} so''m\nYangi summa: *{amount} so''m*\nKvitansiya: `{receipt}`\nJoriy qoldiq: *{balance} so''m*\n\n_Savol bo''lsa maktab buxgalteriga murojaat qiling._', null),
('bot', 'payment_corrected', 'ru',
 E'✏️ Ваш платёж скорректирован.\n\nПрежняя сумма: {old_amount} сум\nНовая сумма: *{amount} сум*\nКвитанция: `{receipt}`\nТекущий остаток: *{balance} сум*\n\n_По вопросам обращайтесь в бухгалтерию школы._', null),
('bot', 'payment_corrected', 'uz-cyrl',
 E'✏️ Тўловингиз тузатилди.\n\nОлдинги сумма: {old_amount} сўм\nЯнги сумма: *{amount} сўм*\nКвитанция: `{receipt}`\nЖорий қолдиқ: *{balance} сўм*', null)
on conflict do nothing;
