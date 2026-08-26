#!/usr/bin/env node
// =====================================================================
//  smoke-test.mjs — panel bajaradigan HAR BIR so'rovni haqiqiy
//  foydalanuvchi tokeni bilan tekshiradi.
//
//  NEGA KERAK: `npm run build` faqat TypeScript xatolarini topadi.
//  Noto'g'ri ustun nomi, yo'q bog'lanish yoki RLS to'sig'i faqat
//  ISHLASH PAYTIDA chiqadi — foydalanuvchi sahifani ochganda.
//  Bu skript shularni oldindan topadi.
//
//  Ishga tushirish:
//    node scripts/smoke-test.mjs <email> <parol>
//    node scripts/smoke-test.mjs <email>            # parolsiz
//
//  PAROLSIZ REJIM: parol berilmasa skript `.env.local` dagi
//  service_role kaliti bilan bir martalik sehrli havola yaratadi va
//  uni tokenga almashtiradi. Foydalanuvchining paroli O'ZGARMAYDI —
//  shu tufayli sinovni ishga tushirish uchun parolni hech kimdan
//  so'rash yoki faylda saqlash kerak emas.
// =====================================================================

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function loadEnv() {
  for (const file of ['.env.local', 'apps/maktab-panel/.env.production']) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const text = await readFile(path, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}
await loadEnv();

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const [email, password] = process.argv.slice(2);
if (!email) {
  console.error('\nFoydalanish: node scripts/smoke-test.mjs <email> [parol]\n');
  process.exit(1);
}

/** Parol bilan oddiy kirish. */
async function signInWithPassword() {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return res.json();
}

/**
 * Parolsiz kirish: service_role kaliti bilan bir martalik sehrli
 * havola yaratiladi va darhol tokenga almashtiriladi.
 *
 * Havola pochta orqali YUBORILMAYDI — `generate_link` faqat qaytaradi.
 * Foydalanuvchining paroliga tegilmaydi.
 */
async function signInAsAdmin() {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE) {
    return { error_description: '.env.local da SUPABASE_SERVICE_ROLE_KEY yo\'q' };
  }

  const linkRes = await fetch(`${URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const link = await linkRes.json();
  if (!link.email_otp) {
    return { error_description: link.msg ?? link.error ?? 'havola olinmadi' };
  }

  // `verify` bir martalik kodni (email_otp) va EMAILNI birga kutadi;
  // `hashed_token` esa GET havolasi uchun mo'ljallangan.
  const verifyRes = await fetch(`${URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email, token: link.email_otp }),
  });
  return verifyRes.json();
}

const auth = password ? await signInWithPassword() : await signInAsAdmin();
if (!auth.access_token) {
  console.error(`\nKirish muvaffaqiyatsiz: ${auth.error_description ?? auth.msg}\n`);
  process.exit(1);
}

const H = {
  apikey: KEY,
  Authorization: `Bearer ${auth.access_token}`,
  'Content-Type': 'application/json',
};

const today = new Date().toISOString().slice(0, 10);
const monthStart = today.slice(0, 8) + '01';

let pass = 0;
const failures = [];

/** REST so'rovi (SELECT). */
async function rest(label, path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: H });
  const text = await res.text();
  if (!res.ok) {
    failures.push({ label, detail: text.slice(0, 220) });
    console.log(`  ✗ ${label}`);
    return null;
  }
  const data = JSON.parse(text);
  pass++;
  console.log(`  ✓ ${label.padEnd(46)} ${Array.isArray(data) ? data.length : 1}`);
  return data;
}

/** RPC chaqiruvi. */
async function rpc(label, fn, body = {}) {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    failures.push({ label, detail: text.slice(0, 220) });
    console.log(`  ✗ ${label}`);
    return null;
  }
  pass++;
  const data = text ? JSON.parse(text) : null;
  console.log(`  ✓ ${label.padEnd(46)} ${Array.isArray(data) ? data.length : 'ok'}`);
  return data;
}

console.log(`\nSinov: ${email}\n`);

// =====================================================================
console.log('── Kirish va kontekst (AuthProvider) ──');
const me = await rest('profil + maktab',
  'app_users?select=id,school_id,role,full_name,email,phone,lang,all_branches,schools!inner(name,status)');
await rest('filiallar', 'branches?select=id,name,is_default&deleted_at=is.null&is_active=eq.true');
await rest('huquqlar', `role_permissions?select=permission,allowed,school_id&role=eq.${me?.[0]?.role ?? 'director'}`);

const branchId = (await rest('filial id', 'branches?select=id&limit=1'))?.[0]?.id;

// =====================================================================
console.log('\n── Boshqaruv paneli ──');
await rpc('report_pnl', 'report_pnl', { p_from: monthStart, p_to: today });
await rpc('report_debts', 'report_debts', {});
await rest('faol o\'quvchilar soni', 'students?select=id&status=eq.active&deleted_at=is.null');
await rpc('pending_absence_warnings', 'pending_absence_warnings', { p_days_back: 14 });
await rest('kutayotgan cheklar', 'payment_proofs?select=id&status=eq.pending');

// =====================================================================
console.log('\n── O\'quvchilar ──');
const balances = await rest('balanslar ko\'rinishi',
  'v_student_balances?select=student_id,branch_id,full_name,class_name,payment_code,status,charged,paid,balance');
const studentId = balances?.[0]?.student_id;

if (studentId) {
  console.log('\n── O\'quvchi kartochkasi ──');
  await rest('o\'quvchi + filial', `students?select=*,branches(name)&id=eq.${studentId}`);
  await rest('balans', `v_student_balances?select=*&student_id=eq.${studentId}`);
  await rest('shartnoma + chegirma',
    `contracts?select=*,discount_types(name,kind,value)&student_id=eq.${studentId}&is_active=eq.true`);
  await rest('ota-onalar',
    `student_parents?select=relation,is_primary,parents(id,full_name,phone,telegram_id,lang)&student_id=eq.${studentId}`);
  await rest('xizmatlar',
    `student_services?select=id,starts_on,ends_on,services(id,name,billing_type)&student_id=eq.${studentId}`);
  await rest('hisoblanmalar',
    `v_invoice_totals?select=invoice_id,period,total,status,due_date,has_preliminary&student_id=eq.${studentId}`);
  await rest('to\'lovlar',
    `payments?select=id,amount,channel,status,paid_on,note&student_id=eq.${studentId}`);
}

// =====================================================================
console.log('\n── Xizmatlar ──');
await rest('xizmatlar + narx tarixi',
  'services?select=id,code,name,billing_type,is_active,branch_id,branches(name),service_prices(price,valid_from,valid_to)&deleted_at=is.null');
await rest('yozilishlar', 'student_services?select=service_id,ends_on');

// =====================================================================
console.log('\n── Yo\'qlik ──');
if (branchId) {
  await rest('kunlik xizmat ro\'yxati',
    `student_services?select=student_id,starts_on,ends_on,services!inner(id,name,billing_type,branch_id,is_active),students!inner(id,full_name,class_name,branch_id,status,deleted_at)&services.billing_type=eq.daily&services.is_active=eq.true&students.branch_id=eq.${branchId}&students.status=eq.active`);
  await rest('yo\'qlik sabablari', 'absence_reasons?select=id,code,name,deducts&is_active=eq.true');
  await rest('yo\'qliklar', `absences?select=id,student_id,reason_id&branch_id=eq.${branchId}&day=eq.${today}`);
  await rest('kun tasdiqlari',
    `attendance_checks?select=class_name,marked_at,absent_count&branch_id=eq.${branchId}&day=eq.${today}`);
}

// =====================================================================
console.log('\n── Hisoblanma ──');
if (branchId) {
  await rest('davr hisoblanmalari',
    `v_invoice_totals?select=invoice_id,student_id,branch_id,period,status,due_date,total,has_preliminary&branch_id=eq.${branchId}&period=eq.${monthStart}`);
}

// =====================================================================
console.log('\n── To\'lovlar ──');
await rest('to\'lovlar + kvitansiya',
  `payments?select=id,amount,channel,status,paid_on,note,student_id,students(full_name,class_name,payment_code),cash_receipts(receipt_code)&paid_on=gte.${monthStart}`);
await rest('cheklar',
  'payment_proofs?select=id,student_id,amount_claimed,status,submitted_at,file_path,reject_reason,students(full_name,class_name,payment_code)');
await rest('vypiskalar',
  'bank_statements?select=id,file_name,uploaded_at,rows_total,rows_matched,processed_at');
await rest('biriktirilmagan qatorlar',
  'bank_statement_rows?select=id,paid_on,amount,payer_name,purpose,payment_code,doc_no&student_id=is.null');

// =====================================================================
console.log('\n── Qarzdorlik ──');
await rpc('report_advances', 'report_advances', {});

// =====================================================================
console.log('\n── Xarajatlar ──');
await rest('kategoriyalar',
  'expense_categories?select=id,code,name,is_system,is_active&is_active=eq.true');
await rest('xarajatlar',
  `expenses?select=id,amount,spent_on,payment_method,note,payroll_run_id,category_id,branch_id,expense_categories(name,code),branches(name)&deleted_at=is.null&spent_on=gte.${monthStart}`);
await rpc('report_expenses', 'report_expenses', { p_from: monthStart, p_to: today });

// =====================================================================
console.log('\n── O\'qituvchilar va oylik ──');
await rest('o\'qituvchilar + filiallar',
  'teachers?select=id,full_name,phone,category,rate_factor,base_salary,weekly_hours,is_active,user_id,teacher_branches(branch_id,load_share,branches(name))&deleted_at=is.null');
await rest('darslar', `lessons?select=teacher_id,hours,kind&day=gte.${monthStart}`);
await rpc('report_payroll', 'report_payroll', { p_period: monthStart });
await rest('oylik sozlamalari',
  'payroll_settings?select=id,key,value,effective_from');
const run = await rest('oylik hisoblari',
  'payroll_runs?select=id,period,status,period_from,period_to,approved_at&limit=1');
if (run?.[0]?.id) {
  await rest('oylik qatorlari',
    `payroll_lines?select=*,branches(name)&payroll_run_id=eq.${run[0].id}`);
  await rest('oylik hisobi + o\'qituvchi',
    `payroll_runs?select=*,teachers(full_name,category,rate_factor)&id=eq.${run[0].id}`);
}

// =====================================================================
console.log('\n── Hisobotlar ──');
await rpc('report_revenue_mix', 'report_revenue_mix', { p_from: monthStart, p_to: today });
await rpc('report_enrollment', 'report_enrollment', { p_from: monthStart, p_to: today });
await rpc('report_cash', 'report_cash', { p_from: monthStart, p_to: today });
await rpc('report_service_usage', 'report_service_usage', { p_from: monthStart, p_to: today });
await rpc('report_invoice_status', 'report_invoice_status', { p_period: monthStart });

// =====================================================================
console.log('\n── Murojaatlar ──');
await rest('murojaatlar',
  'leads?select=id,full_name,phone,target_class,source,status,next_contact_on,note,student_id,created_at,branch_id');

// =====================================================================
console.log('\n── Boshqaruv ──');
await rest('filiallar (to\'liq)',
  'branches?select=id,name,address,phone,manager_name,is_active,is_default&deleted_at=is.null');
await rest('foydalanuvchilar',
  'app_users?select=id,full_name,email,phone,role,is_active,all_branches,created_at,user_branches(branch_id,branches(name))&deleted_at=is.null');
await rest('audit jurnali',
  'audit_log?select=id,at,table_name,record_id,action,changed_keys,before,after,user_id,impersonated_by&limit=20');
await rest('maktab sozlamalari', 'school_settings?select=key,value,note');
await rest('chegirma turlari', 'discount_types?select=id,code,name,kind,value&is_active=eq.true');
await rest('xabar navbati', 'message_queue?select=id,template_key,status,attempts,last_error&limit=10');
await rest('kalendar', 'calendar_days?select=day,day_type,name&limit=10');

// =====================================================================
console.log('\n── Yangi funksiyalar ──');

await rest("o'qituvchi kartochkasi",
  'teachers?select=*,teacher_branches(branch_id,load_share,branches(name))&limit=1');
await rest("o'qituvchi ustamalari",
  'teacher_allowances?select=id,code,value_override,starts_on,ends_on,note');
await rest("o'qituvchi avanslari",
  'teacher_advances?select=id,period,amount,paid_on,note,branches(name)');
await rest('oylik jamlari (kartochka)',
  'v_payroll_totals?select=payroll_run_id,period,status,gross_total,deductions_total,net_total');
await rest('yopilgan davrlar',
  'closed_periods?select=id,period,branch_id,closed_at,closed_by,note,app_users(full_name)');
await rest("xabarlar jurnali (to'liq)",
  'message_queue?select=id,template_key,lang,status,attempts,last_error,scheduled_at,sent_at,created_at,chat_id,student_id,parent_id,students(full_name),parents(full_name,phone)&limit=20');
await rest('kalendar (oy kesimi)',
  'calendar_days?select=school_id,branch_id,day,day_type,name&limit=40');
await rest("chegirma turlari (to'liq)",
  'discount_types?select=id,code,name,kind,value,is_active');
await rest("yo'qlik sabablari (to'liq)",
  'absence_reasons?select=id,code,name,deducts,is_active,sort_order');
await rest('ustama katalogi',
  'payroll_settings?select=value&key=eq.allowances');

// =====================================================================
console.log('\n── Sinflar (yangi bo\'lim) ──');
const classes = await rest('sinflar ro\'yxati',
  'classes?select=id,capacity,academic_year,is_active,teacher_id,note&deleted_at=is.null');
await rpc('report_by_class', 'report_by_class', { p_from: monthStart, p_to: today });
const classId = classes?.[0]?.id;
if (classId) {
  await rest('sinf kartochkasi',
    `classes?select=id,name,grade_level,capacity,academic_year,is_active,note,branch_id,teacher_id,branches(name),teachers(id,full_name,phone)&id=eq.${classId}`);
  await rest('sinf o\'quvchilari',
    `students?select=id,full_name,payment_code,status,birth_date,enrolled_on&class_id=eq.${classId}&deleted_at=is.null`);
}

// =====================================================================
console.log('\n── Moliyaviy jamlanma ──');
await rpc('report_financial_summary', 'report_financial_summary',
  { p_from: monthStart, p_to: today });
await rpc('report_monthly_trend', 'report_monthly_trend', { p_months: 12 });
await rpc('report_expense_detail', 'report_expense_detail',
  { p_from: monthStart, p_to: today });

// =====================================================================
console.log('\n── To\'lovlar va cheklar (kengaytirilgan) ──');
await rest('to\'lovlar + kvitansiya + filial',
  `payments?select=id,amount,channel,status,paid_on,note,student_id,branch_id,created_at,students(full_name,class_name,payment_code),cash_receipts(receipt_code,cancelled_at),branches(name)&paid_on=gte.${monthStart}&paid_on=lte.${today}`);
await rest('cheklar (barcha holat)',
  'payment_proofs?select=id,student_id,amount_claimed,status,submitted_at,reviewed_at,file_path,reject_reason,payment_id,students(full_name,class_name,payment_code)&limit=20');

// =====================================================================
if (studentId) {
  console.log('\n── O\'quvchi kartochkasi (kengaytirilgan) ──');
  await rest('o\'quvchi + sinf',
    `students?select=*,branches(name),classes(id,name,academic_year)&id=eq.${studentId}`);
  await rest('to\'lov tarixi + kvitansiya',
    `payments?select=id,amount,channel,status,paid_on,note,created_at,branch_id,cash_receipts(receipt_code)&student_id=eq.${studentId}`);
  await rest('yuborilgan cheklar',
    `payment_proofs?select=id,amount_claimed,status,submitted_at,file_path,reject_reason&student_id=eq.${studentId}`);
  await rpc('student_history', 'student_history',
    { p_student_id: studentId, p_limit: 50 });
}

// =====================================================================
console.log('\n── Global qidiruv (Ctrl+K) ──');
await rest('qidiruv — o\'quvchi',
  'students?select=id,full_name,class_name,payment_code,status&deleted_at=is.null&or=(full_name.ilike.*a*,payment_code.ilike.*a*)&limit=8');
await rest('qidiruv — sinf',
  'classes?select=id,name,academic_year&deleted_at=is.null&name=ilike.*5*&limit=5');
await rest('qidiruv — o\'qituvchi',
  'teachers?select=id,full_name,phone,category&deleted_at=is.null&full_name=ilike.*a*&limit=5');
await rest('qidiruv — kvitansiya',
  'cash_receipts?select=receipt_code,payment_id,issued_at,payments(student_id,amount,students(full_name))&receipt_code=ilike.*1*&limit=5');

// =====================================================================
console.log('\n── Narx tarixi va hisoblanma qatorlari ──');
const svcId = (await rest('xizmat id', 'services?select=id&limit=1'))?.[0]?.id;
if (svcId) {
  await rest('narx tarixi',
    `service_prices?select=id,price,valid_from,valid_to,created_at&service_id=eq.${svcId}`);
}
const invId = (await rest('hisoblanma id', 'invoices?select=id&limit=1'))?.[0]?.id;
if (invId) {
  await rest('hisoblanma qatorlari',
    `invoice_lines?select=id,kind,description,quantity,unit_price,amount&invoice_id=eq.${invId}`);
}

// =====================================================================
console.log('\n── Ma\'lumotnoma ro\'yxatlari ──');
await rest('murojaat manbalari',
  'lookups?select=id,name,sort_order&kind=eq.lead_source&is_active=eq.true&deleted_at=is.null');
await rest("o'qituvchi toifalari",
  'lookups?select=id,name,sort_order&kind=eq.teacher_category&is_active=eq.true&deleted_at=is.null');
await rest('sinf tanlagich',
  'classes?select=id,name,grade_level,academic_year,capacity,branch_id&is_active=eq.true&deleted_at=is.null');

// =====================================================================
console.log('\n── To\'lov usullari va oylik sozlamasi ──');
await rest("to'lov usullari",
  'payment_methods?select=id,code,name,is_cash,sort_order&is_active=eq.true&deleted_at=is.null&order=sort_order');
await rpc('report_payment_methods', 'report_payment_methods',
  { p_from: monthStart, p_to: today });
await rest('usul biriktirilgan to\'lov',
  'payments?select=id,amount,channel,payment_methods(name,is_cash)&method_id=not.is.null&limit=5');
await rest('usul biriktirilgan xarajat',
  'expenses?select=id,amount,payment_method,payment_methods(name,is_cash)&method_id=not.is.null&deleted_at=is.null&limit=5');
await rpc('payroll_config_issues', 'payroll_config_issues', {});

// =====================================================================
console.log('\n' + '─'.repeat(64));
if (failures.length === 0) {
  console.log(`  ✓ BARCHA ${pass} TA SO'ROV ISHLADI`);
} else {
  console.log(`  ${pass} ta ishladi, ${failures.length} tasi YIQILDI:\n`);
  for (const f of failures) {
    console.log(`  ✗ ${f.label}`);
    console.log(`    ${f.detail}\n`);
  }
}
console.log('─'.repeat(64) + '\n');

process.exit(failures.length ? 1 : 0);
