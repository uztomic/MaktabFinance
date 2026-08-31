-- =====================================================================
--  TURON — narxsiz qolgan o'quvchilarga shartnoma
--
--  Manba ro'yxatida 36 ta o'quvchining narxi ko'rsatilmagan edi:
--  25 tasi rasmiy ro'yxatdan (u yerda narx ustuni umuman yo'q),
--  11 tasi narxli ro'yxatdan (katakcha bo'sh qolgan).
--
--  Dublikat EMAS — tekshirildi (`turon-check-dups.mjs`).
--
--  Narx: SHU SINFDA eng ko'p uchraydigan summa. Teng bo'lsa —
--  kattarog'i, chunki kichigi odatda alohida berilgan chegirma
--  bo'ladi va uni yangi o'quvchiga tarqatish noto'g'ri.
--
--  Har bir shartnoma `note` bilan belgilanadi — direktor ko'rib
--  chiqib tasdiqlashi yoki tuzatishi kerak.
-- =====================================================================

with turon as (
  select st.id, st.class_name, b.school_id
    from public.students st
    join public.branches b on b.id = st.branch_id
    join public.schools  s on s.id = b.school_id
   where s.name = 'Turon Ilm Xazinasi'
     and st.deleted_at is null
     and st.status = 'active'
),
-- Sinfdagi narxlar chastotasi.
tally as (
  select t.class_name, c.tuition_amount, count(*) as n
    from turon t
    join public.contracts c on c.student_id = t.id and c.is_active
   group by 1, 2
),
modal as (
  select class_name, tuition_amount
    from (
      select class_name, tuition_amount,
             row_number() over (
               partition by class_name
               order by n desc, tuition_amount desc) as rn
        from tally
    ) q
   where rn = 1
),
-- Shartnomasi yo'qlar.
missing as (
  select t.id, t.class_name, t.school_id, m.tuition_amount
    from turon t
    join modal m on m.class_name = t.class_name
   where not exists (
     select 1 from public.contracts c
      where c.student_id = t.id and c.is_active)
),
numbered as (
  select m.*,
         'SH-2026-' || lpad((192 + row_number() over (
           order by m.class_name, m.id))::text, 4, '0') as number
    from missing m
)
insert into public.contracts
  (school_id, student_id, number, signed_on, starts_on,
   tuition_amount, due_day, billing_months, is_active, note)
select school_id, id, number, current_date, date '2026-09-01',
       tuition_amount, 10, 12, true,
       'Narx manba ro''yxatida ko''rsatilmagan — sinfdagi eng ko''p '
       'uchraydigan summa qo''yildi. TEKSHIRISH KERAK.'
  from numbered
returning number,
          (select class_name from public.students where id = student_id) as sinf,
          (select full_name  from public.students where id = student_id) as oquvchi,
          tuition_amount::bigint as narx;
