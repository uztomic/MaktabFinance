-- =====================================================================
--  34 — XAVFSIZLIKNI MUSTAHKAMLASH
--
--  Repozitoriy ochiq. Bu tizimni zaiflashtirmaydi — himoya kodni
--  yashirishda emas, bazadagi RLS da. Lekin ochiq kod degani, har
--  qanday zaiflik ham ochiq: hujumchi jadval va siyosat tuzilishini
--  bemalol o'qiy oladi. Shuning uchun "shubhali, lekin ishlaydi"
--  darajasi yetarli emas — invariantlar TEKSHIRILADIGAN bo'lishi
--  kerak.
--
--  Bu migratsiya ikki ish qiladi:
--
--    1. `plans` siyosatini toraytiradi. U yagona `using (true)`
--       siyosat edi: har bir maktabning har bir xodimi barcha tarif
--       shartlarini, jumladan nofaol va ichki tariflarni ko'rardi.
--
--    2. `app.security_invariants()` — o'z-o'zini tekshiruvchi funksiya.
--       U sakkizta invariantni tekshiradi va biror biri buzilgan
--       bo'lsa XATO tashlaydi. Sinov zanjirida chaqiriladi, ya'ni
--       kelajakdagi migratsiya himoyani jimgina buzib qo'yolmaydi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TARIFLAR — faqat faollari ko'rinadi
-- ---------------------------------------------------------------------

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated
  using (is_active or app.is_platform_admin());

comment on table public.plans is
  'Tarif katalogi. Mijozga faqat FAOL tariflar ko''rinadi — nofaol '
  'va ichki tariflar platforma operatoriga qoladi.';

-- ---------------------------------------------------------------------
-- 2. XAVFSIZLIK INVARIANTLARI
--
--  Har biri "shunday bo'lishi SHART" degan qoida. Sinov zanjiri
--  shuni chaqiradi; buzilgan bo'lsa sinov yiqiladi va sabab aniq
--  ko'rinadi.
-- ---------------------------------------------------------------------

create or replace function app.security_invariants()
returns table (tekshiruv text, holat text, tafsilot text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bad text;
  v_n   int;
begin
  -- --- 1. Har bir jadvalda RLS ---------------------------------
  select string_agg(c.relname, ', '), count(*) into v_bad, v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_n > 0 then
    raise exception 'INVARIANT 1 BUZILDI — RLS yoqilmagan jadval: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '1. Barcha jadvalda RLS';
  holat := 'OK'; tafsilot := 'istisno yo''q'; return next;

  -- --- 2. `anon` roliga hech qanday huquq yo'q ------------------
  select string_agg(distinct table_name, ', '), count(*) into v_bad, v_n
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if v_n > 0 then
    raise exception 'INVARIANT 2 BUZILDI — anon roliga huquq berilgan: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '2. anon roli huquqsiz';
  holat := 'OK'; tafsilot := 'kirmagan foydalanuvchi hech narsa ko''rmaydi';
  return next;

  -- --- 3. DELETE huquqi yo'q (TZ 5.4.8) ------------------------
  select string_agg(table_name, ', '), count(*) into v_bad, v_n
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and privilege_type = 'DELETE';
  if v_n > 0 then
    raise exception 'INVARIANT 3 BUZILDI — DELETE huquqi berilgan: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '3. Yozuv jismonan o''chirilmaydi';
  holat := 'OK'; tafsilot := 'DELETE huquqi hech qayerda yo''q'; return next;

  -- --- 4. Moliyaviy jadvalga mijozdan yozib bo'lmaydi ----------
  --     (TZ 5.4.6 — faqat SECURITY DEFINER RPC orqali)
  select string_agg(distinct c.relname, ', '), count(distinct c.relname)
    into v_bad, v_n
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('payments', 'invoices', 'invoice_lines',
                       'cash_receipts', 'payroll_runs', 'payroll_lines')
     and p.polcmd in ('a', 'w');   -- INSERT, UPDATE
  if v_n > 0 then
    raise exception
      'INVARIANT 4 BUZILDI — moliyaviy jadvalga yozish siyosati paydo bo''lgan: %',
      v_bad using errcode = '42501';
  end if;
  tekshiruv := '4. Moliyaviy jadval faqat o''qish uchun';
  holat := 'OK'; tafsilot := 'yozish faqat server funksiyasi orqali';
  return next;

  -- --- 5. SECURITY DEFINER funksiyalarda search_path ------------
  select string_agg(p.proname, ', '), count(*) into v_bad, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) cfg
                          where cfg like 'search_path=%'));
  if v_n > 0 then
    raise exception 'INVARIANT 5 BUZILDI — search_path o''rnatilmagan: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '5. SECURITY DEFINER da search_path';
  holat := 'OK'; tafsilot := 'sxema almashtirish hujumi imkonsiz'; return next;

  -- --- 6. Ko'rinishlar chaqiruvchi huquqi bilan -----------------
  --     PG15+ da view EGASI nomidan ishlaydi va RLS ni chetlab
  --     o'tadi. `security_invoker` shuni to'g'rilaydi.
  select string_agg(c.relname, ', '), count(*) into v_bad, v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and coalesce((select option_value from pg_options_to_table(c.reloptions)
                    where option_name = 'security_invoker'), 'false') <> 'true';
  if v_n > 0 then
    raise exception 'INVARIANT 6 BUZILDI — security_invoker yo''q view: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '6. View lar RLS ni chetlab o''tmaydi';
  holat := 'OK'; tafsilot := 'security_invoker hamma joyda'; return next;

  -- --- 7. Pul ustunlari float emas -----------------------------
  select string_agg(table_name || '.' || column_name, ', '), count(*)
    into v_bad, v_n
    from information_schema.columns
   where table_schema = 'public'
     and data_type in ('real', 'double precision')
     and column_name ~ 'amount|price|salary|total|balance|charged|paid';
  if v_n > 0 then
    raise exception 'INVARIANT 7 BUZILDI — pul ustuni float turida: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '7. Pul numeric turida';
  holat := 'OK'; tafsilot := 'yaxlitlash xatosi bo''lmaydi'; return next;

  -- --- 8. Storage bucket lari yopiq ----------------------------
  select string_agg(id, ', '), count(*) into v_bad, v_n
    from storage.buckets where public;
  if v_n > 0 then
    raise exception 'INVARIANT 8 BUZILDI — ochiq storage bucket: %', v_bad
      using errcode = '42501';
  end if;
  tekshiruv := '8. Chek rasmlari yopiq saqlanadi';
  holat := 'OK'; tafsilot := 'faqat vaqtinchalik havola orqali'; return next;

  -- --- 9. Huquqlar jadvaliga mijozdan yozib bo'lmaydi ----------
  --     Aks holda direktor o'ziga qo'shimcha huquq bera olardi.
  select count(*) into v_n
    from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and table_name = 'role_permissions'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_n > 0 then
    raise exception
      'INVARIANT 9 BUZILDI — role_permissions ga yozish huquqi berilgan'
      using errcode = '42501';
  end if;
  tekshiruv := '9. Huquqlar jadvali o''zgarmas';
  holat := 'OK'; tafsilot := 'huquqni o''ziga qo''shib bo''lmaydi'; return next;

  -- --- 10. Ijarachi filtri yo'q siyosat yo'q --------------------
  --     `plans` dan boshqa har bir siyosat maktab yoki foydalanuvchi
  --     bilan bog'langan bo'lishi shart.
  select string_agg(c.relname || '.' || p.polname, ', '), count(*)
    into v_bad, v_n
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname <> 'plans'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
         !~ 'school_id|app\.|auth\.uid'
     and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         !~ 'school_id|app\.|auth\.uid';
  if v_n > 0 then
    raise exception 'INVARIANT 10 BUZILDI — ijarachi filtri yo''q siyosat: %',
      v_bad using errcode = '42501';
  end if;
  tekshiruv := '10. Har bir siyosatda ijarachi filtri';
  holat := 'OK'; tafsilot := 'boshqa maktab ma''lumoti ko''rinmaydi';
  return next;
end;
$$;

comment on function app.security_invariants() is
  'Xavfsizlik invariantlari. Biror biri buzilgan bo''lsa XATO '
  'tashlaydi. Sinov zanjirida chaqiriladi — kelajakdagi migratsiya '
  'himoyani jimgina buzib qo''yolmaydi.';

-- Faqat platforma tomonidan chaqiriladi.
revoke all on function app.security_invariants() from public, anon, authenticated;
grant execute on function app.security_invariants() to service_role;

-- ---------------------------------------------------------------------
-- 3. DARHOL TEKSHIRAMIZ
--
--  Migratsiya o'zi qo'llanayotgan paytda invariantlar buzilgan bo'lsa
--  — to'xtaydi. Ya'ni "qo'llandi" degani "himoya joyida" degani.
-- ---------------------------------------------------------------------

do $do$
declare r record;
begin
  for r in select * from app.security_invariants() loop
    raise notice '  % — % (%)', r.tekshiruv, r.holat, r.tafsilot;
  end loop;
end $do$;
