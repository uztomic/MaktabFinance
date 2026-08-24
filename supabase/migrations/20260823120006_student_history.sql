-- =====================================================================
--  31 — O'QUVCHI TARIXI, OTA-ONANI UZISH, XARAJAT KESIMI
--
--  Uchta bo'shliq yopiladi:
--
--  1. O'QUVCHI TARIXI. Audit jurnali bor, lekin unda qidirish uchun
--     jadval nomi va yozuv raqamini bilish kerak edi. Buxgalter esa
--     "shu bolaning kartochkasida nima o'zgargan" deb qaraydi. Bu
--     funksiya o'quvchiga tegishli barcha jadvaldagi o'zgarishni
--     bitta vaqt chizig'iga yig'adi.
--
--  2. OTA-ONANI UZISH. `student_parents` da DELETE siyosati ataylab
--     yo'q — mijoz bog'lanishni jimgina o'chirib yubormasin. Lekin
--     xato biriktirilgan ota-onani olib tashlash kerak bo'ladi.
--     Yechim: server funksiyasi. U huquqni tekshiradi, avval audit
--     jurnaliga yozadi, keyin bog'lanishni uzadi. Ota-ona yozuvining
--     O'ZI o'chirilmaydi — u boshqa farzandga bog'langan bo'lishi
--     mumkin (TZ 4.9.2).
--
--  3. XARAJAT KESIMI. Diagrammada kategoriya ulushi ko'rinadi, lekin
--     uni bosib ichkariga kirib bo'lmasdi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O'QUVCHI TARIXI
-- ---------------------------------------------------------------------

create or replace function public.student_history(
  p_student_id uuid,
  p_limit      int default 100
)
returns table (
  at           timestamptz,
  table_name   text,
  action       text,
  changed_keys text[],
  summary      text,
  user_name    text,
  impersonated boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid;
begin
  -- Huquq tekshiruvi: bu funksiya `security definer`, ya'ni RLS ni
  -- chetlab o'tadi. Shuning uchun o'quvchini ko'ra olishni ALOHIDA
  -- tasdiqlash shart — aks holda boshqa maktabning tarixi ochilardi.
  select s.school_id into v_school
    from public.students s
   where s.id = p_student_id
     and app.has_branch(s.branch_id);

  if v_school is null then
    raise exception 'O''quvchi topilmadi yoki ruxsat yo''q'
      using errcode = '42501';
  end if;

  return query
  with ids as (
    select p_student_id::text as rid, 'students' as tbl
    union all
    select c.id::text, 'contracts' from public.contracts c
     where c.student_id = p_student_id
    union all
    select pm.id::text, 'payments' from public.payments pm
     where pm.student_id = p_student_id
    union all
    select ss.id::text, 'student_services' from public.student_services ss
     where ss.student_id = p_student_id
    union all
    select i.id::text, 'invoices' from public.invoices i
     where i.student_id = p_student_id
    union all
    select pp.id::text, 'payment_proofs' from public.payment_proofs pp
     where pp.student_id = p_student_id
  )
  select
    a.at,
    a.table_name,
    a.action,
    a.changed_keys,
    -- Qisqa izoh: eng muhim maydonning yangi qiymati. To'liq farq
    -- audit jurnalining o'zida qoladi — bu yerda o'qish uchun qatorcha.
    case a.table_name
      when 'payments' then
        coalesce(a.after ->> 'amount', a.before ->> 'amount')
      when 'contracts' then
        coalesce(a.after ->> 'tuition_amount', a.before ->> 'tuition_amount')
      when 'invoices' then
        coalesce(a.after ->> 'period', a.before ->> 'period')
      when 'students' then
        coalesce(a.after ->> 'status', a.before ->> 'status')
      when 'payment_proofs' then
        coalesce(a.after ->> 'status', a.before ->> 'status')
      else null
    end,
    u.full_name,
    a.impersonated_by is not null
  from public.audit_log a
  join ids on ids.rid = a.record_id and ids.tbl = a.table_name
  left join public.app_users u on u.id = a.user_id
  where a.school_id = v_school
  order by a.at desc
  limit greatest(1, least(p_limit, 500));
end;
$$;

comment on function public.student_history(uuid, int) is
  'O''quvchiga tegishli barcha o''zgarish bitta vaqt chizig''ida: '
  'shartnoma, to''lov, xizmat, hisoblanma, chek (TZ 5.4.10).';

-- ---------------------------------------------------------------------
-- 2. OTA-ONANI O'QUVCHIDAN UZISH
-- ---------------------------------------------------------------------

create or replace function public.detach_parent(
  p_student_id uuid,
  p_parent_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link   public.student_parents%rowtype;
  v_school uuid;
  v_branch uuid;
  v_others int;
begin
  select s.school_id, s.branch_id into v_school, v_branch
    from public.students s where s.id = p_student_id;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(v_branch);

  select * into v_link from public.student_parents
   where student_id = p_student_id and parent_id = p_parent_id;

  if not found then
    raise exception 'Bog''lanish topilmadi' using errcode = '22023';
  end if;

  -- Avval jurnalga — o'chirgandan keyin yozadigan bo'lsak, `delete`
  -- muvaffaqiyatli bo'lib jurnal yozuvi tushmay qolishi mumkin.
  insert into public.audit_log
    (school_id, user_id, table_name, record_id, action, before,
     impersonated_by)
  values
    (v_school, (select auth.uid()), 'student_parents',
     p_student_id::text || ':' || p_parent_id::text, 'DELETE',
     to_jsonb(v_link),
     nullif(app.jwt_claim('imp_admin'), '')::uuid);

  delete from public.student_parents
   where student_id = p_student_id and parent_id = p_parent_id;

  -- Ota-ona boshqa farzandga bog'langan bo'lsa, yozuvi qoladi.
  select count(*)::int into v_others
    from public.student_parents where parent_id = p_parent_id;

  return jsonb_build_object(
    'detached', true,
    'parent_still_linked_to', v_others);
end;
$$;

comment on function public.detach_parent(uuid, uuid) is
  'Ota-onani o''quvchidan uzadi. Ota-ona yozuvi o''chirilmaydi — u '
  'boshqa farzandga bog''langan bo''lishi mumkin (TZ 4.9.2).';

-- ---------------------------------------------------------------------
-- 3. XARAJAT KATEGORIYASI KESIMI
--
--  `report_expenses` kategoriya bo'yicha jamlaydi. Bu esa aksincha —
--  bitta kategoriya ichidagi yozuvlarni beradi (diagrammani bosganda).
-- ---------------------------------------------------------------------

create or replace function public.report_expense_detail(
  p_from        date,
  p_to          date,
  p_category_id uuid default null,
  p_branch_id   uuid default null
)
returns table (
  id            uuid,
  spent_on      date,
  amount        numeric,
  category_id   uuid,
  category_name text,
  branch_id     uuid,
  branch_name   text,
  payment_method text,
  note          text,
  is_payroll    boolean,
  created_by    text
)
language sql
stable
as $$
  select
    e.id, e.spent_on, e.amount, e.category_id, ec.name,
    e.branch_id, b.name, e.payment_method, e.note,
    e.payroll_run_id is not null,
    u.full_name
  from public.expenses e
  join public.branches b on b.id = e.branch_id
  left join public.expense_categories ec on ec.id = e.category_id
  left join public.app_users u on u.id = e.created_by
  where e.deleted_at is null
    and e.spent_on between p_from and p_to
    and (p_category_id is null or e.category_id = p_category_id)
    and (p_branch_id is null or e.branch_id = p_branch_id)
  order by e.spent_on desc, e.amount desc;
$$;

comment on function public.report_expense_detail(date, date, uuid, uuid) is
  'Bitta xarajat kategoriyasi ichidagi yozuvlar — diagrammadan '
  'ichkariga kirish uchun (TZ 4.12.6).';

-- =====================================================================
--  HUQUQLAR
-- =====================================================================

do $do$
declare f text;
begin
  foreach f in array array[
    'public.student_history(uuid, int)',
    'public.detach_parent(uuid, uuid)',
    'public.report_expense_detail(date, date, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;
