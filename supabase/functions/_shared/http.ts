// =====================================================================
//  http.ts — barcha Edge Function uchun umumiy HTTP yordamchilari.
// =====================================================================

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, '
    + 'x-supabase-api-version, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 *  Brauzer so'ragan sarlavhalarni QAYTARIB beramiz.
 *
 *  Ro'yxatni qo'lda yozib qo'yish mo'rt: supabase-js yangi versiyada
 *  yangi sarlavha qo'shsa, brauzer preflight ni rad etadi va ilovada
 *  "Failed to send a request to the Edge Function" degan foydasiz
 *  xato chiqadi — server esa hech narsa ko'rmaydi, chunki asosiy
 *  so'rov umuman yuborilmaydi.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;

  const asked = req.headers.get('Access-Control-Request-Headers');
  return new Response('ok', {
    headers: asked
      ? { ...CORS_HEADERS, 'Access-Control-Allow-Headers': asked }
      : CORS_HEADERS,
  });
}

/** Supabase platformasi bu uchtasini o'zi beradi — qo'lda sozlash shart emas. */
export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
export const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
