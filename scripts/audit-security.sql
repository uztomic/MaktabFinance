-- =====================================================================
--  XAVFSIZLIK AUDITI
--
--  Bu skript hech narsani o'zgartirmaydi — faqat MUAMMOLARNI qaytaradi.
--  Bo'sh natija = hammasi joyida.
--
--  Nima tekshiriladi:
--    1. RLS yoqilmagan jadval
--    2. RLS yoqilgan, lekin siyosati yo'q jadval
--    3. `anon` roliga berilgan huquq (bo'lmasligi kerak)
--    4. `authenticated` ga berilgan DELETE (TZ 5.4.8 — bo'lmasligi kerak)
--    5. `search_path` o'rnatilmagan SECURITY DEFINER funksiya
--    6. `security_invoker` qo'yilmagan ko'rinish (view)
--    7. Ijarachi filtri yo'q siyosat (`using (true)`)
--    8. Pul ustuni float turida (yaxlitlash xatosi)
--    9. Ochiq (public) storage bucket
--   10. `anon` chaqira oladigan funksiya
--
--  Ishga tushirish:
--    node scripts/db.mjs file scripts/audit-security.sql
-- =====================================================================

with

-- 1. RLS yoqilmagan jadval -------------------------------------------
no_rls as (
  select 1 as ord, 'RLS YOQILMAGAN' as muammo,
         c.relname as obyekt,
         'alter table public.' || c.relname || ' enable row level security;' as tavsiya
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
),

-- 2. RLS bor, siyosat yo'q -------------------------------------------
no_policy as (
  select 2, 'RLS BOR, SIYOSAT YO''Q', c.relname,
         'Jadval hech kimga ko''rinmaydi — siyosat qo''shing yoki huquqni oling'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and c.relrowsecurity
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
     -- ATAYLAB YOPIQ. Bularni faqat server funksiyalari va Edge
     -- Function (service_role) ishlatadi. Siyosat yo'qligi = mijozga
     -- umuman ochiq emas. Bu xato emas, qaror:
     --   counters          — kvitansiya raqami ketma-ketligi
     --   telegram_sessions — bot suhbat holati
     --   telegram_updates  — takroriy xabarni ajratish
     and c.relname not in ('counters', 'telegram_sessions', 'telegram_updates')
),

-- 3. `anon` roliga huquq ---------------------------------------------
anon_grants as (
  select 3, 'ANON ROLIGA HUQUQ', table_name || ' — ' || privilege_type,
         'revoke ' || privilege_type || ' on public.' || table_name || ' from anon;'
    from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public'
),

-- 4. `authenticated` ga DELETE ---------------------------------------
delete_grants as (
  select 4, 'AUTHENTICATED GA DELETE', table_name,
         'TZ 5.4.8 — yozuv jismonan o''chirilmaydi. '
         || 'revoke delete on public.' || table_name || ' from authenticated;'
    from information_schema.role_table_grants
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type = 'DELETE'
),

-- 5. search_path yo'q SECURITY DEFINER -------------------------------
--    Busiz chaqiruvchi `search_path` ni almashtirib, funksiya ichida
--    o'z jadvalini ishlatishga majburlashi mumkin.
mutable_path as (
  select 5, 'SECURITY DEFINER, search_path YO''Q',
         n.nspname || '.' || p.proname,
         'alter function ' || n.nspname || '.' || p.proname
         || '(' || pg_get_function_identity_arguments(p.oid) || ') '
         || 'set search_path = '''';'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app')
     and p.prosecdef
     and (p.proconfig is null
          or not exists (select 1 from unnest(p.proconfig) cfg
                          where cfg like 'search_path=%'))
),

-- 6. security_invoker qo'yilmagan ko'rinish ---------------------------
--    PG15+ da view EGASI nomidan ishlaydi, ya'ni RLS ni chetlab o'tadi.
unsafe_views as (
  select 6, 'VIEW security_invoker SIZ', c.relname,
         'alter view public.' || c.relname || ' set (security_invoker = true);'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and coalesce(
           (select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker'), 'false') <> 'true'
),

-- 7. Ijarachi filtri yo'q siyosat ------------------------------------
open_policies as (
  select 7, 'SIYOSATDA IJARACHI FILTRI YO''Q',
         p.polrelid::regclass::text || ' — ' || p.polname,
         'Siyosat school_id yoki app.* tekshiruvisiz — ko''rib chiqing'
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     -- `auth.uid()` ham ijarachi filtri: o'qituvchi yozuvi bitta
     -- maktabga tegishli, ya'ni "o'zinikini ko'rish" siyosati
     -- avtomatik ravishda maktab bilan chegaralangan.
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
         !~ 'school_id|app\.|auth\.uid'
     and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         !~ 'school_id|app\.|auth\.uid'
     -- Tarif katalogi ataylab umumiy (faqat faollari ko'rinadi).
     and c.relname <> 'plans'
),

-- 8. Pul ustuni float turida -----------------------------------------
float_money as (
  select 8, 'PUL USTUNI FLOAT', table_name || '.' || column_name,
         'numeric(14,2) ga o''tkazing — float pulda yaxlitlash xatosi beradi'
    from information_schema.columns
   where table_schema = 'public'
     and data_type in ('real', 'double precision')
     and (column_name ~ 'amount|price|salary|total|balance|sum|charged|paid|value')
),

-- 9. Ochiq storage bucket --------------------------------------------
public_buckets as (
  select 9, 'OCHIQ STORAGE BUCKET', id,
         'update storage.buckets set public = false where id = ''' || id || ''';'
    from storage.buckets
   where public
),

-- 10. `anon` chaqira oladigan funksiya -------------------------------
anon_functions as (
  select 10, 'ANON CHAQIRA OLADIGAN FUNKSIYA',
         n.nspname || '.' || p.proname,
         'revoke execute on function ' || n.nspname || '.' || p.proname
         || '(' || pg_get_function_identity_arguments(p.oid) || ') from anon;'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
)

select muammo, obyekt, tavsiya from (
  select * from no_rls
  union all select * from no_policy
  union all select * from anon_grants
  union all select * from delete_grants
  union all select * from mutable_path
  union all select * from unsafe_views
  union all select * from open_policies
  union all select * from float_money
  union all select * from public_buckets
  union all select * from anon_functions
) t
order by ord, obyekt;
