-- =====================================================================
--  19 — TUZATISH: app.jwt_claim() bo'sh qatorda yiqilardi
--
--  MUAMMO: funksiya `current_setting('request.jwt.claims', true)::jsonb`
--  qilardi. Agar sozlama BO'SH QATOR ('') bo'lsa — bu holat sessiya
--  konteksti tozalanganda yoki ba'zi ichki chaqiruvlarda yuz beradi —
--  cast "invalid input syntax for type json" xatosi bilan yiqilardi.
--
--  Bu jiddiy: `app.jwt_claim()` audit triggeridan chaqiriladi, ya'ni
--  xato HAR QANDAY yozuvni to'xtatib qo'yishi mumkin edi.
--
--  Sinovda aniqlandi: closed_periods ga yozuv audit triggerini ishga
--  tushirdi va u yiqildi.
--
--  YECHIM: bo'sh qatorni NULL ga aylantirib, keyin cast qilamiz.
--  `app.is_service_context()` da bu himoya allaqachon bor edi.
-- =====================================================================

create or replace function app.jwt_claim(p_key text)
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      -- nullif(...) — bo'sh qator jsonb ga cast qilinmaydi.
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> p_key,
      ''
    ), '');
$$;

comment on function app.jwt_claim(text) is
  'JWT dan bitta claim ni o''qiydi. Sozlama yo''q yoki bo''sh bo''lsa null '
  'qaytaradi — cast xatosi bermaydi (19-migratsiyada tuzatilgan).';

-- Tekshiruv: uchala holat ham xatosiz ishlashi kerak.
do $do$
begin
  perform set_config('request.jwt.claims', '', true);
  if app.jwt_claim('imp_admin') is not null then
    raise exception 'Bo''sh qator uchun null kutilgan edi';
  end if;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if app.jwt_claim('role') <> 'authenticated' then
    raise exception 'Claim o''qilmadi';
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'app.jwt_claim(): bo''sh, to''ldirilgan va yo''q holatlar OK';
end $do$;
