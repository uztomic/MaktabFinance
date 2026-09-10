-- =====================================================================
--  TASMADA TANILMAGAN JADVALLAR
--
--  `today_activity` tanimagan jadvalni `other` qilib chiqaradi —
--  ya'ni yo'qolmaydi, lekin ekranda jadvalning xom nomi turadi.
--  Auditda shunday to'qqizta jadval bor edi: xarajat turlari,
--  chegirma turlari, to'lov usullari, filiallar, xizmatlar va
--  narxlari, xodim ustamalari va avanslari, obuna.
--
--  Ular ham amal. To'lov usuli o'chirilsa yoki xizmat narxi
--  o'zgartirilsa, ertaga hisob boshqacha chiqadi — buni kim va
--  qachon qilganini ko'rish kerak.
--
--  Funksiya jonli ta'rifidan olinib qayta yozildi, shunda oldingi
--  migratsiyadagi tuzatishlar joyida qoladi.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.today_activity(p_branch_id uuid DEFAULT NULL::uuid, p_day date DEFAULT NULL::date, p_limit integer DEFAULT 80)
 RETURNS TABLE(happened_at timestamp with time zone, kind text, act text, obj text, subject text, amount numeric, n integer, actor text, support boolean, href text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with me as (
  select app.school_id() as school
),
zone as (
  select coalesce(s.timezone, 'Asia/Tashkent') as z
    from public.schools s, me
   where s.id = me.school
),
win as (
  select
    (coalesce(p_day, (now() at time zone (select z from zone))::date)::timestamp
      at time zone (select z from zone)) as t0,
    ((coalesce(p_day, (now() at time zone (select z from zone))::date) + 1)::timestamp
      at time zone (select z from zone)) as t1
),
raw as (
  select a.at, a.table_name, a.action, a.record_id,
         a.user_id, a.impersonated_by,
         a.before, a.after,
         coalesce(a.after, a.before) as doc
    from public.audit_log a, me, win
   where a.school_id = me.school
     and a.at >= win.t0
     and a.at <  win.t1
     --  Ko'rish huquqi yo'q bo'lsa — bo'sh ro'yxat.
     and (select app.can('reports.view'))
     and a.table_name not in ('cash_receipts', 'payroll_lines')
     --  Hisoblanma qatorlaridan faqat qo'lda berilgan chegirma.
     --  Qolgani `invoices` satri bilan birga ko'rinadi.
     and (a.table_name <> 'invoice_lines'
          or coalesce(
               (coalesce(a.after, a.before) -> 'source' ->> 'manual')::boolean,
               false))
),
bucketed as (
  select r.*,
         count(*) over (
           partition by r.user_id, r.table_name, r.action,
                        date_trunc('minute', r.at)) as bn,
         row_number() over (
           partition by r.user_id, r.table_name, r.action,
                        date_trunc('minute', r.at)
           order by r.at desc) as rn,
         --  Yig'ilgan satrda summa ham yig'iladi: "3 ta to'lov —
         --  4 200 000". Bitta qatornikini ko'rsatish yolg'on bo'lardi.
         sum(abs(nullif(r.doc ->> 'amount', '')::numeric)) over (
           partition by r.user_id, r.table_name, r.action,
                        date_trunc('minute', r.at)) as bsum
    from raw r
),
kept as (
  select b.*,
         case when b.bn >= 3 then b.bn::int else 1 end as cnt
    from bucketed b
   where b.bn < 3 or b.rn = 1
),
named as (
  select k.*,
         nullif(k.doc ->> 'branch_id', '')::uuid as branch,
         --  Yozuvning O'Z nomi birinchi o'rinda.
         --
         --  Ilgari bog'lanish oldin tekshirilardi va sinf tahrirlansa
         --  ro'yxatda sinf rahbarining ismi chiqardi — go'yo o'sha
         --  odam o'zgartirilgandek. Yozuvda nom bo'lsa, u har doim
         --  to'g'riroq.
         case
           when nullif(k.doc ->> 'full_name', '')  is not null
             then k.doc ->> 'full_name'
           when nullif(k.doc ->> 'name', '')       is not null
             then k.doc ->> 'name'
           when nullif(k.doc ->> 'class_name', '') is not null
             then k.doc ->> 'class_name'
           when nullif(k.doc ->> 'student_id', '') is not null
             then (select s.full_name from public.students s
                    where s.id = (k.doc ->> 'student_id')::uuid)
           when nullif(k.doc ->> 'teacher_id', '') is not null
             then (select tc.full_name from public.teachers tc
                    where tc.id = (k.doc ->> 'teacher_id')::uuid)
           when nullif(k.doc ->> 'class_id', '') is not null
             then (select c.name from public.classes c
                    where c.id = (k.doc ->> 'class_id')::uuid)
           else coalesce(k.doc ->> 'title',
                         k.doc ->> 'key',
                         k.doc ->> 'note',
                         k.doc ->> 'code')
         end as subject_name,
         (select u.full_name from public.app_users u where u.id = k.user_id)
           as actor_name
    from kept k
),
shaped as (
  select
    n.at,
    case
      when n.table_name = 'students' and n.action = 'INSERT' then 'student.add'
      when n.table_name = 'students' and n.action = 'DELETE' then 'student.delete'
      when n.table_name = 'students'
           and (n.before ->> 'deleted_at') is null
           and (n.after  ->> 'deleted_at') is not null then 'student.delete'
      when n.table_name = 'students'
           and coalesce(n.before ->> 'status', '')
            <> coalesce(n.after  ->> 'status', '') then 'student.status'
      when n.table_name = 'students' then 'student.edit'

      when n.table_name = 'payments' and n.action = 'INSERT' then 'payment.add'
      when n.table_name = 'payments'
           and coalesce(n.after ->> 'status', '') = 'cancelled'
             then 'payment.cancel'
      when n.table_name = 'payments' then 'payment.edit'

      when n.table_name = 'invoice_lines' then 'discount.add'

      when n.table_name = 'invoices' and n.action = 'INSERT' then 'invoice.add'
      when n.table_name = 'invoices'
           and coalesce(n.after ->> 'status', '') = 'approved'
             then 'invoice.approve'
      when n.table_name = 'invoices'
           and coalesce(n.after ->> 'status', '') = 'cancelled'
             then 'invoice.cancel'
      when n.table_name = 'invoices' then 'invoice.edit'

      when n.table_name = 'contracts' and n.action = 'INSERT' then 'contract.add'
      when n.table_name = 'contracts' then 'contract.edit'

      when n.table_name = 'absences' and n.action = 'INSERT' then 'absence.add'
      when n.table_name = 'absences' and n.action = 'DELETE' then 'absence.remove'
      when n.table_name = 'absences' then 'absence.edit'
      when n.table_name = 'attendance_checks' then 'attendance.check'

      when n.table_name = 'lessons' and n.action = 'INSERT' then 'lesson.add'
      when n.table_name = 'lessons'
           and (n.after ->> 'deleted_at') is not null then 'lesson.delete'
      when n.table_name = 'lessons' then 'lesson.edit'

      when n.table_name = 'payroll_runs' and n.action = 'INSERT' then 'payroll.calc'
      when n.table_name = 'payroll_runs'
           and coalesce(n.after ->> 'status', '') = 'approved'
             then 'payroll.approve'
      when n.table_name = 'payroll_runs'
           and coalesce(n.after ->> 'status', '') = 'cancelled'
             then 'payroll.cancel'
      when n.table_name = 'payroll_runs' then 'payroll.edit'

      when n.table_name = 'expenses' and n.action = 'INSERT' then 'expense.add'
      when n.table_name = 'expenses' then 'expense.edit'

      when n.table_name = 'teachers' and n.action = 'INSERT' then 'teacher.add'
      when n.table_name = 'teachers'
           and (n.before ->> 'left_on') is null
           and (n.after  ->> 'left_on') is not null then 'teacher.dismiss'
      when n.table_name = 'teachers'
           and (n.after ->> 'deleted_at') is not null then 'teacher.delete'
      when n.table_name = 'teachers' then 'teacher.edit'

      when n.table_name = 'classes' and n.action = 'INSERT' then 'class.add'
      when n.table_name = 'classes'
           and (n.after ->> 'deleted_at') is not null then 'class.delete'
      when n.table_name = 'classes' then 'class.edit'

      when n.table_name = 'app_users' and n.action = 'INSERT' then 'user.add'
      when n.table_name = 'app_users' then 'user.edit'

      when n.table_name in ('parents', 'student_parents')
           and n.action = 'INSERT' then 'parent.add'
      when n.table_name in ('parents', 'student_parents') then 'parent.edit'

      when n.table_name = 'student_services'
           and n.action = 'INSERT' then 'service.assign'
      when n.table_name = 'student_services' then 'service.edit'

      when n.table_name = 'payment_proofs'
           and n.action = 'INSERT' then 'proof.add'
      when n.table_name = 'payment_proofs' then 'proof.review'

      when n.table_name in ('school_settings', 'payroll_settings')
             then 'settings.change'
      when n.table_name = 'calendar_days' then 'calendar.change'
      when n.table_name = 'closed_periods' then 'period.close'
      when n.table_name = 'leads' and n.action = 'INSERT' then 'lead.add'
      when n.table_name = 'leads' then 'lead.edit'


      --  Ma'lumotnomalar va sozlash yozuvlari. Ular ham amal:
      --  to'lov usuli o'chirilsa yoki xizmat narxi o'zgarsa,
      --  ertaga hisob boshqacha chiqadi.
      when n.table_name = 'services'
           and n.action = 'INSERT' then 'service.add'
      when n.table_name = 'services' then 'service.edit'
      when n.table_name = 'service_prices' then 'price.change'
      when n.table_name = 'payment_methods' then 'paymethod.change'
      when n.table_name = 'expense_categories' then 'expcat.change'
      when n.table_name = 'discount_types' then 'disctype.change'
      when n.table_name = 'absence_reasons' then 'reason.change'

      when n.table_name = 'teacher_allowances' then 'allowance.change'
      when n.table_name = 'teacher_advances' then 'advance.change'

      when n.table_name = 'branches'
           and n.action = 'INSERT' then 'branch.add'
      when n.table_name = 'branches' then 'branch.edit'
      when n.table_name in ('user_branches', 'teacher_branches')
             then 'branchlink.change'
      when n.table_name = 'user_permissions' then 'permission.change'
      when n.table_name = 'school_subscriptions' then 'subscription.change'
      else 'other'
    end as kind,
    n.action as act,
    n.table_name as obj,
    --  Yig'ilgan satrda ISM CHIQMAYDI. Aks holda "36 ta" yonida
    --  bitta odamning ismi turardi va go'yo hammasi o'shanga
    --  tegishlidek ko'rinardi.
    case when n.cnt > 1 then null else n.subject_name end as subject,
    --  Chegirma qatori manfiy yoziladi — ro'yxatda musbat ko'rinadi.
    case when n.cnt > 1 then n.bsum
         else abs(nullif(n.doc ->> 'amount', '')::numeric) end as amount,
    n.cnt as n,
    n.actor_name as actor,
    (n.impersonated_by is not null) as support,
    case
      when n.cnt > 1 then
        case n.table_name
          when 'invoices'     then '/hisoblanma'
          when 'payments'     then '/tolovlar'
          when 'absences'     then '/yoqlik'
          when 'lessons'      then '/oqituvchilar'
          when 'payroll_runs' then '/oylik'
          when 'students'     then '/oquvchilar'
          else '/jurnal'
        end
      when n.table_name = 'students'     then '/oquvchilar/' || n.record_id
      when n.table_name = 'teachers'     then '/oqituvchilar/' || n.record_id
      when n.table_name = 'classes'      then '/sinflar/' || n.record_id
      when n.table_name = 'payroll_runs' then '/oylik/' || n.record_id
      when nullif(n.doc ->> 'student_id', '') is not null
        then '/oquvchilar/' || (n.doc ->> 'student_id')
      when nullif(n.doc ->> 'teacher_id', '') is not null
        then '/oqituvchilar/' || (n.doc ->> 'teacher_id')
      when n.table_name = 'expenses'          then '/xarajatlar'
      when n.table_name = 'app_users'         then '/foydalanuvchilar'
      when n.table_name = 'leads'             then '/murojaatlar'
      when n.table_name = 'attendance_checks' then '/yoqlik'
      when n.table_name in ('school_settings', 'payroll_settings',
                            'calendar_days')  then '/sozlamalar'
      else '/jurnal'
    end as href
  from named n
  --  Filial tanlangan bo'lsa — o'shaniki va maktab bo'yicha umumiy
  --  yozuvlar (sozlama, xodim, foydalanuvchi) ko'rinadi.
  where p_branch_id is null
     or n.branch is null
     or n.branch = p_branch_id
)
select s.at, s.kind, s.act, s.obj, s.subject, s.amount, s.n,
       s.actor, s.support, s.href
  from shaped s
 order by s.at desc
 limit greatest(1, least(coalesce(p_limit, 80), 300));
$function$
;

revoke all on function public.today_activity(uuid, date, int) from public, anon;
grant execute on function public.today_activity(uuid, date, int) to authenticated;
