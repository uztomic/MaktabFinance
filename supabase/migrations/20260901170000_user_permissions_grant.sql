-- =====================================================================
--  SHAXSIY HUQUQLAR O'QILMAYOTGAN EDI
--
--  Qabul menejeriga "to'lov qabul qilish" ruxsati berildi, bazada
--  saqlandi, huquqlar ro'yxatida "qo'shilgan" deb ko'rindi — lekin
--  panelda tugma paydo bo'lmadi.
--
--  Sabab: `user_permissions` jadvaliga `authenticated` roli uchun
--  GRANT berilmagan edi. RLS siyosati bor edi, lekin siyosat GRANT
--  o'rnini bosmaydi: jadval darajasida ruxsat bo'lmasa, so'rov
--  umuman o'tmaydi.
--
--  Nega ro'yxatda TO'G'RI ko'ringan: muharrir `user_permission_matrix`
--  funksiyasi orqali o'qiydi, u esa `security definer` — ya'ni
--  egasining huquqi bilan ishlaydi va GRANT ga muhtoj emas.
--  Saqlash ham RPC orqali. Faqat ILOVANING o'zi jadvalni
--  to'g'ridan-to'g'ri o'qishga urinardi va shu yerda to'silardi.
--
--  Bu bugungi uchinchi shunday holat (`calendar_days` — DELETE
--  siyosati yo'q, `user_branches` — DELETE granti yo'q). Uchalasi
--  ham JIMGINA ishlamasdi.
-- =====================================================================

grant select on public.user_permissions to authenticated;

--  Yozish faqat `set_user_permission` orqali: u o'zini o'zi
--  huquqsiz qoldirishdan ham himoya qiladi.
