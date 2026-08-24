-- =====================================================================
--  20 — TUZATISH: telegram_id maktab ichida unikal bo'lishi kerak
--
--  MUAMMO: 04-migratsiyada `parents_telegram_idx` GLOBAL unikal
--  indeks edi. Lekin bitta Telegram bot BARCHA maktablarga xizmat
--  qiladi (TZ 5.1 — bitta bot, ko'p ijarachi).
--
--  Agar ota-onaning farzandlari ikki xil maktabda o'qisa, ikkinchi
--  maktabda uni botga ulab bo'lmasdi — global unikal indeks
--  to'sqinlik qilardi.
--
--  YECHIM: unikal indeks (school_id, telegram_id) bo'yicha.
--  Bot esa telegram_id bo'yicha BIR NECHTA ota-ona yozuvini topadi
--  va ularning barcha farzandlarini ko'rsatadi (TZ 4.9.2).
-- =====================================================================

drop index if exists public.parents_telegram_idx;

create unique index if not exists parents_telegram_idx
  on public.parents(school_id, telegram_id)
  where telegram_id is not null and deleted_at is null;

-- Bot har bir so'rovda shu indeks bo'yicha qidiradi.
create index if not exists parents_telegram_lookup_idx
  on public.parents(telegram_id)
  where telegram_id is not null and deleted_at is null;

comment on index public.parents_telegram_idx is
  'Bir maktabda bitta Telegram hisob bitta ota-onaga tegishli. '
  'Turli maktablarda esa bir hisob turli yozuvlarga bog''lanishi mumkin.';
