// =====================================================================
//  school-user-ops — maktab xodimlarining hisoblarini boshqarish.
//
//  NEGA EDGE FUNCTION: Auth hisobini yaratish `service_role` kalitini
//  talab qiladi. U brauzerga HECH QACHON berilmaydi. Shuning uchun
//  amal serverda bajariladi.
//
//  XAVFSIZLIK NAQSHI (Uztomic loyihasidagi `guard.ts` dan olingan):
//    1. Chaqiruvchi ANON kalit bilan aniqlanadi — token soxta bo'lsa
//       hech narsa ochilmaydi.
//    2. Uning `users.manage` huquqi BAZADAN tekshiriladi (RLS ostida,
//       ya'ni faqat o'z maktabi doirasida).
//    3. FAQAT SHUNDAN KEYIN service_role mijozi yaratiladi.
//    4. Yangi hisob HAR DOIM chaqiruvchining maktabiga biriktiriladi —
//       so'rovdagi school_id ga ISHONILMAYDI (boshqa maktabga xodim
//       qo'shib bo'lmasin).
// =====================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  ANON_KEY,
  CORS_HEADERS,
  fail,
  json,
  preflight,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
} from '../_shared/http.ts';

type Role = 'director' | 'accountant' | 'manager' | 'duty' | 'teacher';
const ROLES: Role[] = ['director', 'accountant', 'manager', 'duty', 'teacher'];

interface CreatePayload {
  action: 'create';
  full_name: string;
  login: string;
  role: Role;
  all_branches?: boolean;
  branch_ids?: string[];
  password?: string;
}

interface ResetPayload {
  action: 'reset_password';
  user_id: string;
  password?: string;
}

type Payload = CreatePayload | ResetPayload;

/** Telefon raqamni sintetik pochtaga aylantiradi (panel bilan bir xil). */
function phoneToEmail(raw: string): string {
  return `${raw.replace(/\D/g, '')}@maktab.local`;
}

function looksLikePhone(v: string): boolean {
  return !v.includes('@') && v.replace(/\D/g, '').length >= 9;
}

/** Chalkashtiruvchi belgilarsiz (0/O/1/I) o'qish oson parol. */
function generatePassword(length = 10): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return fail('Faqat POST', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return fail('Avtorizatsiya sarlavhasi yo\'q', 401);
  }

  // --- 1-qadam: chaqiruvchini ANON kalit bilan aniqlaymiz ----------
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return fail('Token yaroqsiz', 401);

  // --- 2-qadam: profil va huquq — BAZADAN, RLS ostida --------------
  const { data: me, error: meErr } = await caller
    .from('app_users')
    .select('id, school_id, role, is_active')
    .eq('id', userData.user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (meErr || !me || !me.is_active) {
    return fail('Profil topilmadi yoki bloklangan', 403);
  }

  // Huquq matritsasi bazadan o'qiladi (TZ 3.1) — kodda emas.
  const { data: perm } = await caller
    .from('role_permissions')
    .select('permission, allowed, school_id')
    .eq('role', me.role)
    .eq('permission', 'users.manage');

  //  Shaxsiy o'zgartirish rol ustiga qo'yiladi — bazadagi `app.can`
  //  ham aynan shu tartibda ishlaydi. Uchala joy (baza, panel va shu
  //  funksiya) bir xil javob berishi SHART: aks holda panelda tugma
  //  ko'rinadi-yu, funksiya rad etadi.
  const { data: own } = await caller
    .from('user_permissions')
    .select('allowed')
    .eq('user_id', me.id)
    .eq('permission', 'users.manage')
    .maybeSingle();

  const allowed = (() => {
    if (own) return own.allowed;
    const rows = perm ?? [];
    const school = rows.find((r) => r.school_id === me.school_id);
    if (school) return school.allowed;
    const global = rows.find((r) => r.school_id === null);
    return global?.allowed ?? false;
  })();

  if (!allowed) {
    return fail('Ruxsat yo\'q: foydalanuvchi qo\'shish', 403);
  }

  // Maktab cheklash rejimidami (TZ 4.13.4)?
  const { data: school } = await caller
    .from('schools')
    .select('status')
    .eq('id', me.school_id)
    .maybeSingle();

  if (school && !['active', 'trial'].includes(school.status)) {
    return fail('Maktab cheklash rejimida — yangi yozuv kiritib bo\'lmaydi', 403);
  }

  // --- 3-qadam: endi kuchli mijozni beramiz ------------------------
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return fail('JSON o\'qib bo\'lmadi');
  }

  // ===================================================================
  //  HISOB YARATISH
  // ===================================================================
  if (body.action === 'create') {
    const fullName = (body.full_name ?? '').trim();
    const login = (body.login ?? '').trim();

    if (!fullName) return fail('F.I.Sh. majburiy');
    if (!login) return fail('Login majburiy');
    if (!ROLES.includes(body.role)) return fail('Rol noto\'g\'ri');

    const isPhone = looksLikePhone(login);
    const email = isPhone ? phoneToEmail(login) : login.toLowerCase();
    const password = body.password && body.password.length >= 8
      ? body.password
      : generatePassword();

    // Auth hisobi
    const { data: created, error: cErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (cErr || !created?.user) {
      return fail(`Hisob yaratilmadi: ${cErr?.message ?? 'noma\'lum xato'}`, 400);
    }

    // Profil. school_id — CHAQIRUVCHINING maktabi, so'rovdan emas.
    const { error: pErr } = await db.from('app_users').insert({
      id: created.user.id,
      school_id: me.school_id,
      role: body.role,
      full_name: fullName,
      email: isPhone ? null : email,
      phone: isPhone ? login.replace(/\D/g, '') : null,
      all_branches: !!body.all_branches,
    });

    if (pErr) {
      // Profil yaratilmasa auth hisobi ham qolmasin — "yetim" hisob
      // keyinchalik chalkashlik keltiradi.
      await db.auth.admin.deleteUser(created.user.id);
      return fail(`Profil yaratilmadi: ${pErr.message}`, 400);
    }

    // Filiallar
    if (!body.all_branches && body.branch_ids?.length) {
      // Faqat CHAQIRUVCHINING maktabidagi filiallar.
      const { data: valid } = await db
        .from('branches')
        .select('id')
        .eq('school_id', me.school_id)
        .in('id', body.branch_ids);

      if (valid?.length) {
        await db.from('user_branches').insert(
          valid.map((b) => ({ user_id: created.user.id, branch_id: b.id })),
        );
      }
    }

    return json({
      user_id: created.user.id,
      login: isPhone ? login : email,
      password,
    });
  }

  // ===================================================================
  //  PAROLNI TIKLASH (TZ 4.13.3)
  // ===================================================================
  if (body.action === 'reset_password') {
    if (!body.user_id) return fail('user_id majburiy');

    // Faqat O'Z maktabidagi xodim.
    const { data: target } = await db
      .from('app_users')
      .select('id, school_id, full_name, email, phone')
      .eq('id', body.user_id)
      .maybeSingle();

    if (!target || target.school_id !== me.school_id) {
      return fail('Foydalanuvchi topilmadi', 404);
    }

    const password = body.password && body.password.length >= 8
      ? body.password
      : generatePassword();

    const { error } = await db.auth.admin.updateUserById(target.id, { password });
    if (error) return fail(`Parol o'zgartirilmadi: ${error.message}`, 400);

    return json({
      user_id: target.id,
      login: target.email ?? target.phone,
      password,
    });
  }

  return new Response(
    JSON.stringify({ error: 'Noma\'lum amal' }),
    { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
  );
});
