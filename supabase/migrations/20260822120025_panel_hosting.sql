-- =====================================================================
--  25 — PANELNI SUPABASE DA JOYLASHTIRISH
--
--  Supabase da alohida "statik hosting" mahsuloti yo'q, lekin uni
--  Storage + Edge Function bilan qilsa bo'ladi:
--
--    · yig'ilgan ilova `panel` bucket'iga yuklanadi
--    · `panel` Edge Function fayllarni o'sha bucket'dan beradi
--    · topilmagan yo'l uchun index.html qaytariladi (SPA fallback)
--
--  Shu tufayli Vercel yoki Netlify kerak emas — bitta Supabase
--  loyihasi bazani ham, botni ham, panelni ham olib boradi.
--
--  Bucket YOPIQ: fayllarni faqat Edge Function (service_role bilan)
--  o'qiydi. Bu bucket ro'yxatini tashqaridan ko'rishni yopadi.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('panel', 'panel', false, 26214400)   -- 25 MB
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

-- Mijozga bu bucket UMUMAN ochilmaydi — siyosat yaratilmaydi.
-- Faqat service_role o'qiy oladi (u RLS dan o'tmaydi).
