-- =====================================================================
--  17 — BOSHLANG'ICH MA'LUMOTLAR
--
--  Uch qism:
--    1. Huquqlar matritsasi (TZ 3.1) — platforma standarti
--    2. Bot va hisobot matnlari uch tilda (TZ 5.6)
--    3. `seed_school_defaults()` — TZ 4.13.2.5 dagi "Boshlang'ich
--       sozlamalarni SHABLONDAN yuklash" qadami
--
--  MUHIM: bu yerdagi qiymatlar STANDART, qat'iy emas. Maktab har
--  birini o'z panelidan o'zgartira oladi (TZ 4.11.10, 4.10.1, 5.6.5).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HUQUQLAR MATRITSASI (TZ 3.1)
--
--  Bu TZ 3.1 jadvalining bevosita o'girmasi. school_id = null →
--  platforma standarti. Maktab o'z qatorini qo'shib standartni
--  bekor qilishi mumkin.
-- ---------------------------------------------------------------------

insert into public.role_permissions (role, permission, school_id, allowed)
select r.role::public.user_role, p.perm, null, true
from (values
  -- DIREKTOR — TZ 3: hisobotlar, tasdiqlash, oyni yopish,
  -- foydalanuvchilarni boshqarish. Amalda maktabning to'liq nazorati.
  ('director', array[
    'users.manage', 'students.manage', 'services.manage', 'absences.mark',
    'invoices.generate', 'payments.create', 'discounts.set', 'expenses.create',
    'teachers.manage', 'lessons.manage', 'payroll.manage', 'payroll.approve',
    'payroll.view', 'leads.manage', 'reports.view', 'period.close']),

  -- BUXGALTER — TZ 3: hisoblanma, to'lov, kassa, vypiska, xarajat,
  -- oylik hisob-kitobi. Chegirma belgilash va oyni yopish YO'Q —
  -- ular direktor qarori (TZ 3.1 jadvalida alohida qatorlar).
  ('accountant', array[
    'students.manage', 'services.manage', 'absences.mark',
    'invoices.generate', 'payments.create', 'expenses.create',
    'teachers.manage', 'lessons.manage', 'payroll.manage', 'payroll.approve',
    'payroll.view', 'reports.view']),

  -- QABUL MENEJERI — TZ 3: murojaatlar bilan ishlash, o'quvchi qo'shish.
  ('manager', array['leads.manage', 'students.manage']),

  -- NAVBATCHI — TZ 3: yo'qlik belgilash.
  ('duty', array['absences.mark']),

  -- O'QITUVCHI — TZ 3: faqat o'z yuklamasi va oyligini KO'RISH.
  -- Bu huquq matritsa orqali emas, RLS dagi alohida "_select_own"
  -- siyosatlari orqali beriladi (10-migratsiya). Shuning uchun
  -- bu yerda ro'yxat bo'sh.
  ('teacher', array[]::text[])
) as r(role, perms)
cross join lateral unnest(r.perms) as p(perm)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2. TARJIMALAR (TZ 5.6)
--
--  Bot xabarlari. {kalit} ko'rinishidagi o'rin egallar queue-sender
--  tomonidan `params` dan to'ldiriladi.
-- ---------------------------------------------------------------------

insert into public.translations (scope, key, lang, text, school_id)
values
-- ===== HISOBLANMA =====
('bot', 'invoice_created', 'uz',
 E'📄 *{period}* oyi uchun hisoblanma tayyor.\n\nJami: *{total} so''m*\nTo''lov muddati: {due}\nTo''lov kodi: `{code}`\n\n_To''lov qilganda izohda to''lov kodini ko''rsating._', null),
('bot', 'invoice_created', 'ru',
 E'📄 Начислен счёт за *{period}*.\n\nИтого: *{total} сум*\nСрок оплаты: {due}\nКод платежа: `{code}`\n\n_При оплате укажите код платежа в назначении._', null),
('bot', 'invoice_created', 'uz-cyrl',
 E'📄 *{period}* ойи учун ҳисобланма тайёр.\n\nЖами: *{total} сўм*\nТўлов муддати: {due}\nТўлов коди: `{code}`\n\n_Тўлов қилганда изоҳда тўлов кодини кўрсатинг._', null),

('bot', 'invoice_final', 'uz',
 E'✅ *{period}* oyi uchun *yakuniy* hisoblanma.\n\nKunlik xizmatlar haqiqiy kunlar bo''yicha qayta hisoblandi.\n\nJami: *{total} so''m*\nTo''lov muddati: {due}\nTo''lov kodi: `{code}`', null),
('bot', 'invoice_final', 'ru',
 E'✅ *Окончательный* счёт за *{period}*.\n\nЕжедневные услуги пересчитаны по фактическим дням.\n\nИтого: *{total} сум*\nСрок оплаты: {due}\nКод платежа: `{code}`', null),
('bot', 'invoice_final', 'uz-cyrl',
 E'✅ *{period}* ойи учун *якуний* ҳисобланма.\n\nКунлик хизматлар ҳақиқий кунлар бўйича қайта ҳисобланди.\n\nЖами: *{total} сўм*\nТўлов муддати: {due}\nТўлов коди: `{code}`', null),

-- ===== ESLATMALAR =====
('bot', 'due_soon', 'uz',
 E'⏰ To''lov muddatiga *{days} kun* qoldi.\n\nQarzdorlik: *{balance} so''m*\nMuddat: {due}\nTo''lov kodi: `{code}`', null),
('bot', 'due_soon', 'ru',
 E'⏰ До срока оплаты осталось *{days} дн.*\n\nЗадолженность: *{balance} сум*\nСрок: {due}\nКод платежа: `{code}`', null),
('bot', 'due_soon', 'uz-cyrl',
 E'⏰ Тўлов муддатига *{days} кун* қолди.\n\nҚарздорлик: *{balance} сўм*\nМуддат: {due}\nТўлов коди: `{code}`', null),

('bot', 'overdue', 'uz',
 E'⚠️ To''lov muddati o''tdi (*{days} kun*).\n\nQarzdorlik: *{balance} so''m*\nMuddat edi: {due}\nTo''lov kodi: `{code}`\n\n_Savol bo''lsa maktab buxgalteriga murojaat qiling._', null),
('bot', 'overdue', 'ru',
 E'⚠️ Срок оплаты истёк (*{days} дн.*).\n\nЗадолженность: *{balance} сум*\nСрок был: {due}\nКод платежа: `{code}`\n\n_По вопросам обращайтесь в бухгалтерию школы._', null),
('bot', 'overdue', 'uz-cyrl',
 E'⚠️ Тўлов муддати ўтди (*{days} кун*).\n\nҚарздорлик: *{balance} сўм*\nМуддат эди: {due}\nТўлов коди: `{code}`', null),

-- ===== TO'LOVLAR =====
('bot', 'payment_received', 'uz',
 E'✅ To''lovingiz qabul qilindi.\n\nSumma: *{amount} so''m*\nSana: {date}\nKvitansiya: `{receipt}`\nJoriy qoldiq: *{balance} so''m*', null),
('bot', 'payment_received', 'ru',
 E'✅ Ваш платёж принят.\n\nСумма: *{amount} сум*\nДата: {date}\nКвитанция: `{receipt}`\nТекущий остаток: *{balance} сум*', null),
('bot', 'payment_received', 'uz-cyrl',
 E'✅ Тўловингиз қабул қилинди.\n\nСумма: *{amount} сўм*\nСана: {date}\nКвитанция: `{receipt}`\nЖорий қолдиқ: *{balance} сўм*', null),

('bot', 'proof_confirmed', 'uz',
 E'✅ Chekingiz tasdiqlandi.\n\nSumma: *{amount} so''m*\nJoriy qoldiq: *{balance} so''m*', null),
('bot', 'proof_confirmed', 'ru',
 E'✅ Ваш чек подтверждён.\n\nСумма: *{amount} сум*\nТекущий остаток: *{balance} сум*', null),
('bot', 'proof_confirmed', 'uz-cyrl',
 E'✅ Чекингиз тасдиқланди.\n\nСумма: *{amount} сўм*\nЖорий қолдиқ: *{balance} сўм*', null),

('bot', 'proof_rejected', 'uz',
 E'❌ Chek qabul qilinmadi.\n\nSabab: {reason}\n\n_Iltimos, maktab buxgalteriga murojaat qiling._', null),
('bot', 'proof_rejected', 'ru',
 E'❌ Чек не принят.\n\nПричина: {reason}\n\n_Пожалуйста, обратитесь в бухгалтерию школы._', null),
('bot', 'proof_rejected', 'uz-cyrl',
 E'❌ Чек қабул қилинмади.\n\nСабаб: {reason}', null),

-- ===== BOT INTERFEYSI =====
('bot', 'start_welcome', 'uz',
 E'Assalomu alaykum! 👋\n\nBu — maktabning rasmiy boti. Bu yerda farzandingizning hisoblanmasi, qarzdorligi va to''lov tarixini ko''rishingiz mumkin.\n\nBoshlash uchun telefon raqamingizni yuboring — u maktabdagi ma''lumot bilan solishtiriladi.', null),
('bot', 'start_welcome', 'ru',
 E'Здравствуйте! 👋\n\nЭто официальный бот школы. Здесь вы можете посмотреть начисления, задолженность и историю платежей вашего ребёнка.\n\nЧтобы начать, отправьте свой номер телефона — он будет сверен с данными школы.', null),
('bot', 'start_welcome', 'uz-cyrl',
 E'Ассалому алайкум! 👋\n\nБу — мактабнинг расмий боти. Бошлаш учун телефон рақамингизни юборинг.', null),

('bot', 'share_phone', 'uz', '📱 Telefon raqamni yuborish', null),
('bot', 'share_phone', 'ru', '📱 Отправить номер телефона', null),
('bot', 'share_phone', 'uz-cyrl', '📱 Телефон рақамни юбориш', null),

('bot', 'linked_ok', 'uz',
 E'✅ Raqamingiz tasdiqlandi.\n\nSiz *{children}* ta farzandning ma''lumotini ko''rishingiz mumkin.', null),
('bot', 'linked_ok', 'ru',
 E'✅ Ваш номер подтверждён.\n\nВам доступна информация по *{children}* реб.', null),
('bot', 'linked_ok', 'uz-cyrl',
 E'✅ Рақамингиз тасдиқланди.\n\nСиз *{children}* та фарзанднинг маълумотини кўришингиз мумкин.', null),

('bot', 'not_registered', 'uz',
 E'❌ Bu telefon raqam maktab bazasida topilmadi.\n\nIltimos, maktab qabulxonasiga murojaat qiling va raqamingizni ro''yxatdan o''tkazing.', null),
('bot', 'not_registered', 'ru',
 E'❌ Этот номер не найден в базе школы.\n\nПожалуйста, обратитесь в приёмную школы для регистрации номера.', null),
('bot', 'not_registered', 'uz-cyrl',
 E'❌ Бу телефон рақам мактаб базасида топилмади.\n\nИлтимос, мактаб қабулхонасига мурожаат қилинг.', null),

('bot', 'menu_debt',    'uz', '💰 Qarzdorlik',        null),
('bot', 'menu_debt',    'ru', '💰 Задолженность',     null),
('bot', 'menu_debt',    'uz-cyrl', '💰 Қарздорлик',   null),
('bot', 'menu_invoice', 'uz', '📄 Hisoblanma',        null),
('bot', 'menu_invoice', 'ru', '📄 Начисления',        null),
('bot', 'menu_invoice', 'uz-cyrl', '📄 Ҳисобланма',   null),
('bot', 'menu_history', 'uz', '🧾 To''lov tarixi',    null),
('bot', 'menu_history', 'ru', '🧾 История платежей',  null),
('bot', 'menu_history', 'uz-cyrl', '🧾 Тўлов тарихи', null),
('bot', 'menu_proof',   'uz', '📸 Chek yuborish',     null),
('bot', 'menu_proof',   'ru', '📸 Отправить чек',     null),
('bot', 'menu_proof',   'uz-cyrl', '📸 Чек юбориш',   null),
('bot', 'menu_lang',    'uz', '🌐 Til',               null),
('bot', 'menu_lang',    'ru', '🌐 Язык',              null),
('bot', 'menu_lang',    'uz-cyrl', '🌐 Тил',          null),
('bot', 'menu_contact', 'uz', '☎️ Maktab bilan bog''lanish', null),
('bot', 'menu_contact', 'ru', '☎️ Связаться со школой',      null),
('bot', 'menu_contact', 'uz-cyrl', '☎️ Мактаб билан боғланиш', null),

('bot', 'proof_received', 'uz',
 E'📸 Chek qabul qilindi, tekshirilmoqda.\n\n⚠️ *Diqqat:* chek tasdiqlanmaguncha qarzdorlik yopilmaydi. Buxgalter tekshirgach sizga xabar beramiz.', null),
('bot', 'proof_received', 'ru',
 E'📸 Чек получен, проверяется.\n\n⚠️ *Внимание:* задолженность не закрывается до подтверждения чека. Мы сообщим вам после проверки бухгалтером.', null),
('bot', 'proof_received', 'uz-cyrl',
 E'📸 Чек қабул қилинди, текширилмоқда.\n\n⚠️ Чек тасдиқланмагунча қарздорлик ёпилмайди.', null),

('bot', 'ask_proof_photo', 'uz',
 'Chek rasmini yuboring 📸 (surat ko''rinishida, hujjat sifatida emas).', null),
('bot', 'ask_proof_photo', 'ru',
 'Отправьте фото чека 📸 (именно фото, не файлом).', null),
('bot', 'ask_proof_photo', 'uz-cyrl',
 'Чек расмини юборинг 📸', null),

('bot', 'no_debt', 'uz',
 E'✅ *{student}*\n\nQarzdorlik yo''q. Rahmat!', null),
('bot', 'no_debt', 'ru',
 E'✅ *{student}*\n\nЗадолженности нет. Спасибо!', null),
('bot', 'no_debt', 'uz-cyrl',
 E'✅ *{student}*\n\nҚарздорлик йўқ. Раҳмат!', null),

('bot', 'lang_changed', 'uz', '✅ Til o''zgartirildi.', null),
('bot', 'lang_changed', 'ru', '✅ Язык изменён.',       null),
('bot', 'lang_changed', 'uz-cyrl', '✅ Тил ўзгартирилди.', null),

('bot', 'choose_child', 'uz', 'Farzandni tanlang:',    null),
('bot', 'choose_child', 'ru', 'Выберите ребёнка:',     null),
('bot', 'choose_child', 'uz-cyrl', 'Фарзандни танланг:', null),

('bot', 'error_generic', 'uz',
 'Xatolik yuz berdi. Birozdan keyin qayta urinib ko''ring.', null),
('bot', 'error_generic', 'ru',
 'Произошла ошибка. Попробуйте позже.', null),
('bot', 'error_generic', 'uz-cyrl',
 'Хатолик юз берди. Бироздан кейин қайта уриниб кўринг.', null)
on conflict do nothing;

-- =====================================================================
--  3. MAKTAB SHABLONI (TZ 4.13.2.5)
--
--  "Boshlang'ich sozlamalarni shablondan yuklash: xarajat
--   kategoriyalari, standart xizmatlar, kalendar."
--
--  Super admin yangi maktab ulaganda shu funksiya chaqiriladi —
--  DASTURCHI ARALASHUVI KERAK EMAS (TZ 4.13.2 talabi).
-- =====================================================================

create or replace function public.seed_school_defaults(p_school_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_count int := 0;
begin
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu funksiya faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  -- --- Xarajat kategoriyalari (TZ 4.10) ----------------------------
  insert into public.expense_categories (school_id, code, name, is_system, sort_order)
  values
    (p_school_id, 'rent',       'Ijara',                false, 10),
    (p_school_id, 'utilities',  'Kommunal xizmatlar',   false, 20),
    (p_school_id, 'internet',   'Internet va aloqa',    false, 30),
    (p_school_id, 'repair',     'Ta''mir',              false, 40),
    (p_school_id, 'kitchen',    'Oshxona mahsulotlari', false, 50),
    (p_school_id, 'stationery', 'Kanselyariya',         false, 60),
    (p_school_id, 'marketing',  'Reklama',              false, 70),
    (p_school_id, 'transport',  'Transport xarajatlari',false, 80),
    (p_school_id, 'taxes',      'Soliqlar',             false, 90),
    -- Ish haqi — TIZIM kategoriyasi. Oylik hisobidan avtomatik
    -- yozuv tushadi, o'chirib bo'lmaydi (TZ 4.10.2, 4.11.9).
    (p_school_id, 'salary',     'Ish haqi',             true, 100),
    (p_school_id, 'other',      'Boshqa',               false, 999)
  on conflict (school_id, code) do nothing;

  -- --- Yo'qlik sabablari (TZ 12.3.5) -------------------------------
  insert into public.absence_reasons (school_id, code, name, deducts, sort_order)
  values
    (p_school_id, 'sick',     'Kasallik',        true,  10),
    (p_school_id, 'family',   'Oilaviy sabab',   true,  20),
    (p_school_id, 'vacation', 'Ta''til',         true,  30),
    -- Sababsiz: kun HISOBLANADI (pul olinadi).
    (p_school_id, 'unexcused','Sababsiz',        false, 40)
  on conflict (school_id, code) do nothing;

  -- --- Chegirma turlari (TZ 12.2.3) --------------------------------
  --  Qiymatlar STANDART — maktab o'z foizini qo'yadi.
  insert into public.discount_types (school_id, code, name, kind, value)
  values
    (p_school_id, 'second_child', '2-farzand',        'percent', 10),
    (p_school_id, 'third_child',  '3-farzand',        'percent', 20),
    (p_school_id, 'staff_child',  'Xodim farzandi',   'percent', 50),
    (p_school_id, 'privileged',   'Imtiyozli toifa',  'percent', 30)
  on conflict (school_id, code) do nothing;

  -- --- Moliya sozlamalari ------------------------------------------
  insert into public.school_settings (school_id, key, value, note)
  values
    (p_school_id, 'academic_year_start_month', '9'::jsonb,
     'O''quv yili boshlanadigan oy. billing_months < 12 bo''lganda ishlatiladi (TZ 12.2.1)'),
    (p_school_id, 'billing.daily_diff_method', '"recalculate"'::jsonb,
     'TZ 4.6.1.3 — kunlik xizmat farqi: "recalculate" (joriy oy qayta hisoblanadi) yoki "carryover" (keyingi oyga o''tadi)'),
    (p_school_id, 'messaging.quiet_hours', '{"from":20,"to":8}'::jsonb,
     'TZ 4.9.3 — bu oraliqda xabar yuborilmaydi (maktab mintaqasi bo''yicha)'),
    (p_school_id, 'messaging.reminder_days_before', '3'::jsonb,
     'TZ 4.9 — to''lov muddatidan necha kun oldin eslatma yuboriladi'),
    (p_school_id, 'files.proof_retention_days', '90'::jsonb,
     'TZ 4.7.4 — tasdiqlanmagan/rad etilgan chek necha kundan keyin o''chiriladi'),
    (p_school_id, 'files.stale_proof_days', '60'::jsonb,
     'TZ 4.7.3.6 — chek shuncha kun kutilsa buxgalterga ogohlantirish')
  on conflict (school_id, key) do nothing;

  -- --- Oylik sozlamalari (TZ 4.11.10) ------------------------------
  --  DIQQAT: bu qiymatlar VAQTINCHALIK STANDART. Buxgalter bilan
  --  formula kelishilgach (TZ 7.1) shular yangilanadi — kod emas.
  insert into public.payroll_settings (school_id, key, value, note)
  values
    (p_school_id, 'base_type', '"fixed"'::jsonb,
     'TZ 12.1.1 — "fixed" (qat''iy oylik) | "rate" (stavka) | "hourly" (soatbay) | "mixed"'),
    (p_school_id, 'hours_per_rate', '24'::jsonb,
     'TZ 12.1.2 — bir stavka necha soat (haftasiga)'),
    (p_school_id, 'hour_price', '0'::jsonb,
     'TZ 12.1.3 — bir soat narxi. base_type = rate/hourly/mixed da ishlatiladi'),
    (p_school_id, 'category_factors', '{}'::jsonb,
     'TZ 12.1.3 — toifa koeffitsiyentlari, masalan {"oliy":1.2,"birinchi":1.1}'),
    (p_school_id, 'substitution_percent', '100'::jsonb,
     'TZ 12.1.4 — o''rniga kirilgan dars necha foiz to''lanadi'),
    (p_school_id, 'unheld_lesson_policy',
     '{"holiday":{"paid_percent":100},"quarantine":{"paid_percent":100},"teacher_absent":{"paid_percent":0},"default":{"paid_percent":0}}'::jsonb,
     'TZ 12.1.5 — o''tkazilmagan dars sabab bo''yicha necha foiz to''lanadi'),
    (p_school_id, 'allowances',
     '[{"code":"class_teacher","name":"Sinf rahbarligi","type":"fixed","value":0},{"code":"notebooks","name":"Daftar tekshirish","type":"fixed","value":0},{"code":"club","name":"To''garak","type":"fixed","value":0}]'::jsonb,
     'TZ 12.1.6 — ustamalar katalogi. Kim olishi teacher_allowances jadvalida'),
    (p_school_id, 'deductions', '[]'::jsonb,
     'TZ 12.1.7 — ushlanmalar: [{"code":"income_tax","name":"Daromad solig''i","type":"percent","value":12}]'),
    (p_school_id, 'rounding', '{"step":1000,"mode":"nearest"}'::jsonb,
     'TZ 12.1.9 — summa qaysi darajagacha va qaysi tomonga yaxlitlanadi'),
    (p_school_id, 'period', '{"start_day":1,"end_day":0}'::jsonb,
     'TZ 12.1.10 — hisob davri. end_day = 0 → oyning oxirgi kuni')
  on conflict (school_id, key, effective_from) do nothing;

  -- --- Kalendar: joriy va keyingi yil dam olish kunlari -------------
  --  Dushanba-juma standart ish kuni bo'lgani uchun faqat ISTISNOLAR
  --  kiritiladi (O'zbekiston bayramlari).
  insert into public.calendar_days (school_id, branch_id, day, day_type, name)
  select p_school_id, null, d.day, 'holiday', d.name
  from (values
    (make_date(v_year, 1, 1),  'Yangi yil'),
    (make_date(v_year, 3, 8),  'Xotin-qizlar kuni'),
    (make_date(v_year, 3, 21), 'Navro''z'),
    (make_date(v_year, 5, 9),  'Xotira va qadrlash kuni'),
    (make_date(v_year, 9, 1),  'Mustaqillik kuni'),
    (make_date(v_year, 10, 1), 'O''qituvchi va murabbiylar kuni'),
    (make_date(v_year, 12, 8), 'Konstitutsiya kuni'),
    (make_date(v_year + 1, 1, 1),  'Yangi yil'),
    (make_date(v_year + 1, 3, 8),  'Xotin-qizlar kuni'),
    (make_date(v_year + 1, 3, 21), 'Navro''z')
  ) as d(day, name)
  on conflict do nothing;

  get diagnostics v_count = row_count;

  return jsonb_build_object('school_id', p_school_id, 'seeded', true);
end;
$$;

comment on function public.seed_school_defaults(uuid) is
  'TZ 4.13.2.5 — yangi maktab uchun boshlang''ich sozlamalarni '
  'shablondan yuklaydi. Dasturchi aralashuvi kerak emas.';

-- =====================================================================
--  4. YANGI MAKTABNI ULASH (TZ 4.13.2)
--
--  Super admin sehrgarining bazaviy qismi. Direktor hisobini yaratish
--  Auth API ni talab qiladi va Edge Function (`provision-school`)
--  tomonidan bajariladi — u shu funksiyani chaqiradi.
-- =====================================================================

create or replace function public.provision_school(
  p_name         text,
  p_branch_name  text default 'Asosiy filial',
  p_plan_code    text default null,
  p_trial_days   int  default 30,
  p_address      text default null,
  p_phone        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_branch uuid;
  v_plan   uuid;
begin
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  insert into public.schools (name, address, phone, status)
  values (p_name, p_address, p_phone, 'trial')
  returning id into v_school;

  -- TZ 5.4.2 — bitta filial bo'lsa ham standart filial yaratiladi.
  insert into public.branches (school_id, name, address, phone, is_default)
  values (v_school, p_branch_name, p_address, p_phone, true)
  returning id into v_branch;

  if p_plan_code is not null then
    select id into v_plan from public.plans where code = p_plan_code;
  end if;
  if v_plan is null then
    select id into v_plan from public.plans where is_active order by sort_order limit 1;
  end if;

  if v_plan is not null then
    insert into public.school_subscriptions
      (school_id, plan_id, status, monthly_amount, trial_ends_at, next_payment_date)
    select v_school, v_plan, 'trial', p.monthly_price,
           current_date + p_trial_days, current_date + p_trial_days
      from public.plans p where p.id = v_plan;
  end if;

  perform public.seed_school_defaults(v_school);

  insert into public.platform_log (admin_id, action, entity, entity_id, school_id, after)
  values ((select auth.uid()), 'school_provisioned', 'schools',
          v_school::text, v_school,
          jsonb_build_object('name', p_name, 'branch', p_branch_name));

  return jsonb_build_object(
    'school_id', v_school,
    'branch_id', v_branch,
    'plan_id',   v_plan);
end;
$$;

comment on function public.provision_school(text, text, text, int, text, text) is
  'TZ 4.13.2 — yangi maktabni ulash: maktab + standart filial + obuna + '
  'shablon sozlamalar. Bazaga qo''lda murojaat talab qilinmaydi.';

-- --- Standart tariflar ----------------------------------------------
insert into public.plans (code, name, monthly_price, max_students, max_branches, sort_order)
values
  ('trial',    'Sinov',      0,        100,  1, 10),
  ('basic',    'Asosiy',     500000,   300,  2, 20),
  ('standard', 'Standart',   900000,   700,  5, 30),
  ('unlimited','Cheklovsiz', 1500000,  null, null, 40)
on conflict (code) do nothing;

revoke all on function public.seed_school_defaults(uuid) from public, anon;
revoke all on function public.provision_school(text, text, text, int, text, text)
  from public, anon;
grant execute on function public.seed_school_defaults(uuid) to authenticated, service_role;
grant execute on function public.provision_school(text, text, text, int, text, text)
  to authenticated, service_role;
