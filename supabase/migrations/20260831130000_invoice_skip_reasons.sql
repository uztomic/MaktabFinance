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
--  Bu funksiya HECH NARSA YOZMAYDI — faqat sanaydi. Mantiq
--  `generate_invoices` dagi bilan bir xil (20260822120012, 200-215
--  qatorlar), shuning uchun raqamlar mos tushadi.
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
    select st.enrolled_on, st.left_on,
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
  end loop;

  return jsonb_build_object(
    'period',      v_period,
    'ok',          v_ok,
    'not_started', v_not_started,
    'ended',       v_ended,
    'left',        v_left,
    'summer',      v_summer,
    'no_contract', v_no_contract,
    'first_period', v_first);
end;
$$;

comment on function public.invoice_skip_reasons(uuid, date) is
  'Davrda nechta o''quvchi hisoblanmaga tushadi va tushmaganlari '
  'NEGA tushmaydi. Faqat o''qiydi. Mantiq generate_invoices bilan bir xil.';

grant execute on function public.invoice_skip_reasons(uuid, date)
  to authenticated;
