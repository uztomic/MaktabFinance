-- =====================================================================
--  43 — YAXLITLASH USHLANMA EMAS
--
--  MUAMMO. `v_payroll_totals` jamlanmani juda sodda hisoblardi:
--  musbat qatorlar — "hisoblangan", manfiy qatorlar — "ushlanma".
--
--  Yaxlitlash qatori esa ikkalasiga ham tushmasligi kerak. U —
--  ne hisoblangan haq, ne ushlanma; u shunchaki summani ming so'mgacha
--  yaxlitlash uchun qo'shilgan farq (odatda 100 so'mdan kichik).
--
--  Amalda bu shunday ko'rinardi:
--
--      Jami hisoblangan   3 165 950
--      Ushlanmalar         −379 950     ← aslida soliq 379 914
--      Qo'lga tegadigan   2 786 000
--
--  Farqi 36 so'm — kichik, lekin buxgalter soliq hisobotini AYNAN shu
--  ustundan oladi. 22 o'qituvchi bo'yicha yig'ilganda soliq summasi
--  deklaratsiyaga to'g'ri kelmaydi va sabab uzoq izlanadi.
--
--  Endi yaxlitlash alohida ustun. `net_total` o'zgarmaydi — u
--  boshidan barcha qatorlar yig'indisi edi va to'g'ri hisoblanardi.
-- =====================================================================

create or replace view public.v_payroll_totals
with (security_invoker = true) as
  select
    r.id         as payroll_run_id,
    r.school_id,
    r.teacher_id,
    r.period,
    r.status,

    --  Qo'lga tegadigan summa: BARCHA qatorlar yig'indisi,
    --  yaxlitlash ham shu yerda hisobga olinadi.
    coalesce(sum(l.amount), 0)::numeric(14,2) as net_total,

    --  Hisoblangan va ushlangan summalarda yaxlitlash QATNASHMAYDI.
    coalesce(sum(l.amount) filter (
      where l.amount > 0 and l.source_kind <> 'rounding'), 0)::numeric(14,2)
      as gross_total,

    coalesce(-sum(l.amount) filter (
      where l.amount < 0 and l.source_kind <> 'rounding'), 0)::numeric(14,2)
      as deductions_total,

    coalesce(sum(l.amount) filter (
      where l.source_kind = 'rounding'), 0)::numeric(14,2)
      as rounding_total

  from public.payroll_runs r
  left join public.payroll_lines l on l.payroll_run_id = r.id
  group by r.id;

comment on view public.v_payroll_totals is
  'Oylik hisobi jamlanmasi. Yaxlitlash ALOHIDA ustunda: u ushlanma '
  'ham, hisoblangan haq ham emas. `net_total` barcha qatorlar '
  'yig''indisi va yaxlitlashni ham o''z ichiga oladi.';

-- ---------------------------------------------------------------------
--  Ro'yxat hisoboti ham yaxlitlashni alohida qaytaradi — panel
--  jadvalidagi uch raqam bir-biriga to'g'ri kelsin.
-- ---------------------------------------------------------------------

drop function if exists public.report_payroll(date);

create or replace function public.report_payroll(p_period date)
returns table (
  payroll_run_id uuid,
  teacher_id     uuid,
  teacher_name   text,
  status         public.payroll_status,
  gross_total    numeric,
  deductions     numeric,
  rounding       numeric,
  net_total      numeric,
  hours          numeric
)
language sql
stable
set search_path = ''
as $$
  select
    t.payroll_run_id,
    t.teacher_id,
    te.full_name,
    t.status,
    t.gross_total,
    t.deductions_total,
    t.rounding_total,
    t.net_total,
    coalesce((
      select sum(l.hours) from public.lessons l
       where l.teacher_id = t.teacher_id
         and l.day between r.period_from and r.period_to
         and l.kind in ('held', 'substituted')
    ), 0)
  from public.v_payroll_totals t
  join public.payroll_runs r on r.id = t.payroll_run_id
  join public.teachers te on te.id = t.teacher_id
  where t.period = date_trunc('month', p_period)::date
    and t.status <> 'cancelled'
  order by te.full_name;
$$;

comment on function public.report_payroll(date) is
  'Oy bo''yicha barcha o''qituvchi hisoblari. Yaxlitlash alohida '
  'ustunda — shunda jadvaldagi raqamlar bir-biriga to''g''ri keladi.';

revoke all on function public.report_payroll(date) from public, anon;
grant execute on function public.report_payroll(date) to authenticated, service_role;
