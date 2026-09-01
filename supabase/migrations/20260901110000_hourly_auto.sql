-- =====================================================================
--  AVTOMATIK HISOB — SUTKADA BIR MARTA EMAS, HAR SOATDA
--
--  Bugun shu ko'rindi: cron 06:00 da ishlagan, o'quvchilar esa 11:45
--  da kiritilgan. Natijada maktabda 190 ta shartnoma bor edi-yu,
--  bironta hisoblanma yo'q edi — va ertagacha shunday turardi.
--
--  Foydalanuvchi uchun bu "dastur hisoblamayapti" degani. Texnik
--  jihatdan esa hammasi to'g'ri ishlayotgan edi, shunchaki navbat
--  ertagaga qolgan edi.
--
--  Har soatda yugurish XAVFSIZ, chunki ikkala vazifa ham faqat
--  YO'Q narsani yaratadi:
--    · hisoblanma — davrda bitta ham hisoblanma bo'lmagan filialga
--    · oylik — hisobi bo'lmagan o'qituvchiga
--
--  Ya'ni bir marta yaratilgandan keyin ular hech narsa qilmaydi:
--  ortiqcha yuk yo'q, qo'lda kiritilgan tuzatish ham o'chmaydi.
-- =====================================================================

do $do$
declare
  jobs text[][] := array[
    --  Soatning 5-daqiqasi: cron gurros bo'lib boshlanmasin.
    ['maktab_monthly_invoices', '5 * * * *',
     'select public.run_monthly_invoices();'],
    --  Oylik hisoblanmadan KEYIN: u dars soatlariga ham tayanadi.
    ['maktab_monthly_payroll',  '20 * * * *',
     'select public.run_monthly_payroll();']
  ];
  i int;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron yo''q — vazifalar rejalashtirilmadi.';
    return;
  end if;

  for i in 1 .. array_length(jobs, 1) loop
    begin
      if exists (select 1 from cron.job where jobname = jobs[i][1]) then
        perform cron.unschedule(jobs[i][1]);
      end if;
      perform cron.schedule(jobs[i][1], jobs[i][2], jobs[i][3]);
      raise notice 'Cron: % → %', jobs[i][1], jobs[i][2];
    exception when others then
      raise notice 'Cron % rejalashtirilmadi: %', jobs[i][1], sqlerrm;
    end;
  end loop;
end $do$;
