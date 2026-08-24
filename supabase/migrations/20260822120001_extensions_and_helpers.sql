-- =====================================================================
--  01 — KENGAYTMALAR, `app` SXEMASI VA UMUMIY TURLAR
--
--  Bu migratsiya butun tizimning poydevori. Uchta narsani beradi:
--    1. Kerakli PostgreSQL kengaytmalari (cron, net, citext)
--    2. `app` sxemasi — ichki yordamchi funksiyalar uchun. U PostgREST
--       orqali TASHQARIGA CHIQARILMAYDI (config.toml: schemas = ["public"]),
--       shuning uchun mijoz bu funksiyalarni to'g'ridan-to'g'ri chaqira olmaydi.
--    3. Barcha enum turlari — holat maydonlari `text` emas, enum bo'ladi,
--       shunda noto'g'ri qiymat bazaga umuman kirmaydi.
--
--  MUHIM (TZ 5.4.5): pul qiymatlari hamma joyda `numeric(14,2)`.
--  `float`/`double precision` bu loyihada TAQIQLANADI — 0.1 + 0.2 ≠ 0.3
--  muammosi moliyaviy hisobda yo'l qo'yib bo'lmas xato beradi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. KENGAYTMALAR
-- ---------------------------------------------------------------------

-- Rejalashtirilgan vazifalar (TZ 5.2 — Supabase Cron).
do $do$
begin
  create extension if not exists pg_cron with schema extensions;
exception when others then
  raise notice 'pg_cron yoqilmadi (%). 14-migratsiya jadvallarni o''tkazib yuboradi.', sqlerrm;
end $do$;

-- Baza ichidan HTTP so'rov yuborish — cron Edge Function'ni chaqirishi uchun.
do $do$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net yoqilmadi (%).', sqlerrm;
end $do$;

-- Registrga sezgir bo'lmagan matn — email va to'lov kodi uchun.
create extension if not exists citext with schema extensions;

-- ---------------------------------------------------------------------
-- 2. `app` SXEMASI
-- ---------------------------------------------------------------------

create schema if not exists app;

comment on schema app is
  'Ichki yordamchi funksiyalar: RLS konteksti, audit, davr qulfi. '
  'PostgREST orqali tashqariga chiqarilmaydi — mijoz bularni chaqira olmaydi.';

-- `anon` va `authenticated` sxemani ko'ra oladi (RLS siyosatlari ichidan
-- funksiya chaqirish uchun kerak), lekin sxemada yangi obyekt yarata olmaydi.
grant usage on schema app to authenticated, anon, service_role;
revoke create on schema app from public;

-- ---------------------------------------------------------------------
-- 3. ENUM TURLARI
-- ---------------------------------------------------------------------

-- Foydalanuvchi rollari (TZ 3-bo'lim). Super admin BU YERDA YO'Q —
-- u maktab rollari ierarxiyasiga kirmaydi va alohida jadvalda saqlanadi
-- (TZ 5.4.11). Rol maydonini o'zgartirib platforma huquqini olish mumkin emas.
create type public.user_role as enum (
  'director',    -- Direktor: hisobotlar, tasdiqlash, oyni yopish
  'accountant',  -- Buxgalter: hisoblanma, to'lov, kassa, oylik
  'manager',     -- Qabul menejeri: murojaatlar, o'quvchi qo'shish
  'duty',        -- Navbatchi: yo'qlik belgilash
  'teacher'      -- O'qituvchi: faqat o'z yuklamasi va oyligi
);

-- Maktab holati (TZ 4.13.1)
create type public.school_status as enum (
  'trial',       -- Sinov muddati
  'active',      -- Faol
  'restricted',  -- Cheklangan: o'qish va eksport ishlaydi, yangi yozuv yo'q (TZ 4.13.4)
  'archived'     -- Arxiv. Ma'lumot O'CHIRILMAYDI.
);

-- O'quvchi holati (TZ 4.3)
create type public.student_status as enum (
  'active',          -- Faol
  'academic_leave',  -- Akademik ta'til — hisoblanma shakllantirilmaydi (TZ 4.3.6)
  'expelled'         -- Chiqarilgan. Moliyaviy tarix saqlanadi (TZ 4.3.4).
);

-- Xizmatni hisoblash turi (TZ 4.4.1)
create type public.billing_type as enum (
  'monthly_fixed',  -- To'liq summa, foydalanishdan qat'i nazar. Oy boshida.
  'daily',          -- Kunlik narx × haqiqiy kunlar. Oy oxirida, faktdan keyin.
  'one_time'        -- Belgilangan summa, bir marta.
);

-- Hisoblanma holati (TZ 4.6, 4.6.1)
create type public.invoice_status as enum (
  'preliminary',  -- Dastlabki: kunlik xizmatlar taxminiy summada
  'final',        -- Yakuniy: yo'qlik asosida qayta hisoblangan
  'approved',     -- Tasdiqlangan va QULFLANGAN (TZ 4.6.7)
  'cancelled'     -- Bekor qilingan. Yozuv o'chirilmaydi (TZ 5.4.8).
);

-- Hisoblanma qatorining turi (TZ 4.6.2 — jami summa emas, qatorlar)
create type public.invoice_line_kind as enum (
  'tuition',     -- O'qish to'lovi
  'service',     -- Qo'shimcha xizmat (transport, ovqatlanish...)
  'discount',    -- Chegirma. Summa MANFIY bo'ladi.
  'adjustment',  -- Tuzatuvchi qator (qulflangan davr uchun, TZ 4.6.7)
  'carryover'    -- O'tgan oydan ko'chirilgan farq (TZ 4.6.1.3)
);

-- To'lov kanali (TZ 4.7)
create type public.payment_channel as enum (
  'cash',   -- Kassa, kvitansiya bilan
  'bank',   -- Bank vypiskasidan
  'proof'   -- Telegram orqali chek rasmi. TASDIQLANMAGUNCHA qarzni yopmaydi.
);

-- To'lov holati (TZ 4.7.3 muhim qoidasi)
create type public.payment_status as enum (
  'pending',    -- Kutilmoqda — qarzdorlikka TA'SIR QILMAYDI
  'confirmed',  -- Tasdiqlangan — faqat shu holat qarzni yopadi
  'rejected',   -- Rad etilgan
  'cancelled'   -- Bekor qilingan (xato kiritish tuzatilgan)
);

-- Murojaat holati (TZ 4.2)
create type public.lead_status as enum (
  'new',        -- Yangi
  'contacted',  -- Bog'lanildi
  'visited',    -- Kelib ko'rdi
  'accepted',   -- Qabul qilindi → o'quvchi kartochkasi yaratiladi (TZ 4.2.3)
  'rejected'    -- Rad etdi
);

-- Telegram xabar navbati holati (TZ 4.9.1.3)
create type public.message_status as enum (
  'pending',  -- Kutmoqda
  'sent',     -- Yuborildi
  'failed',   -- Xato — urinishlar soni cheklangan
  'blocked'   -- Foydalanuvchi botni bloklagan. TAKROR URINILMAYDI (TZ 4.9.1.5).
);

-- Oylik hisobi holati (TZ 4.11.8)
create type public.payroll_status as enum (
  'draft',       -- Hisoblangan, lekin kuchga kirmagan
  'approved',    -- Buxgalter tasdiqlagan → avtomatik xarajat yaratiladi (TZ 4.11.9)
  'cancelled'
);

-- Kalendar kun turi (TZ 4.5.5)
create type public.calendar_day_type as enum (
  'workday',   -- Ish kuni — kunlik xizmat hisoblanadi
  'weekend',   -- Dam olish kuni
  'holiday',   -- Bayram
  'vacation'   -- Ta'til davri
);

-- Dars holati (TZ 4.11.2)
create type public.lesson_kind as enum (
  'held',         -- Bo'lib o'tgan
  'substituted',  -- O'rniga kirilgan (boshqa o'qituvchi o'tgan)
  'not_held'      -- O'tkazilmagan. Sababi `reason` da.
);

-- Chegirma turi (TZ 12.2.4 — foizmi yoki qat'iy summami)
create type public.discount_kind as enum ('percent', 'amount');

-- Texnik yordam uchun kirish rejimi (TZ 4.13.5.4)
create type public.impersonation_mode as enum (
  'read',   -- STANDART. Faqat o'qish.
  'write'   -- Sabab ko'rsatilishi SHART.
);

-- Obuna holati (TZ 4.13.4)
create type public.subscription_status as enum (
  'trial', 'active', 'grace', 'restricted', 'cancelled'
);

-- ---------------------------------------------------------------------
-- 4. UMUMIY TRIGGER FUNKSIYALARI
-- ---------------------------------------------------------------------

-- `updated_at` ni avtomatik yangilaydi. Mijoz bu maydonni o'zi yozsa ham
-- trigger uni haqiqiy vaqtga almashtiradi.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at() is
  'BEFORE UPDATE triggeri: updated_at ni server vaqtiga o''rnatadi.';

-- Jadvalga `updated_at` triggerini biriktiradigan yordamchi. Har bir
-- jadvalda `create trigger` ni qo'lda takrorlamaslik uchun.
create or replace function app.attach_touch_trigger(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'drop trigger if exists trg_%1$s_touch on public.%1$I', p_table);
  execute format(
    'create trigger trg_%1$s_touch before update on public.%1$I
       for each row execute function app.touch_updated_at()', p_table);
end;
$$;

comment on function app.attach_touch_trigger(text) is
  'Berilgan jadvalga updated_at triggerini biriktiradi.';

-- ---------------------------------------------------------------------
-- 5. PUL BILAN ISHLASH YORDAMCHILARI
-- ---------------------------------------------------------------------

-- Yaxlitlash (TZ 12.1.9 — "summa qaysi darajagacha va qaysi tomonga
-- yaxlitlanadi"). Parametrlar oylik sozlamalaridan keladi, kodga
-- yozilmaydi (TZ 4.11.10).
create or replace function app.round_money(
  p_amount numeric,
  p_step   numeric default 1,      -- masalan 1000 — ming so'mgacha
  p_mode   text    default 'nearest' -- 'nearest' | 'up' | 'down'
)
returns numeric
language sql
immutable
as $$
  select case
    when p_amount is null then null
    when coalesce(p_step, 0) <= 0 then round(p_amount, 2)
    when p_mode = 'up'   then ceil (p_amount / p_step) * p_step
    when p_mode = 'down' then floor(p_amount / p_step) * p_step
    else round(p_amount / p_step) * p_step
  end;
$$;

comment on function app.round_money(numeric, numeric, text) is
  'Pul summasini berilgan qadam bo''yicha yaxlitlaydi. '
  'Qadam va yo''nalish sozlamadan keladi (TZ 4.11.10).';

-- Sanani oyning birinchi kuniga keltiradi. Hisoblanma va oylik davri
-- hamma joyda `date` sifatida oyning 1-sanasi bilan ifodalanadi.
create or replace function app.period_start(p_date date)
returns date
language sql
immutable
as $$
  select date_trunc('month', p_date)::date;
$$;

comment on function app.period_start(date) is
  'Hisob davri kaliti: oyning 1-sanasi. Barcha davr maydonlari shu ko''rinishda.';
