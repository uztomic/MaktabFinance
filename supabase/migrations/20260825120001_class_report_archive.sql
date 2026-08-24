-- =====================================================================
--  35 — SINF HISOBOTIDAN BO'SH ARXIV SINFLARINI OLIB TASHLASH
--
--  MUAMMO real ma'lumotda ko'rindi. Ikki o'quv yili bo'lgan maktabda
--  har bir sinf nomi IKKI MARTA mavjud: 2024/2025 (arxiv) va
--  2025/2026 (joriy). O'quvchilar faqat joriysida.
--
--  Natijada "Sinflar" sahifasi va sinf kesimidagi hisobot 32 qator
--  chiqarardi, ularning yarmi butunlay bo'sh: "1-A — 0 o'quvchi,
--  0 so'm". Foydalanuvchi ikkita bir xil nomli qatorni ko'rib,
--  qaysi biri haqiqiy ekanini tushunmaydi.
--
--  YECHIM: nofaol VA bo'sh sinf chiqarilmaydi. Ikkala shart ham
--  kerak:
--    · faqat `is_active` bo'yicha filtrlash — arxivdagi, lekin hali
--      o'quvchisi bor sinfni yashirib qo'yardi (yillik ko'chirish
--      yarim qolgan holat);
--    · faqat "o'quvchisi bor" bo'yicha filtrlash — yangi ochilgan,
--      hali to'ldirilmagan sinfni yashirardi.
--
--  Ya'ni yashiriladigan yagona holat: nofaol va ichi bo'sh.
-- =====================================================================

create or replace function public.report_by_class(
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
  debt            numeric,
  avg_per_student numeric
)
language sql
stable
as $$
  select x.class_id, x.class_name, x.grade_level, x.branch_id,
         x.branch_name, x.teacher_name, x.students, x.charged,
         x.collected, x.remaining, x.collection_rate, x.debt,
         x.avg_per_student
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
        coalesce(bal.debt, 0)::numeric(14,2),
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
        select sum(v.balance) filter (where v.balance > 0) as debt
          from public.v_student_balances v
          join public.students s4 on s4.id = v.student_id
         where s4.class_id = c.id
      ) bal on true
      where c.deleted_at is null
        and (p_branch_id is null or c.branch_id = p_branch_id)
      group by c.id, c.name, c.grade_level, c.branch_id, b.name, te.full_name,
               c.is_active, inv.charged, pay.collected, bal.debt
    ) x (class_id, class_name, grade_level, branch_id, branch_name,
         teacher_name, students, charged, collected, remaining,
         collection_rate, debt, avg_per_student, is_active)
   -- Yashiriladigan yagona holat: nofaol VA ichi bo'sh.
   where x.is_active or x.students > 0
   order by x.grade_level nulls last, x.class_name;
$$;

comment on function public.report_by_class(date, date, uuid) is
  'Sinf kesimi: hisoblangan, yig''ilgan, YANA QANCHA KERAK, yig''ish '
  'foizi va bugungi qarzdorlik. Nofaol va bo''sh sinflar chiqmaydi.';

revoke all on function public.report_by_class(date, date, uuid) from public, anon;
grant execute on function public.report_by_class(date, date, uuid)
  to authenticated, service_role;
