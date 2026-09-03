-- =====================================================================
--  ESKIRGAN HISOBLANMA
--
--  Bitta o'quvchida hisoblanma 1 700 000, shartnomada esa 1 500 000
--  turgan edi. Sabab oddiy: hisoblanma 1-sentabrda qurilgan,
--  shartnoma 3-sentabrda tuzatilgan. Hisoblanma esa o'z-o'zidan
--  yangilanmaydi.
--
--  Buni hech kim sezmaydi. Avtomatik cron ham yordam bermaydi: u
--  faqat davrda BITTA HAM hisoblanma bo'lmagan filialga yozadi —
--  bor joyga ataylab tegmaydi, chunki qo'lda kiritilgan qatorni
--  o'chirib yuborardi.
--
--  Shuning uchun bu holat ko'rsatiladi: "N ta hisoblanma
--  shartnomadan farq qiladi". Qayta shakllantirish qarori
--  odamniki — u tasdiqlangan hisoblanmaga tegmaydi va qo'lda
--  qo'shilgan qatorni qayta quradi.
-- =====================================================================

create or replace function public.stale_invoices(
  p_branch_id uuid,
  p_period    date
)
returns table (
  invoice_id   uuid,
  student_id   uuid,
  student_name text,
  class_name   text,
  charged      numeric,
  expected     numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    st.id,
    st.full_name,
    st.class_name,
    t.total,
    app.student_month_amount(st.id, date_trunc('month', p_period)::date)
  from public.invoices i
  join public.students st on st.id = i.student_id
  join public.v_invoice_totals t on t.invoice_id = i.id
 where i.branch_id = p_branch_id
   and i.period = date_trunc('month', p_period)::date
   --  Tasdiqlangandan boshqasi. `generate_invoices` ham aynan
   --  shu chegara bilan ishlaydi: tasdiqlangan hisoblanma
   --  qulflangan, qolgani qayta quriladi.
   and i.status not in ('approved', 'cancelled')
   and st.deleted_at is null
   --  Farq bir so'mdan katta bo'lsa. Yaxlitlash farqi hisobga
   --  olinmaydi — u xato emas.
   and abs(t.total
           - app.student_month_amount(st.id,
               date_trunc('month', p_period)::date)) > 1
 order by st.class_name, st.full_name;
$$;

comment on function public.stale_invoices(uuid, date) is
  'Shartnomadan farq qiladigan hisoblanmalar. Odatda shartnoma '
  'hisoblanmadan KEYIN tuzatilgan bo''ladi. Tasdiqlangani '
  'chiqarilmaydi — u ataylab qulflangan.';

grant execute on function public.stale_invoices(uuid, date) to authenticated;
