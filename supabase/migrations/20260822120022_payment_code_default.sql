-- =====================================================================
--  22 — students.payment_code uchun standart qiymat
--
--  MUAMMO: ustun NOT NULL, lekin qiymatni TRIGGER beradi
--  (app.assign_payment_code — TZ 4.3.1). Generatsiya qilingan
--  TypeScript turlari triggerni bilmaydi va `payment_code` ni
--  MAJBURIY maydon deb ko'rsatadi. Natijada mijoz kodi o'quvchi
--  qo'sha olmaydi.
--
--  YECHIM: bo'sh standart qiymat. Trigger uni har holda o'z kodiga
--  almashtiradi (u faqat bo'sh yoki null bo'lganda ishlaydi).
-- =====================================================================

alter table public.students alter column payment_code set default '';

comment on column public.students.payment_code is
  'TZ 4.3.1 — noyob to''lov kodi (MK-1042). Qiymatni trigger beradi; '
  'standart bo''sh qiymat faqat turlar generatsiyasi uchun.';
