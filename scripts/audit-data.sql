-- =====================================================================
--  audit-data.sql — MA'LUMOT YAXLITLIGI.
--
--  Xavfsizlik va kod auditlari "kim nima qila oladi" va "kod toza
--  ko'rinadimi" degan savolga javob beradi. Bu esa boshqa savol:
--  RAQAMLAR BIR-BIRIGA MOS KELADIMI.
--
--  Moliyaviy tizimda eng xavfli xato — jimgina noto'g'ri raqam.
--  U hech qanday xato xabari bermaydi, log'da ko'rinmaydi va faqat
--  bir necha oydan keyin, buxgalter hisobot topshirayotganda
--  chiqadi.
--
--  Bo'sh natija = mos.
--
--    node scripts/db.mjs file scripts/audit-data.sql
-- =====================================================================

with

-- 1. Hisoblanma jami QATORLAR yig'indisiga teng bo'lishi shart -------
inv_mismatch as (
  select 1 as ord, 'HISOBLANMA JAMI MOS EMAS' as muammo,
         i.id::text as obyekt,
         'ko''rinishdagi jami ' || t.total ||
         ', qatorlar yig''indisi ' || coalesce(l.s, 0) as tafsilot
    from public.invoices i
    join public.v_invoice_totals t on t.invoice_id = i.id
    left join lateral (
      select sum(amount) as s from public.invoice_lines
       where invoice_id = i.id
    ) l on true
   where t.total <> coalesce(l.s, 0)
),

-- 2. Manfiy hisoblanma — chegirma to'lovdan oshib ketgan ------------
negative_invoice as (
  select 2, 'MANFIY HISOBLANMA', i.id::text,
         'jami ' || t.total || ' — chegirma o''qish to''lovidan katta'
    from public.invoices i
    join public.v_invoice_totals t on t.invoice_id = i.id
   where t.total < 0
),

-- 3. Kvitansiyasiz kassa to'lovi (TZ 4.7.1.2) -----------------------
--    Har bir kassa to'loviga raqamlangan kvitansiya berilishi shart.
missing_receipt as (
  select 3, 'KASSA TO''LOVIDA KVITANSIYA YO''Q', p.id::text,
         to_char(p.paid_on, 'DD.MM.YYYY') || ' — ' || p.amount::text
    from public.payments p
   where p.channel = 'cash' and p.status = 'confirmed'
     and not exists (select 1 from public.cash_receipts r
                      where r.payment_id = p.id)
),

-- 4. Yetim kvitansiya — to'lovi yo'q ---------------------------------
orphan_receipt as (
  select 4, 'YETIM KVITANSIYA', r.receipt_code,
         'bog''liq to''lov topilmadi'
    from public.cash_receipts r
   where not exists (select 1 from public.payments p where p.id = r.payment_id)
),

-- 5. Kvitansiya raqami takrorlangan (TZ 4.7.1.5) --------------------
dup_receipt as (
  select 5, 'KVITANSIYA RAQAMI TAKRORLANGAN', receipt_code,
         count(*)::text || ' marta'
    from public.cash_receipts
   group by school_id, branch_id, receipt_code
  having count(*) > 1
),

-- 6. To'lov kodi takrorlangan ---------------------------------------
dup_code as (
  select 6, 'TO''LOV KODI TAKRORLANGAN', payment_code,
         count(*)::text || ' o''quvchida'
    from public.students where deleted_at is null
   group by school_id, payment_code
  having count(*) > 1
),

-- 7. Bir davrga ikkita faol hisoblanma -------------------------------
dup_invoice as (
  select 7, 'BIR DAVRGA IKKI HISOBLANMA',
         s.full_name || ' — ' || to_char(i.period, 'YYYY-MM'),
         count(*)::text || ' ta'
    from public.invoices i
    join public.students s on s.id = i.student_id
   where i.status <> 'cancelled'
   group by s.full_name, i.period, i.student_id
  having count(*) > 1
),

-- 8. Ikkita faol shartnoma -------------------------------------------
dup_contract as (
  select 8, 'IKKITA FAOL SHARTNOMA', s.full_name,
         count(*)::text || ' ta'
    from public.contracts c
    join public.students s on s.id = c.student_id
   where c.is_active
   group by s.full_name, c.student_id
  having count(*) > 1
),

-- 9. Sinf nomi bog'lanish bilan mos emas (trigger buzilgan) ---------
class_desync as (
  select 9, 'SINF NOMI MOS EMAS', s.full_name,
         'o''quvchida "' || coalesce(s.class_name, '—') ||
         '", sinfda "' || c.name || '"'
    from public.students s
    join public.classes c on c.id = s.class_id
   where s.deleted_at is null
     and s.class_name is distinct from c.name
),

-- 10. Chiqib ketgan o'quvchiga chiqish sanasidan KEYIN hisoblanma ----
after_leave as (
  select 10, 'CHIQQANDAN KEYIN HISOBLANMA',
         s.full_name || ' — ' || to_char(i.period, 'YYYY-MM'),
         'chiqqan ' || to_char(s.left_on, 'DD.MM.YYYY')
    from public.invoices i
    join public.students s on s.id = i.student_id
   where s.left_on is not null
     and i.period > date_trunc('month', s.left_on)::date
     and i.status <> 'cancelled'
),

-- 11. To'lov sanasi qabul sanasidan oldin ---------------------------
early_payment as (
  select 11, 'TO''LOV QABULDAN OLDIN', s.full_name,
         'to''lov ' || to_char(p.paid_on, 'DD.MM.YYYY') ||
         ', qabul ' || to_char(s.enrolled_on, 'DD.MM.YYYY')
    from public.payments p
    join public.students s on s.id = p.student_id
   where p.paid_on < s.enrolled_on and p.status = 'confirmed'
),

-- 12. Tasdiqlangan chek to'lovsiz qolgan -----------------------------
proof_no_payment as (
  select 12, 'TASDIQLANGAN CHEKDA TO''LOV YO''Q', pr.id::text,
         to_char(pr.submitted_at, 'DD.MM.YYYY')
    from public.payment_proofs pr
   where pr.status = 'confirmed' and pr.payment_id is null
),

-- 13. Oylik xarajati hisobga tushmagan (TZ 4.11.9) ------------------
payroll_no_expense as (
  select 13, 'OYLIK XARAJATI YO''Q',
         to_char(r.period, 'YYYY-MM') || ' — ' || t.full_name,
         'tasdiqlangan, lekin xarajat yozuvi yo''q'
    from public.payroll_runs r
    join public.teachers t on t.id = r.teacher_id
   where r.status = 'approved'
     and not exists (select 1 from public.expenses e
                      where e.payroll_run_id = r.id and e.deleted_at is null)
),

-- 14. Yopilgan davrga yozilgan yozuv ---------------------------------
--     Trigger buni to'sishi kerak. Bo'lsa — trigger ishlamagan.
locked_write as (
  select 14, 'YOPILGAN DAVRGA YOZUV', p.id::text,
         to_char(p.paid_on, 'DD.MM.YYYY') || ' — ' ||
         to_char(cp.period, 'YYYY-MM') || ' yopilgan'
    from public.payments p
    join public.closed_periods cp
      on cp.school_id = p.school_id
     and cp.period = date_trunc('month', p.paid_on)::date
     and (cp.branch_id is null or cp.branch_id = p.branch_id)
   where p.created_at > cp.closed_at
),

-- 15. Filialsiz yozuv (TZ 5.4.2 — branch_id NOT NULL) ---------------
no_branch as (
  select 15, 'FILIALSIZ O''QUVCHI', s.full_name, 'branch_id bo''sh'
    from public.students s
   where s.branch_id is null and s.deleted_at is null
)

select muammo, obyekt, tafsilot from (
  select * from inv_mismatch
  union all select * from negative_invoice
  union all select * from missing_receipt
  union all select * from orphan_receipt
  union all select * from dup_receipt
  union all select * from dup_code
  union all select * from dup_invoice
  union all select * from dup_contract
  union all select * from class_desync
  union all select * from after_leave
  union all select * from early_payment
  union all select * from proof_no_payment
  union all select * from payroll_no_expense
  union all select * from locked_write
  union all select * from no_branch
) t
order by ord, obyekt
limit 60;
