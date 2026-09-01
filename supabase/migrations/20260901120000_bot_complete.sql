-- =====================================================================
--  TELEGRAM BOT — YETISHMAYOTGAN QISMLAR
--
--  Botda ota-onaning eng ko'p beradigan savoliga javob YO'Q edi:
--  "farzandim bugun maktabda bo'ldimi?". Kunlik xabar yuborilardi,
--  lekin uni o'chirib yuborgan yoki o'qimagan odam keyin tekshira
--  olmasdi.
--
--  `menu_contact` tarjimasi bor edi, lekin menyuda ishlatilmagan —
--  ya'ni maktabning telefonini botdan topib bo'lmasdi.
--
--  Xabarlarni o'chirish imkoni ham yo'q edi. Bu shunchaki qulaylik
--  emas: xabar keraksiz bo'lsa odam butun botni bloklaydi va keyin
--  MUHIM xabar ham bormaydi.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Ota-ona xabarlarni o'chira olsin
-- ---------------------------------------------------------------------
alter table public.parents
  add column if not exists notify boolean not null default true;

comment on column public.parents.notify is
  'Ota-ona botdan xabar olishni o''chirib qo''ygan. To''liq bloklashdan '
  'ko''ra shu yaxshi: bloklansa muhim xabar ham bormaydi.';

-- ---------------------------------------------------------------------
--  Navbatga qo'yishda hisobga olinsin
--
--  Ta'rif jonli bazadan olindi va faqat bitta shart qo'shildi —
--  imzosi ham, qolgan mantiq ham o'zgarmaydi.
-- ---------------------------------------------------------------------
create or replace function app.enqueue_for_student(
  p_student_id   uuid,
  p_template_key text,
  p_params       jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    select sp.parent_id, s.school_id
      from public.student_parents sp
      join public.students s on s.id = sp.student_id
      join public.parents  p on p.id = sp.parent_id
     where sp.student_id = p_student_id
       and s.deleted_at is null
       --  Xabarni o'chirib qo'ygan ota-onaga yuborilmaydi. Ilgari
       --  bunday imkon yo'q edi va keraksiz xabardan bezgan odam
       --  butun botni bloklardi — keyin MUHIM xabar ham bormasdi.
       and p.notify
       and p.deleted_at is null
       and p.is_active
  loop
    if app.enqueue_message(v_row.school_id, v_row.parent_id, p_student_id,
                           p_template_key, p_params, p_scheduled_at) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

-- =====================================================================
--  BOT MATNLARI
-- =====================================================================

insert into public.translations (scope, key, lang, text, school_id) values

-- --- Menyu tugmalari --------------------------------------------------
('bot', 'menu_attendance', 'uz',      '📅 Davomat', null),
('bot', 'menu_attendance', 'uz-cyrl', '📅 Давомат', null),
('bot', 'menu_attendance', 'ru',      '📅 Посещаемость', null),

('bot', 'menu_notify', 'uz',      '🔔 Xabarlar', null),
('bot', 'menu_notify', 'uz-cyrl', '🔔 Хабарлар', null),
('bot', 'menu_notify', 'ru',      '🔔 Уведомления', null),

-- --- Davomat ----------------------------------------------------------
('bot', 'attendance_month', 'uz',
 E'📅 *{student}* — {month}\n\n✅ Kelgan: *{present}* kun\n❌ Kelmagan: *{absent}* kun\n🕐 Kech kelgan: *{late}* kun', null),
('bot', 'attendance_month', 'uz-cyrl',
 E'📅 *{student}* — {month}\n\n✅ Келган: *{present}* кун\n❌ Келмаган: *{absent}* кун\n🕐 Кеч келган: *{late}* кун', null),
('bot', 'attendance_month', 'ru',
 E'📅 *{student}* — {month}\n\n✅ Присутствовал: *{present}* дн.\n❌ Отсутствовал: *{absent}* дн.\n🕐 Опоздал: *{late}* дн.', null),

('bot', 'attendance_none', 'uz',
 E'📅 *{student}*\n\nBu oyda davomat belgilanmagan.', null),
('bot', 'attendance_none', 'uz-cyrl',
 E'📅 *{student}*\n\nБу ойда давомат белгиланмаган.', null),
('bot', 'attendance_none', 'ru',
 E'📅 *{student}*\n\nВ этом месяце посещаемость не отмечалась.', null),

('bot', 'attendance_days', 'uz',      E'\n\nKelmagan kunlar:\n{days}', null),
('bot', 'attendance_days', 'uz-cyrl', E'\n\nКелмаган кунлар:\n{days}', null),
('bot', 'attendance_days', 'ru',      E'\n\nПропущенные дни:\n{days}', null),

-- --- Maktab bilan bog'lanish -------------------------------------------
('bot', 'contact_info', 'uz',
 E'☎️ *{school}*\n\n📞 {phone}\n📍 {address}\n\nSavolingiz bo''lsa shu raqamga qo''ng''iroq qiling.', null),
('bot', 'contact_info', 'uz-cyrl',
 E'☎️ *{school}*\n\n📞 {phone}\n📍 {address}\n\nСаволингиз бўлса шу рақамга қўнғироқ қилинг.', null),
('bot', 'contact_info', 'ru',
 E'☎️ *{school}*\n\n📞 {phone}\n📍 {address}\n\nПо вопросам звоните на этот номер.', null),

-- --- Xabarlar ----------------------------------------------------------
('bot', 'notify_status_on', 'uz',
 E'🔔 Xabarlar *yoqilgan*.\n\nSiz davomat, hisoblanma va to''lov haqida xabar olasiz.', null),
('bot', 'notify_status_on', 'uz-cyrl',
 E'🔔 Хабарлар *ёқилган*.\n\nСиз давомат, ҳисобланма ва тўлов ҳақида хабар оласиз.', null),
('bot', 'notify_status_on', 'ru',
 E'🔔 Уведомления *включены*.\n\nВы получаете сообщения о посещаемости, начислениях и оплате.', null),

('bot', 'notify_status_off', 'uz',
 E'🔕 Xabarlar *o''chirilgan*.\n\nMa''lumotni istalgan vaqtda shu bot orqali o''zingiz ko''rishingiz mumkin.', null),
('bot', 'notify_status_off', 'uz-cyrl',
 E'🔕 Хабарлар *ўчирилган*.\n\nМаълумотни исталган вақтда шу бот орқали ўзингиз кўришингиз мумкин.', null),
('bot', 'notify_status_off', 'ru',
 E'🔕 Уведомления *выключены*.\n\nДанные вы можете посмотреть в этом боте в любое время.', null),

('bot', 'notify_turn_on', 'uz',      '🔔 Yoqish', null),
('bot', 'notify_turn_on', 'uz-cyrl', '🔔 Ёқиш', null),
('bot', 'notify_turn_on', 'ru',      '🔔 Включить', null),

('bot', 'notify_turn_off', 'uz',      '🔕 O''chirish', null),
('bot', 'notify_turn_off', 'uz-cyrl', '🔕 Ўчириш', null),
('bot', 'notify_turn_off', 'ru',      '🔕 Выключить', null),

-- --- Yordam -------------------------------------------------------------
('bot', 'help_text', 'uz',
 E'ℹ️ *Bot nima qila oladi*\n\n📅 Davomat — farzandingiz qaysi kunlari kelgan\n💰 Qarzdorlik — qancha to''lash kerak\n📄 Hisoblanma — shu oy nima uchun qancha\n🧾 To''lov tarixi — qachon qancha to''langan\n📸 Chek yuborish — to''lov chekini rasmga olib yuboring\n☎️ Bog''lanish — maktab telefoni\n🔔 Xabarlar — yoqish yoki o''chirish\n\nBuyruqlar:\n/menu — bosh menyu\n/til — tilni almashtirish\n/yordam — shu matn', null),
('bot', 'help_text', 'uz-cyrl',
 E'ℹ️ *Бот нима қила олади*\n\n📅 Давомат — фарзандингиз қайси кунлари келган\n💰 Қарздорлик — қанча тўлаш керак\n📄 Ҳисобланма — шу ой нима учун қанча\n🧾 Тўлов тарихи — қачон қанча тўланган\n📸 Чек юбориш — тўлов чекини расмга олиб юборинг\n☎️ Боғланиш — мактаб телефони\n🔔 Хабарлар — ёқиш ёки ўчириш\n\nБуйруқлар:\n/menu — бош меню\n/тил — тилни алмаштириш\n/ёрдам — шу матн', null),
('bot', 'help_text', 'ru',
 E'ℹ️ *Что умеет бот*\n\n📅 Посещаемость — в какие дни ребёнок был в школе\n💰 Задолженность — сколько нужно заплатить\n📄 Начисление — за что и сколько в этом месяце\n🧾 История платежей — когда и сколько оплачено\n📸 Отправить чек — сфотографируйте квитанцию\n☎️ Контакты — телефон школы\n🔔 Уведомления — включить или выключить\n\nКоманды:\n/menu — главное меню\n/til — сменить язык\n/yordam — этот текст', null)

on conflict do nothing;

-- ---------------------------------------------------------------------
--  Yetishmayotgan uz-cyrl tarjimalari (ikkitasi bor edi)
-- ---------------------------------------------------------------------
insert into public.translations (scope, key, lang, text, school_id)
select 'bot', t.key, 'uz-cyrl', t.text, null
  from public.translations t
 where t.scope = 'bot' and t.lang = 'uz' and t.school_id is null
   and not exists (
     select 1 from public.translations c
      where c.scope = 'bot' and c.key = t.key
        and c.lang = 'uz-cyrl' and c.school_id is null)
on conflict do nothing;
