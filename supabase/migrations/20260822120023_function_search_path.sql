-- =====================================================================
--  23 — Barcha funksiyalarga `search_path` o'rnatish
--
--  MUAMMO (Supabase xavfsizlik maslahatchisi aniqladi): `search_path`
--  belgilanmagan funksiya chaqiruvchining sxema yo'lini meros oladi.
--  Agar hujumchi o'z sxemasida bir xil nomli funksiya yoki jadval
--  yarata olsa, u funksiya ichida ISHGA TUSHIB KETISHI mumkin
--  (sxema o'g'irlash / search_path hijacking).
--
--  Moliyaviy tizimda bu jiddiy: `app.can()` yoki `app.school_id()`
--  o'rniga soxta funksiya ishlasa, RLS mantiqi buziladi.
--
--  YECHIM: barcha funksiyaga `search_path = ''`. Kod ichidagi barcha
--  murojaat allaqachon to'liq nom bilan yozilgan (public.jadval,
--  app.funksiya), shuning uchun o'zgarish talab qilinmaydi.
--
--  `pg_catalog` har doim yo'lda bo'ladi, shuning uchun standart
--  operatorlar va funksiyalar ishlashda davom etadi.
-- =====================================================================

do $do$
declare
  f record;
  v_count int := 0;
begin
  for f in
    select n.nspname  as schema_name,
           p.proname   as func_name,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public')
       and p.prokind = 'f'
       -- search_path allaqachon o'rnatilganlarini o'tkazib yuboramiz
       and not exists (
         select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
          where c like 'search_path=%'
       )
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = ''''',
      f.schema_name, f.func_name, f.args);
    v_count := v_count + 1;
  end loop;

  raise notice '% ta funksiyaga search_path o''rnatildi', v_count;
end $do$;

-- --- Tekshiruv: birortasi qolib ketmasin ----------------------------
do $do$
declare
  v_missing text;
begin
  select string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    into v_missing
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public')
     and p.prokind = 'f'
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
        where c like 'search_path=%'
     );

  if v_missing is not null then
    raise exception 'search_path o''rnatilmagan funksiyalar: %', v_missing;
  end if;

  raise notice 'Barcha funksiyada search_path o''rnatilgan.';
end $do$;
