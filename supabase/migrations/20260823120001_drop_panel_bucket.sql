-- =====================================================================
--  26 — `panel` bucket'ini olib tashlash
--
--  NEGA: 25-migratsiyada panelni Supabase Storage + Edge Function
--  orqali joylashtirish sinab ko'rildi. Ishlamadi.
--
--  SABAB: Supabase o'z domenida HTML sahifa ko'rsatishga ATAYLAB
--  yo'l bermaydi. Storage ham, Edge Function ham javobga majburan
--  quyidagilarni qo'yadi:
--
--      Content-Type: text/plain
--      Content-Security-Policy: default-src 'none'; sandbox
--
--  Ya'ni brauzer HTML ni sahifa sifatida ko'rsatmaydi va hech qanday
--  skript ishlamaydi. Bu fishing va XSS ni oldini olish uchun qilingan
--  himoya — uni sarlavha bilan chetlab o'tib bo'lmaydi.
--
--  YECHIM: panel Vercel yoki Netlify'ga joylashtiriladi (TZ 5.2 da
--  aynan shular ko'rsatilgan). Baza, bot va fayllar Supabase'da qoladi.
-- =====================================================================

-- Bucket'ni SQL bilan o'chirib bo'lmaydi (storage.protect_delete triggeri),
-- shuning uchun u Storage API orqali o'chirildi. Bu migratsiya faqat
-- QARORNI hujjatlashtiradi — bazada o'zgarish yo'q.

do $do$
begin
  if exists (select 1 from storage.buckets where id = 'panel') then
    raise notice 'DIQQAT: panel bucket hali mavjud. Storage API orqali o''chiring.';
  else
    raise notice 'panel bucket o''chirilgan — to''g''ri.';
  end if;
end $do$;
