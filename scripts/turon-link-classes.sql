-- =====================================================================
--  TURON — o'quvchilarni sinfga BOG'LASH
--
--  Import `students.class_name` matnini yozgan, lekin `class_id` ni
--  qo'ymagan. Panelda sinf tanlanganda `class_id` yoziladi va
--  `trg_students_sync_class` undan nomni oladi — teskarisi emas.
--  Shuning uchun 227 o'quvchining hammasida bog'lanish bo'sh qoldi.
--
--  Buning oqibati ko'rinmas, lekin keng:
--    · "Sinflar bo'yicha" hisoboti hamma sinfda 0 ko'rsatadi
--      (u `s.class_id = c.id` bo'yicha yig'adi)
--    · sinf bo'yicha davomat va ota-onaga xabar ishlamaydi
--    · sinf rahbari ustamasi hisoblanmaydi
--
--  Bog'lash nomi bo'yicha: sinf nomlari shu filialda yagona.
-- =====================================================================

update public.students st
   set class_id = c.id
  from public.classes c
  join public.branches b on b.id = c.branch_id
  join public.schools  s on s.id = b.school_id
 where s.name = 'Turon Ilm Xazinasi'
   and c.deleted_at is null
   and c.branch_id = st.branch_id
   and c.name      = st.class_name
   and st.class_id is null
   and st.deleted_at is null
returning st.full_name, st.class_name;
