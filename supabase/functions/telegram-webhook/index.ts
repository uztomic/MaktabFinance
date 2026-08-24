// =====================================================================
//  telegram-webhook — ota-onalar uchun bot (TZ 4.9)
//
//  XAVFSIZLIK UCH QATLAMI:
//    1. `X-Telegram-Bot-Api-Secret-Token` har bir so'rovda tekshiriladi
//       (TZ 5.4.17). Bu bo'lmasa istalgan kishi webhook manzilini topib
//       soxta "update" yuborishi mumkin edi.
//    2. `update_id` deduplikatsiyasi (TZ 5.4.18). Telegram javob olmasa
//       o'sha update ni QAYTA yuboradi — bunsiz bitta chek ikki marta
//       qayd etilardi.
//    3. Ota-ona doirasi — `_shared/parent-scope.ts` (TZ 5.4.15, 5.4.16).
//       O'quvchi identifikatori HECH QACHON xabar yoki tugma
//       ma'lumotidan to'g'ridan-to'g'ri ishonib olinmaydi.
//
//  TZ 5.4.14 — bu funksiya `service_role` bilan ishlaydi va RLS uni
//  to'xtatmaydi. Shuning uchun yuqoridagi uchinchi qatlam MAJBURIY.
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { SERVICE_ROLE_KEY, SUPABASE_URL } from '../_shared/http.ts';
import {
  answerCallback,
  downloadFile,
  keyboard,
  pickPhotoSize,
  sendMessage,
  tg,
} from '../_shared/telegram.ts';
import {
  linkParentByPhone,
  money,
  type ParentScope,
  resolveParentScope,
  translate,
} from '../_shared/parent-scope.ts';

const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------
//  Yordamchilar
// ---------------------------------------------------------------------

const t = (key: string, lang: string, school: string | null = null,
           params: Record<string, string | number> = {}) =>
  translate(db, key, lang, school, params);

/** Sessiya holatini saqlaydi (ko'p bosqichli oqimlar uchun). */
async function setState(
  chatId: number,
  state: string,
  context: Record<string, unknown> = {},
  lang?: string,
) {
  await db.from('telegram_sessions').upsert({
    chat_id: chatId,
    state,
    context,
    ...(lang ? { lang } : {}),
    updated_at: new Date().toISOString(),
  });
}

async function getSession(chatId: number) {
  const { data } = await db
    .from('telegram_sessions')
    .select('chat_id, state, context, lang, parent_id')
    .eq('chat_id', chatId)
    .maybeSingle();
  return data;
}

/** Ro'yxatdan o'tmagan foydalanuvchiga telefon so'raladi. */
async function askPhone(chatId: number, lang: string) {
  const text = await t('start_welcome', lang);
  const button = await t('share_phone', lang);
  await sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [[{ text: button, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// ---------------------------------------------------------------------
//  ASOSIY MENYU
//
//  Bir farzand bo'lsa — to'g'ridan-to'g'ri uning kartochkasi.
//  Bir nechta bo'lsa — tanlash ro'yxati (TZ 4.9.2).
// ---------------------------------------------------------------------

async function showMenu(chatId: number, scope: ParentScope, messageId?: number) {
  const lang = scope.lang;

  if (scope.students.length === 0) {
    await sendMessage(chatId, await t('not_registered', lang));
    return;
  }

  if (scope.students.length === 1) {
    await showStudent(chatId, scope, scope.students[0].id, messageId);
    return;
  }

  const rows = scope.students.map((s) => [{
    text: `${s.full_name}${s.class_name ? ` · ${s.class_name}` : ''}`,
    data: `st:${s.id}`,
  }]);
  rows.push([{ text: await t('menu_lang', lang), data: 'lang' }]);

  const text = await t('choose_child', lang);
  if (messageId) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: messageId, text,
      reply_markup: keyboard(rows),
    });
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard(rows) });
  }
}

/** Bitta o'quvchining kartochkasi va amallari. */
async function showStudent(
  chatId: number,
  scope: ParentScope,
  studentId: string,
  messageId?: number,
) {
  // ⚠️ TZ 5.4.15 — identifikator tugmadan keldi, ISHONMAYMIZ.
  const student = scope.student(studentId);
  if (!student) {
    await sendMessage(chatId, await t('error_generic', scope.lang));
    return;
  }

  const lang = scope.lang;
  const { data: bal } = await db
    .from('v_student_balances')
    .select('balance, charged, paid')
    .eq('student_id', student.id)
    .maybeSingle();

  const balance = Number(bal?.balance ?? 0);
  const head = `👤 *${student.full_name}*` +
    (student.class_name ? `\n🏫 ${student.class_name}` : '') +
    `\n🔑 \`${student.payment_code}\`\n` +
    (balance > 0
      ? `\n💰 Qarzdorlik: *${money(balance)}*`
      : balance < 0
      ? `\n💚 Avans: *${money(-balance)}*`
      : `\n✅ Qarzdorlik yo'q`);

  const rows = [
    [
      { text: await t('menu_debt', lang), data: `debt:${student.id}` },
      { text: await t('menu_invoice', lang), data: `inv:${student.id}` },
    ],
    [
      { text: await t('menu_history', lang), data: `hist:${student.id}` },
      { text: await t('menu_proof', lang), data: `proof:${student.id}` },
    ],
  ];
  if (scope.students.length > 1) {
    rows.push([{ text: '⬅️', data: 'menu' }]);
  }
  rows.push([{ text: await t('menu_lang', lang), data: 'lang' }]);

  if (messageId) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: messageId, text: head,
      parse_mode: 'Markdown', reply_markup: keyboard(rows),
    });
  } else {
    await sendMessage(chatId, head, { reply_markup: keyboard(rows) });
  }
}

// ---------------------------------------------------------------------
//  QARZDORLIK
// ---------------------------------------------------------------------

async function showDebt(chatId: number, scope: ParentScope, studentId: string) {
  const student = scope.student(studentId);
  if (!student) return;

  const { data: bal } = await db
    .from('v_student_balances')
    .select('balance, charged, paid, overdue_charged, oldest_unpaid_due')
    .eq('student_id', student.id)
    .maybeSingle();

  const balance = Number(bal?.balance ?? 0);

  if (balance <= 0) {
    await sendMessage(
      chatId,
      await t('no_debt', scope.lang, student.school_id, {
        student: student.full_name,
      }),
    );
    return;
  }

  const lines = [
    `👤 *${student.full_name}*`,
    ``,
    `Jami hisoblangan: ${money(bal?.charged ?? 0)}`,
    `To'langan: ${money(bal?.paid ?? 0)}`,
    `━━━━━━━━━━━━━━━━━━`,
    `*Qarzdorlik: ${money(balance)}*`,
  ];
  if (bal?.oldest_unpaid_due) {
    lines.push(``, `⚠️ Eng eski muddat: ${bal.oldest_unpaid_due}`);
  }
  lines.push(``, `To'lov kodi: \`${student.payment_code}\``);

  await sendMessage(chatId, lines.join('\n'), {
    reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]),
  });
}

// ---------------------------------------------------------------------
//  HISOBLANMA TARKIBI (TZ 4.6.2 — qatorlar bilan)
// ---------------------------------------------------------------------

async function showInvoice(chatId: number, scope: ParentScope, studentId: string) {
  const student = scope.student(studentId);
  if (!student) return;

  const { data: inv } = await db
    .from('v_invoice_totals')
    .select('invoice_id, period, total, status, due_date, has_preliminary')
    .eq('student_id', student.id)
    .neq('status', 'cancelled')
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!inv) {
    await sendMessage(chatId, 'Hozircha hisoblanma yo\'q.', {
      reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]),
    });
    return;
  }

  const { data: lines } = await db
    .from('invoice_lines')
    .select('description, quantity, unit_price, amount, kind, is_preliminary')
    .eq('invoice_id', inv.invoice_id)
    .order('sort_order');

  const period = String(inv.period).slice(0, 7).split('-').reverse().join('.');
  const out = [`📄 *${period}* hisoblanmasi`, ''];

  for (const l of lines ?? []) {
    const qty = Number(l.quantity);
    // TZ 4.6.4 — kunlik xizmatda miqdor va birlik narxi ko'rsatiladi.
    const detail = qty > 1
      ? ` (${qty} × ${money(l.unit_price)})`
      : '';
    out.push(`${l.description}${detail}\n   ${money(l.amount)}`);
  }

  out.push('', '━━━━━━━━━━━━━━━━━━', `*JAMI: ${money(inv.total)}*`);
  out.push('', `To'lov muddati: ${inv.due_date}`);
  out.push(`To'lov kodi: \`${student.payment_code}\``);

  if (inv.has_preliminary) {
    // TZ 4.6.1.1 — dastlabki va yakuniy summa aniq ajratiladi.
    out.push('', '_⚠️ Kunlik xizmatlar DASTLABKI summada. Oy oxirida haqiqiy kunlar bo\'yicha qayta hisoblanadi._');
  }

  await sendMessage(chatId, out.join('\n'), {
    reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]),
  });
}

// ---------------------------------------------------------------------
//  TO'LOV TARIXI
// ---------------------------------------------------------------------

async function showHistory(chatId: number, scope: ParentScope, studentId: string) {
  const student = scope.student(studentId);
  if (!student) return;

  const { data: pays } = await db
    .from('payments')
    .select('amount, paid_on, channel, status')
    .eq('student_id', student.id)
    .in('status', ['confirmed', 'pending'])
    .order('paid_on', { ascending: false })
    .limit(15);

  if (!pays?.length) {
    await sendMessage(chatId, 'To\'lov tarixi bo\'sh.', {
      reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]),
    });
    return;
  }

  const icon: Record<string, string> = {
    cash: '💵', bank: '🏦', proof: '📸',
  };

  const out = [`🧾 *To'lov tarixi*`, ''];
  for (const p of pays) {
    const mark = p.status === 'pending' ? ' ⏳' : '';
    out.push(`${icon[p.channel] ?? '•'} ${p.paid_on} — ${money(p.amount)}${mark}`);
  }
  if (pays.some((p) => p.status === 'pending')) {
    out.push('', '_⏳ — tasdiqlanmagan (qarzdorlikni yopmaydi)_');
  }

  await sendMessage(chatId, out.join('\n'), {
    reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]),
  });
}

// ---------------------------------------------------------------------
//  CHEK YUBORISH (TZ 4.7.3)
// ---------------------------------------------------------------------

async function askProof(chatId: number, scope: ParentScope, studentId: string) {
  const student = scope.student(studentId);
  if (!student) return;

  await setState(chatId, 'awaiting_proof', { student_id: student.id }, scope.lang);
  await sendMessage(chatId, await t('ask_proof_photo', scope.lang));
}

async function handlePhoto(
  chatId: number,
  scope: ParentScope,
  // deno-lint-ignore no-explicit-any
  photos: any[],
) {
  const session = await getSession(chatId);
  if (session?.state !== 'awaiting_proof') {
    await sendMessage(chatId, await t('ask_proof_photo', scope.lang));
    return;
  }

  // ⚠️ Sessiyadagi identifikatorga ham ISHONMAYMIZ — doiradan
  // qaytadan tekshiramiz (TZ 5.4.15).
  const studentId = (session.context as { student_id?: string })?.student_id;
  const student = scope.student(studentId);
  if (!student) {
    await setState(chatId, 'idle', {});
    await sendMessage(chatId, await t('error_generic', scope.lang));
    return;
  }

  // TZ 4.7.4.1 — eng katta tomoni ~1600 px bo'lgan o'lcham tanlanadi.
  // Telegram rasmni allaqachon siqib beradi, shuning uchun qo'shimcha
  // qayta kodlash shart emas (odatda 100–250 KB chiqadi).
  const size = pickPhotoSize(photos);
  if (!size) return;

  const file = await downloadFile(size.file_id);
  if (!file) {
    await sendMessage(chatId, await t('error_generic', scope.lang));
    return;
  }

  const now = new Date();
  const path = [
    student.school_id,
    student.branch_id,
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    `${crypto.randomUUID()}.jpg`,
  ].join('/');

  const { error: upErr } = await db.storage
    .from('receipts')
    .upload(path, file.bytes, { contentType: 'image/jpeg', upsert: false });

  if (upErr) {
    console.error('receipt upload failed', upErr);
    await sendMessage(chatId, await t('error_generic', scope.lang));
    return;
  }

  const parent = scope.parents.find((p) => p.school_id === student.school_id);

  const { error: rpcErr } = await db.rpc('submit_payment_proof', {
    p_student_id: student.id,
    p_parent_id: parent?.id ?? null,
    p_file_path: path,
    p_telegram_file_id: size.file_id,
    p_amount: null,
  });

  if (rpcErr) {
    console.error('submit_payment_proof failed', rpcErr);
    await sendMessage(chatId, await t('error_generic', scope.lang));
    return;
  }

  await setState(chatId, 'idle', {});
  // TZ 4.7.3.3 — ota-onaga DARHOL javob yuboriladi.
  await sendMessage(
    chatId,
    await t('proof_received', scope.lang, student.school_id),
    { reply_markup: keyboard([[{ text: '⬅️', data: `st:${student.id}` }]]) },
  );
}

// ---------------------------------------------------------------------
//  TIL (TZ 5.6.2)
// ---------------------------------------------------------------------

async function showLanguages(chatId: number, lang: string, messageId?: number) {
  const rows = [[
    { text: "O'zbek", data: 'setlang:uz' },
    { text: 'Ўзбек', data: 'setlang:uz-cyrl' },
    { text: 'Русский', data: 'setlang:ru' },
  ]];
  const text = await t('menu_lang', lang);
  if (messageId) {
    await tg('editMessageText', {
      chat_id: chatId, message_id: messageId, text,
      reply_markup: keyboard(rows),
    });
  } else {
    await sendMessage(chatId, text, { reply_markup: keyboard(rows) });
  }
}

async function setLanguage(chatId: number, scope: ParentScope, lang: string) {
  await db.from('parents')
    .update({ lang })
    .in('id', scope.parents.map((p) => p.id));
  await db.from('telegram_sessions')
    .upsert({ chat_id: chatId, lang, state: 'idle', context: {} });

  await sendMessage(chatId, await t('lang_changed', lang));

  const fresh = await resolveParentScope(db, chatId);
  if (fresh) await showMenu(chatId, fresh);
}

// =====================================================================
//  ASOSIY ISHLOVCHI
// =====================================================================

Deno.serve(async (req) => {
  // --- 1-QATLAM: maxfiy token (TZ 5.4.17) --------------------------
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!WEBHOOK_SECRET || secret !== WEBHOOK_SECRET) {
    // Telegram ga 401 qaytarmaymiz — u qayta urinaveradi. 200 va
    // bo'sh javob soxta so'rovni jimgina rad etadi.
    console.warn('Webhook: maxfiy token mos kelmadi');
    return new Response('ok', { status: 200 });
  }

  // deno-lint-ignore no-explicit-any
  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response('ok', { status: 200 });
  }

  // --- 2-QATLAM: deduplikatsiya (TZ 5.4.18) ------------------------
  const updateId = update?.update_id;
  if (typeof updateId === 'number') {
    const chatId = update.message?.chat?.id ??
      update.callback_query?.message?.chat?.id ?? null;

    const { error } = await db
      .from('telegram_updates')
      .insert({ update_id: updateId, chat_id: chatId });

    if (error) {
      // Takroriy update — Telegram qayta yubordi. Jimgina qaytamiz.
      return new Response('ok', { status: 200 });
    }
  }

  try {
    await route(update);
  } catch (err) {
    console.error('webhook xatosi', err);
  }

  // Telegram har doim 200 kutadi — aks holda update ni qayta yuboradi.
  return new Response('ok', { status: 200 });
});

// deno-lint-ignore no-explicit-any
async function route(update: any) {
  const msg = update.message;
  const cb = update.callback_query;
  const chatId: number | undefined = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (!chatId) return;

  const session = await getSession(chatId);
  const fallbackLang = session?.lang ?? 'uz';

  // --- 3-QATLAM: ota-ona doirasi (TZ 5.4.15, 5.4.16) ---------------
  let scope = await resolveParentScope(db, chatId);

  // --- Telefon yuborildi → bog'lash (TZ 4.9.1) ---------------------
  if (msg?.contact) {
    // Faqat O'ZINING kontaktini qabul qilamiz: boshqaning raqamini
    // yuborib begona ma'lumot ochib olishning oldi olinadi.
    if (msg.contact.user_id && msg.contact.user_id !== msg.from?.id) {
      await sendMessage(chatId, await t('not_registered', fallbackLang));
      return;
    }

    const linked = await linkParentByPhone(db, chatId, msg.contact.phone_number);
    if (linked === 0) {
      await sendMessage(chatId, await t('not_registered', fallbackLang), {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    scope = await resolveParentScope(db, chatId);
    if (!scope) return;

    await db.from('telegram_sessions').upsert({
      chat_id: chatId, state: 'idle', context: {},
      parent_id: scope.parents[0]?.id ?? null, lang: scope.lang,
    });

    await sendMessage(
      chatId,
      await t('linked_ok', scope.lang, null, { children: scope.students.length }),
      { reply_markup: { remove_keyboard: true } },
    );
    await showMenu(chatId, scope);
    return;
  }

  // --- Ro'yxatdan o'tmagan --------------------------------------------
  if (!scope) {
    await askPhone(chatId, fallbackLang);
    return;
  }

  // --- Rasm (chek) ------------------------------------------------------
  if (msg?.photo?.length) {
    await handlePhoto(chatId, scope, msg.photo);
    return;
  }

  // --- Matn buyruqlari --------------------------------------------------
  if (msg?.text) {
    const text = String(msg.text).trim();
    if (text === '/start' || text === '/menu') {
      await showMenu(chatId, scope);
    } else if (text === '/til' || text === '/lang') {
      await showLanguages(chatId, scope.lang);
    } else {
      await showMenu(chatId, scope);
    }
    return;
  }

  // --- Tugmalar ---------------------------------------------------------
  if (cb) {
    const data = String(cb.data ?? '');
    const messageId = cb.message?.message_id;
    await answerCallback(cb.id);

    const [action, arg] = data.split(':');

    switch (action) {
      case 'menu':
        await showMenu(chatId, scope, messageId);
        break;
      case 'st':
        await showStudent(chatId, scope, arg, messageId);
        break;
      case 'debt':
        await showDebt(chatId, scope, arg);
        break;
      case 'inv':
        await showInvoice(chatId, scope, arg);
        break;
      case 'hist':
        await showHistory(chatId, scope, arg);
        break;
      case 'proof':
        await askProof(chatId, scope, arg);
        break;
      case 'lang':
        await showLanguages(chatId, scope.lang, messageId);
        break;
      case 'setlang':
        if (['uz', 'uz-cyrl', 'ru'].includes(arg)) {
          await setLanguage(chatId, scope, arg);
        }
        break;
      default:
        await showMenu(chatId, scope, messageId);
    }
  }
}
