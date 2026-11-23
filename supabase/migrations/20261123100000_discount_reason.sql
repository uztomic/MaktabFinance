-- =====================================================================
--  CHEGIRMA SABABI
--
--  "Tushum tarkibi" hisobotida bir nechta bir xil "Chegirmalar" qatori
--  turardi va hech biri NEGA berilgani aytilmasdi. Sabab:
--    · shartnomadagi qo'lda kiritilgan chegirmada sabab maydoni yo'q edi;
--    · hisobot hamma chegirmani bitta nom bilan atardi va qatorlar
--      faqat ichki matn (foiz) bo'yicha ajralib qolardi.
--
--  Endi:
--    · `contracts.discount_reason` — qo'lda kiritilgan chegirmaning
--      sababi (panelda majburiy);
--    · hisobotda chegirma nomi: chegirma turi ("2-farzand") YOKI
--      shartnomadagi sabab YOKI bir martalik chegirma sababi.
--      Sababsizlari "sababi ko'rsatilmagan" deb alohida chiqadi —
--      direktor ularni ko'rib, to'ldirtira oladi.
-- =====================================================================

alter table public.contracts
  add column if not exists discount_reason text;

comment on column public.contracts.discount_reason is
  'Qo''lda kiritilgan chegirma sababi (masalan: "Ko''p bolali oila"). '
  'Chegirma turi tanlanganda bo''sh — sabab turning nomida.';

create or replace function public.report_revenue_mix(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  branch_id    uuid,
  branch_name  text,
  service_code text,
  service_name text,
  line_kind    public.invoice_line_kind,
  quantity     numeric,
  amount       numeric
)
language sql
stable
set search_path = ''
as $$
  select x.branch_id, x.branch_name, x.code, x.name, x.kind,
         sum(x.quantity)::numeric(14,2), sum(x.amount)::numeric(14,2)
    from (
      select
        i.branch_id,
        b.name as branch_name,
        coalesce(sv.code, l.kind::text) as code,
        case l.kind
          when 'tuition'    then 'O''qish to''lovi'
          when 'discount'   then 'Chegirma — ' || coalesce(
            --  Bir martalik chegirma: sabab qatorning o'zida.
            nullif(btrim(l.source->>'reason'), ''),
            --  Shartnoma chegirmasi: avval qo'lda yozilgan sabab
            --  (u turdan ustun — app.contract_discount ham shunday),
            --  keyin chegirma turi nomi.
            case when c.discount_kind is not null
                 then nullif(btrim(c.discount_reason), '') end,
            dt.name,
            'sababi ko''rsatilmagan')
          when 'adjustment' then 'Tuzatishlar'
          when 'carryover'  then 'O''tgan davr tuzatuvi'
          else coalesce(sv.name, l.description)
        end as name,
        l.kind,
        l.quantity,
        l.amount
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
      join public.branches b on b.id = i.branch_id
      left join public.services sv on sv.id = l.service_id
      left join public.contracts c on c.id = i.contract_id
      left join public.discount_types dt on dt.id = c.discount_type_id
      where i.status <> 'cancelled'
        and i.period between date_trunc('month', p_from)::date and p_to
        and (p_branch_id is null or i.branch_id = p_branch_id)
    ) x
   group by x.branch_id, x.branch_name, x.code, x.name, x.kind
   order by x.branch_name, sum(x.amount) desc;
$$;

comment on function public.report_revenue_mix(date, date, uuid) is
  'TZ 4.12 — tushum tarkibi xizmat turlari bo''yicha. Chegirmalar '
  'SABABI bilan alohida qatorlarda.';

grant execute on function public.report_revenue_mix(date, date, uuid)
  to authenticated, service_role;
