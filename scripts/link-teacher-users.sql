-- =====================================================================
--  Hisob yaratilgan, lekin o'qituvchiga BOG'LANMAGAN yozuvlarni
--  telefon raqami bo'yicha bog'lash.
--
--  Sabab: Edge Function foydalanuvchini yaratgan, javob esa brauzerga
--  yetib bormagan (CORS), shuning uchun `teachers.user_id` yozilmay
--  qolgan. Natijada o'qituvchi tizimga kiradi-yu, "mening sinflarim"
--  va "mening oyligim" bo'sh chiqadi: ikkala so'rov ham shu
--  bog'lanishga tayanadi.
--
--  Faqat BIR QIYMATLI holat bog'lanadi: bitta maktab, bir xil
--  telefon, roli `teacher` va ikkala tomon ham hali bog'lanmagan.
-- =====================================================================

update public.teachers t
   set user_id = u.id
  from public.app_users u
 where u.school_id = t.school_id
   and u.role = 'teacher'
   and u.deleted_at is null
   and u.is_active
   and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
     = regexp_replace(coalesce(t.phone, ''), '\D', '', 'g')
   and regexp_replace(coalesce(t.phone, ''), '\D', '', 'g') <> ''
   and t.user_id is null
   and t.deleted_at is null
   and not exists (
     select 1 from public.teachers t2
      where t2.user_id = u.id and t2.deleted_at is null)
returning t.full_name, t.phone, u.full_name as hisob;
