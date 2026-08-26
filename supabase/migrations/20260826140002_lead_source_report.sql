-- =====================================================================
--  46 — ODAMLAR QAYERDAN KELYAPTI
--
--  Murojaat manbasi (`leads.source`) yozib borilardi, lekin uni
--  KESIMDA ko'rish joyi yo'q edi. Direktor "Instagramga pul sarflash
--  foyda beryaptimi?" degan savolga javob ololmasdi — murojaatlar
--  ro'yxatini qo'lda sanashdan boshqa yo'l yo'q edi.
--
--  Hisobot uch qatlamli, chunki bitta raqam yetarli emas:
--
--    1. NECHTA murojaat keldi — kanalning hajmi;
--    2. NECHTASI o'quvchiga aylandi — kanalning SIFATI. Ko'p murojaat
--       kelib, hech biri qolmasligi mumkin;
--    3. QANCHA PUL yig'ilgan — pirovard natija. Aynan shu raqam
--       reklama byudjetini taqsimlashga asos bo'ladi.
--
--  MUROJAATSIZ QABUL QILINGANLAR ham alohida qator bo'lib chiqadi.
--  Bu ataylab: agar o'quvchilarning yarmi shu qatorda bo'lsa, demak
--  xodimlar manbani yozmayapti va yuqoridagi barcha foizlar yarim
--  ma'lumotga asoslangan. Buni yashirish hisobotni yolg'on qiladi.
-- =====================================================================

create or replace function public.report_lead_sources(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  source          text,
  is_direct       boolean,
  leads           integer,
  accepted        integer,
  rejected        integer,
  open_count      integer,
  conversion      numeric,
  students_active integer,
  collected       numeric
)
language sql
stable
as $$
  with scoped as (
    select
      coalesce(nullif(btrim(l.source), ''), '') as source,
      l.status,
      l.student_id
    from public.leads l
    where l.created_at::date between p_from and p_to
      and (p_branch_id is null or l.branch_id = p_branch_id)
  ),
  agg as (
    select
      s.source,
      count(*)                                                   as leads,
      count(*) filter (where s.status = 'accepted')              as accepted,
      count(*) filter (where s.status = 'rejected')              as rejected,
      count(*) filter (where s.status in ('new', 'contacted', 'visited'))
                                                                 as open_count,
      array_remove(array_agg(s.student_id), null)                as student_ids
    from scoped s
    group by s.source
  ),
  --  Murojaatsiz kelgan o'quvchilar: qabul sanasi shu oraliqda,
  --  lekin ularni hech qanday murojaatga bog'lab bo'lmaydi.
  direct as (
    select array_agg(st.id) as student_ids
      from public.students st
     where st.deleted_at is null
       and st.enrolled_on between p_from and p_to
       and (p_branch_id is null or st.branch_id = p_branch_id)
       and not exists (
         select 1 from public.leads l where l.student_id = st.id)
  )
  select
    nullif(a.source, ''),
    false,
    a.leads::integer,
    a.accepted::integer,
    a.rejected::integer,
    a.open_count::integer,
    (case when a.leads > 0
          then round(100.0 * a.accepted / a.leads, 1)
          else 0 end)::numeric(5,1),
    (select count(*)::integer from public.students st
      where st.id = any(a.student_ids)
        and st.status = 'active' and st.deleted_at is null),
    coalesce((select sum(p.amount) from public.payments p
               where p.student_id = any(a.student_ids)
                 and p.status = 'confirmed'), 0)::numeric(14,2)
  from agg a

  union all

  select
    null, true, 0, 0, 0, 0, null,
    (select count(*)::integer from public.students st
      where st.id = any(d.student_ids)
        and st.status = 'active' and st.deleted_at is null),
    coalesce((select sum(p.amount) from public.payments p
               where p.student_id = any(d.student_ids)
                 and p.status = 'confirmed'), 0)::numeric(14,2)
  from direct d
  where coalesce(array_length(d.student_ids, 1), 0) > 0

  order by 3 desc, 9 desc;
$$;

comment on function public.report_lead_sources(date, date, uuid) is
  'Qaysi kanaldan qancha murojaat kelgan, nechtasi o''quvchiga '
  'aylangan va ulardan qancha pul yig''ilgan. Murojaatsiz qabul '
  'qilinganlar ham alohida qator bo''lib chiqadi.';

revoke all on function public.report_lead_sources(date, date, uuid)
  from public, anon;
grant execute on function public.report_lead_sources(date, date, uuid)
  to authenticated, service_role;
