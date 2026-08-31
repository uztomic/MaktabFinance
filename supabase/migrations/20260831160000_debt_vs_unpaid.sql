-- =====================================================================
--  "QARZDOR" NIMA DEGANI?
--
--  Ekranda bir vaqtning o'zida shu ikkisi turardi:
--
--      HISOBLANGAN        0
--      QARZDORLAR        28
--      UMUMIY QARZDORLIK  26 900 000
--
--  Ikkalasi birga to'g'ri bo'lolmaydi va bu bejiz emas: tizim
--  "hali to'lanmagan" bilan "muddati o'tgan" ni bitta so'z bilan
--  atardi.
--
--  1-sentabrda hisoblanma quriladi, to'lov muddati esa 10-sentabr.
--  Ya'ni 1-dan 10-gacha hamma oila "qarzdor" bo'lib ko'rinardi —
--  hech kim hech narsani kechiktirmagan bo'lsa ham. 227 oilalik
--  maktabda bu har oy takrorlanadigan yolg'on ogohlantirish.
--
--  `v_student_balances` da ikkala tushuncha ALLAQACHON bor edi:
--    balance         — hisoblangan minus to'langan (muddatdan qat'i nazar)
--    overdue_charged — muddati o'tgan hisoblanmalar summasi
--
--  Faqat hisobot ikkinchisini ishlatmasdi. Shu tuzatiladi.
-- =====================================================================

drop function if exists public.report_by_class(date, date, uuid);

create function public.report_by_class(
  p_from      date,
  p_to        date,
  p_branch_id uuid default null
)
returns table (
  class_id        uuid,
  class_name      text,
  grade_level     smallint,
  branch_id       uuid,
  branch_name     text,
  teacher_name    text,
  students        integer,
  charged         numeric,
  collected       numeric,
  remaining       numeric,
  collection_rate numeric,
  --  Hisoblangan, lekin hali to'lanmagan — muddati kelmagani ham
  --  shu yerda. Bu OGOHLANTIRISH EMAS, oddiy holat.
  unpaid          numeric,
  --  Muddati o'tgani. Ogohlantirish aynan shu.
  overdue         numeric,
  --  Muddati o'tgan qarzi bor o'quvchilar soni.
  debtors         integer,
  avg_per_student numeric
)
language sql
stable
set search_path = ''
as $$
  select x.class_id, x.class_name, x.grade_level, x.branch_id,
         x.branch_name, x.teacher_name, x.students, x.charged,
         x.collected, x.remaining, x.collection_rate,
         x.unpaid, x.overdue, x.debtors, x.avg_per_student
    from (
      select
        c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
        count(distinct s.id)::integer as students,
        coalesce(inv.charged, 0)::numeric(14,2),
        coalesce(pay.collected, 0)::numeric(14,2),
        greatest(0, coalesce(inv.charged, 0) - coalesce(pay.collected, 0))::numeric(14,2),
        case when coalesce(inv.charged, 0) > 0
             then round(100.0 * coalesce(pay.collected, 0) / inv.charged, 1)
             else 0 end,
        coalesce(bal.unpaid, 0)::numeric(14,2),
        coalesce(bal.overdue, 0)::numeric(14,2),
        coalesce(bal.debtors, 0)::integer,
        case when count(distinct s.id) > 0
             then round(coalesce(inv.charged, 0) / count(distinct s.id), 2)
             else 0 end,
        c.is_active
      from public.classes c
      join public.branches b on b.id = c.branch_id
      left join public.teachers te on te.id = c.teacher_id
      left join public.students s on s.class_id = c.id and s.deleted_at is null
      left join lateral (
        select sum(t.total) as charged
          from public.v_invoice_totals t
          join public.students s2 on s2.id = t.student_id
         where s2.class_id = c.id
           and t.status <> 'cancelled'
           and t.period between date_trunc('month', p_from)::date and p_to
      ) inv on true
      left join lateral (
        select sum(p.amount) as collected
          from public.payments p
          join public.students s3 on s3.id = p.student_id
         where s3.class_id = c.id
           and p.status = 'confirmed'
           and p.paid_on between p_from and p_to
      ) pay on true
      left join lateral (
        select
          sum(v.balance) filter (where v.balance > 0) as unpaid,
          --  Muddati o'tgan qism balansdan oshib ketmasin: to'lov
          --  avval eng eski qarzni yopadi (TZ 4.8.3).
          sum(least(v.balance, v.overdue_charged))
            filter (where least(v.balance, v.overdue_charged) > 0) as overdue,
          count(*) filter (
            where least(v.balance, v.overdue_charged) > 0)::integer as debtors
          from public.v_student_balances v
          join public.students s4 on s4.id = v.student_id
         where s4.class_id = c.id
           and v.status <> 'expelled'
      ) bal on true
      where c.deleted_at is null
        and (p_branch_id is null or c.branch_id = p_branch_id)
      group by c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
               c.is_active, inv.charged, pay.collected,
               bal.unpaid, bal.overdue, bal.debtors
    ) x (class_id, class_name, grade_level, branch_id, branch_name,
         teacher_name, students, charged, collected, remaining,
         collection_rate, unpaid, overdue, debtors, avg_per_student,
         is_active)
   -- Yashiriladigan yagona holat: nofaol VA ichi bo'sh.
   where x.is_active or x.students > 0
   order by x.grade_level nulls last, x.class_name;
$$;

comment on function public.report_by_class(date, date, uuid) is
  'Sinf kesimida moliya. `unpaid` — hali to''lanmagan (muddati '
  'kelmagani ham), `overdue` — muddati o''tgan haqiqiy qarz. '
  'Ogohlantirish faqat ikkinchisiga qo''yiladi.';

grant execute on function public.report_by_class(date, date, uuid)
  to authenticated;
