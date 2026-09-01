-- =====================================================================
--  KALENDAR KUNINI O'CHIRISH ISHLAMAYOTGAN EDI
--
--  Panelda "o'chirish" tugmasi bor edi, bosilganda esa hech narsa
--  bo'lmasdi — xato ham chiqmasdi.
--
--  Sabab: `calendar_days` da DELETE siyosati umuman yo'q edi. RLS
--  yoqilgan jadvalda siyosat bo'lmasa amal JIMGINA rad etiladi:
--  PostgREST muvaffaqiyat qaytaradi, o'chirilgan qator soni esa nol.
--  Ilovaga bu "hammasi joyida" bo'lib ko'rinadi.
--
--  Bu loyihada DELETE siyosati boshqa hech qayerda yo'q va bu
--  ATAYLAB: moliyaviy yozuv o'chirilmaydi, `deleted_at` qo'yiladi.
--  Kalendar esa boshqa — undagi kun moliyaviy yozuv emas, oddiy
--  sozlama: "shu kun bayram". Noto'g'ri kiritilgan bayramni
--  arxivlashning ma'nosi yo'q, u shunchaki olib tashlanadi.
--
--  Huquq qo'shish va tahrirlash bilan BIR XIL: `services.manage`.
-- =====================================================================

drop policy if exists calendar_days_delete on public.calendar_days;

create policy calendar_days_delete on public.calendar_days
  for delete using (
    (school_id = (select app.school_id())
     and (select app.may_write('services.manage')))
    or (select app.is_platform_admin())
  );
