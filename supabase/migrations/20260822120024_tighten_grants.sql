-- =====================================================================
--  24 — Ortiqcha huquqlarni olib tashlash
--
--  Xavfsizlik maslahatchisi `security definer` funksiyalarning
--  `authenticated` roliga ochiqligini belgilaydi. Ularning KO'PCHILIGI
--  ataylab ochiq: TZ 5.4.6 ga ko'ra moliyaviy amallar faqat shu
--  funksiyalar orqali bajariladi va har biri O'Z ICHIDA huquqni
--  tekshiradi (app.assert_may_write).
--
--  Lekin uchtasi maktab foydalanuvchisiga UMUMAN kerak emas:
--    · provision_school      — yangi maktab ulash (platforma amali)
--    · seed_school_defaults  — shablon sozlamalar (platforma amali)
--    · bot_text              — bot matnlari (faqat Edge Function)
--
--  Ular ichkarida ham himoyalangan, lekin "kerak bo'lmagan huquq
--  berilmaydi" tamoyiliga ko'ra ochiq qoldirilmaydi.
-- =====================================================================

revoke execute on function
  public.provision_school(text, text, text, int, text, text) from authenticated;
revoke execute on function
  public.seed_school_defaults(uuid) from authenticated;
revoke execute on function
  public.bot_text(text, text, uuid) from authenticated;

-- service_role (Edge Functions) uchun ochiq qoladi.
grant execute on function
  public.provision_school(text, text, text, int, text, text) to service_role;
grant execute on function public.seed_school_defaults(uuid) to service_role;
grant execute on function public.bot_text(text, text, uuid) to service_role;

comment on function public.provision_school(text, text, text, int, text, text) is
  'TZ 4.13.2 — yangi maktabni ulash. FAQAT platforma operatori uchun '
  '(Edge Function orqali, service_role bilan).';
