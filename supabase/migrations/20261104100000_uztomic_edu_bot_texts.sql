-- =====================================================================
--  UZTOMIC EDU — bot matnlari endi faqat "maktab" uchun emas.
--
--  Tizim nomi MaktabFinance → Uztomic Edu bo'ldi va bitta panel
--  bog'cha, maktab va o'quv markaziga xizmat qiladi. Ota-ona botidagi
--  STANDART (school_id IS NULL) matnlar "maktab" so'zisiz, har uch tur
--  uchun to'g'ri keladigan qilib yangilanadi.
--
--  Muassasa o'zi yozgan (school_id bor) matnlarga TEGILMAYDI.
--  Hech narsa o'chirilmaydi — faqat UPDATE.
-- =====================================================================

update public.translations t
   set text = v.text
  from (values
    ('start_welcome', 'uz',
     E'Assalomu alaykum! 👋\n\nBu — farzandingiz tahsil olayotgan muassasaning rasmiy boti (Uztomic Edu). Bu yerda hisoblanma, qarzdorlik va to''lov tarixini ko''rishingiz, chek yuborishingiz mumkin.\n\nBoshlash uchun telefon raqamingizni yuboring — u muassasa bazasidagi ma''lumot bilan solishtiriladi.'),
    ('start_welcome', 'ru',
     E'Здравствуйте! 👋\n\nЭто официальный бот учреждения, где учится ваш ребёнок (Uztomic Edu). Здесь можно посмотреть начисления, задолженность и историю платежей, а также отправить чек.\n\nЧтобы начать, отправьте свой номер телефона — он будет сверен с базой учреждения.'),
    ('start_welcome', 'uz-cyrl',
     E'Ассалому алайкум! 👋\n\nБу — фарзандингиз таҳсил олаётган муассасанинг расмий боти (Uztomic Edu). Бошлаш учун телефон рақамингизни юборинг.'),

    ('not_registered', 'uz',
     E'❌ Bu telefon raqam muassasa bazasida topilmadi.\n\nIltimos, qabulxona yoki administratorga murojaat qiling va raqamingizni ro''yxatdan o''tkazing.'),
    ('not_registered', 'ru',
     E'❌ Этот номер не найден в базе учреждения.\n\nПожалуйста, обратитесь к администратору для регистрации номера.'),
    ('not_registered', 'uz-cyrl',
     E'❌ Бу телефон рақам муассаса базасида топилмади.\n\nИлтимос, администраторга мурожаат қилинг.'),

    ('overdue', 'uz',
     E'⚠️ To''lov muddati o''tdi (*{days} kun*).\n\nQarzdorlik: *{balance} so''m*\nMuddat edi: {due}\nTo''lov kodi: `{code}`\n\n_Savol bo''lsa buxgalteriyaga murojaat qiling._'),
    ('overdue', 'ru',
     E'⚠️ Срок оплаты истёк (*{days} дн.*).\n\nЗадолженность: *{balance} сум*\nСрок был: {due}\nКод платежа: `{code}`\n\n_По вопросам обращайтесь в бухгалтерию._'),

    ('proof_rejected', 'uz',
     E'❌ Chek qabul qilinmadi.\n\nSabab: {reason}\n\n_Iltimos, buxgalteriyaga murojaat qiling._'),
    ('proof_rejected', 'ru',
     E'❌ Чек не принят.\n\nПричина: {reason}\n\n_Пожалуйста, обратитесь в бухгалтерию._'),

    ('attendance_absent', 'uz',
     E'⚠️ *{student}* bugun kelmadi.\n\nSinf/guruh: {class}\nSana: {date}\nSabab: {reason}\n\nAgar bu xato bo''lsa administratorga xabar bering.'),
    ('attendance_absent', 'ru',
     E'⚠️ *{student}* сегодня не пришёл(ла).\n\nКласс/группа: {class}\nДата: {date}\nПричина: {reason}\n\nЕсли это ошибка, сообщите администратору.'),
    ('attendance_absent', 'uz-cyrl',
     E'⚠️ *{student}* бугун келмади.\n\nСинф/гуруҳ: {class}\nСана: {date}\nСабаб: {reason}\n\nАгар бу хато бўлса администраторга хабар беринг.'),
    ('attendance_present', 'uz',
     E'✅ *{student}* bugun keldi.\n\nSinf/guruh: {class}\nSana: {date}'),
    ('attendance_present', 'ru',
     E'✅ *{student}* сегодня на месте.\n\nКласс/группа: {class}\nДата: {date}'),
    ('attendance_present', 'uz-cyrl',
     E'✅ *{student}* бугун келди.\n\nСинф/гуруҳ: {class}\nСана: {date}'),

    ('help_text', 'uz',
     E'ℹ️ *Bot nima qila oladi*\n\n📅 Davomat — farzandingiz qaysi kunlari kelgan\n💰 Qarzdorlik — qancha to''lash kerak\n📄 Hisoblanma — shu oy nima uchun qancha\n🧾 To''lov tarixi — qachon qancha to''langan\n📸 Chek yuborish — to''lov chekini rasmga olib yuboring\n☎️ Bog''lanish — muassasa telefoni\n🔔 Xabarlar — yoqish yoki o''chirish\n\nBuyruqlar:\n/menu — bosh menyu\n/til — tilni almashtirish\n/yordam — shu matn'),
    ('help_text', 'ru',
     E'ℹ️ *Что умеет бот*\n\n📅 Посещаемость — в какие дни ребёнок был на занятиях\n💰 Задолженность — сколько нужно заплатить\n📄 Начисление — за что и сколько в этом месяце\n🧾 История платежей — когда и сколько оплачено\n📸 Отправить чек — сфотографируйте квитанцию\n☎️ Контакты — телефон учреждения\n🔔 Уведомления — включить или выключить\n\nКоманды:\n/menu — главное меню\n/til — сменить язык\n/yordam — этот текст'),
    ('help_text', 'uz-cyrl',
     E'ℹ️ *Бот нима қила олади*\n\n📅 Давомат — фарзандингиз қайси кунлари келган\n💰 Қарздорлик — қанча тўлаш керак\n📄 Ҳисобланма — шу ой нима учун қанча\n🧾 Тўлов тарихи — қачон қанча тўланган\n📸 Чек юбориш — тўлов чекини расмга олиб юборинг\n☎️ Боғланиш — муассаса телефони\n🔔 Хабарлар — ёқиш ёки ўчириш\n\nБуйруқлар:\n/menu — бош меню\n/тил — тилни алмаштириш\n/ёрдам — шу матн'),

    ('payment_corrected', 'uz',
     E'✏️ To''lovingiz tuzatildi.\n\nOldingi summa: {old_amount} so''m\nYangi summa: *{amount} so''m*\nKvitansiya: `{receipt}`\nJoriy qoldiq: *{balance} so''m*\n\n_Savol bo''lsa buxgalteriyaga murojaat qiling._'),
    ('payment_corrected', 'ru',
     E'✏️ Ваш платёж скорректирован.\n\nПрежняя сумма: {old_amount} сум\nНовая сумма: *{amount} сум*\nКвитанция: `{receipt}`\nТекущий остаток: *{balance} сум*\n\n_По вопросам обращайтесь в бухгалтерию._'),

    ('menu_contact', 'uz',      '☎️ Bog''lanish'),
    ('menu_contact', 'ru',      '☎️ Связаться'),
    ('menu_contact', 'uz-cyrl', '☎️ Боғланиш')
  ) as v(key, lang, text)
 where t.scope = 'bot'
   and t.key = v.key
   and t.lang = v.lang
   and t.school_id is null;
