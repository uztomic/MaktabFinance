-- =====================================================================
--  36 — RLS TEZLIGI: FUNKSIYA CHAQIRUVLARINI BIR MARTAGA KELTIRISH
--
--  MUAMMO real hajmda ko'rindi va O'LCHANDI. 152 o'quvchi, 24 oy,
--  2600 hisoblanma bilan "Moliyaviy natija" hisoboti VAQT
--  CHEGARASIGA URILDI (`57014: statement timeout`). Foydalanuvchi
--  uchun bu — "Hisobotlar sahifasi ochilmaydi".
--
--  O'LCHOV (bir xil so'rov, bir xil ma'lumot):
--
--    | so'rov              | postgres | authenticated |
--    |---------------------|---------:|--------------:|
--    | invoices sanash     |     2 ms |        250 ms |
--    | invoice_lines       |    11 ms |        400 ms |
--    | v_invoice_totals    |     8 ms |        658 ms |
--
--  Ya'ni sekinlik ma'lumot hajmidan emas, RLS dan kelyapti — 100
--  barobar. Hisobot bir nechta shunday jadvalni bog'laganda yig'ilib
--  chegaradan oshadi.
--
--  SABAB: siyosat ifodasida `app.school_id()` kabi chaqiruv HAR BIR
--  QATOR uchun bajariladi. Funksiyalar `stable` bo'lsa ham, ular
--  filtr ichida turgani uchun rejalashtiruvchi ularni bir marta
--  hisoblab qo'ymaydi.
--
--  YECHIM: chaqiruvni `(select ...)` ichiga olish. Shunda u
--  qism-so'rovga (InitPlan) aylanadi va butun so'rov davomida BIR
--  MARTA hisoblanadi. Bu Supabase hujjatlarida tavsiya etilgan
--  standart usul.
--
--    school_id = app.school_id()
--      →  school_id = (select app.school_id())
--
--  Mantiq O'ZGARMAYDI: aynan o'sha qiymat, aynan o'sha natija.
--  O'zgarayotgani — necha marta hisoblanishi.
--
--  Migratsiya siyosatlarni QO'LDA ko'chirib yozmaydi: mavjud
--  ifodalarni o'qib, chaqiruvlarni o'rab, qaytadan yaratadi. Shu
--  tufayli bironta siyosat e'tibordan chetda qolmaydi va kelajakda
--  qo'shilganlari uchun ham qayta ishlatsa bo'ladi.
-- =====================================================================

do $do$
declare
  r          record;
  v_qual     text;
  v_check    text;
  v_cmd      text;
  v_roles    text;
  v_kind     text;
  v_changed  int := 0;
  v_total    int := 0;
begin
  for r in
    select
      c.relname                                   as tbl,
      p.polname                                   as pol,
      p.polcmd                                    as cmd,
      p.polpermissive                             as permissive,
      pg_get_expr(p.polqual, p.polrelid)          as qual,
      pg_get_expr(p.polwithcheck, p.polrelid)     as chk,
      coalesce(
        (select string_agg(quote_ident(rolname), ', ')
           from pg_roles where oid = any (p.polroles)),
        'public')                                 as roles
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public'
   order by c.relname, p.polname
  loop
    v_total := v_total + 1;

    -- `app.fn()` va `app.fn('literal'::text)` — siyosatlarda faqat shu
    -- ikki shakl uchraydi, ichma-ich qavs yo'q. Shuning uchun oddiy
    -- naqsh yetarli va xavfsiz.
    v_qual  := r.qual;
    v_check := r.chk;

    -- MASSIV QAYTARADIGAN chaqiruv alohida. `= any ((select f()))`
    -- ni Postgres qism-so'rov shakli deb o'qiydi va `uuid = uuid[]`
    -- deb xato beradi. `::uuid[]` qo'yilsa u yana IFODA bo'lib
    -- qoladi va massiv shakli tiklanadi.
    if v_qual is not null then
      v_qual := replace(v_qual, 'ANY (app.branch_ids())',
                        'ANY ((select app.branch_ids())::uuid[])');
      v_qual := regexp_replace(v_qual, '(app\.[a-z_]+\([^()]*\))',
                               '(select \1)', 'g');
    end if;
    if v_check is not null then
      v_check := replace(v_check, 'ANY (app.branch_ids())',
                         'ANY ((select app.branch_ids())::uuid[])');
      v_check := regexp_replace(v_check, '(app\.[a-z_]+\([^()]*\))',
                                '(select \1)', 'g');
    end if;

    -- Hech narsa o'zgarmagan bo'lsa tegmaymiz.
    if v_qual is not distinct from r.qual
       and v_check is not distinct from r.chk then
      continue;
    end if;

    v_cmd := case r.cmd
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      else 'all'
    end;
    v_kind := case when r.permissive then 'permissive' else 'restrictive' end;

    execute format('drop policy %I on public.%I', r.pol, r.tbl);

    execute
      format('create policy %I on public.%I as %s for %s to %s',
             r.pol, r.tbl, v_kind, v_cmd, r.roles)
      || coalesce(' using (' || v_qual || ')', '')
      || coalesce(' with check (' || v_check || ')', '');

    v_changed := v_changed + 1;
  end loop;

  raise notice 'RLS: % ta siyosatdan % tasi optimallashtirildi',
    v_total, v_changed;
end $do$;

-- =====================================================================
--  TEKSHIRUV — o'ralmagan chaqiruv qolmasligi kerak
-- =====================================================================

--  Postgres siyosat ifodasini QAYTA SHAKLLANTIRIB saqlaydi:
--  `(select app.school_id())` `( SELECT app.school_id() AS school_id)`
--  bo'lib chiqadi. Shuning uchun matnni to'g'ridan-to'g'ri solishtirib
--  bo'lmaydi — chaqiruvlar SONI bilan o'ralganlar soni taqqoslanadi.
do $do$
declare v_bad text; v_n int;
begin
  select string_agg(c.relname || '.' || p.polname, ', '), count(*)
    into v_bad, v_n
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace ns on ns.oid = c.relnamespace,
    lateral (select coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' '
                 || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
               as e) x
   where ns.nspname = 'public'
     and regexp_count(x.e, 'app\.[a-z_]+\(') >
         regexp_count(x.e, 'SELECT\s+app\.[a-z_]+\(');

  if v_n > 0 then
    raise exception 'O''ralmagan chaqiruv qoldi (% ta): %', v_n, v_bad;
  end if;

  raise notice 'Tekshiruv: barcha chaqiruv (select ...) ichida';
end $do$;

-- =====================================================================
--  INDEKSLAR
--
--  Hisobotlar sana oralig'i bo'yicha filtrlaydi. `invoices.period` da
--  indeks bor edi, qolganlarida yo'q — 2500 qatorda bu sezilmasdi,
--  bir necha yildan keyin sezilardi.
-- =====================================================================

create index if not exists payments_paid_on_idx
  on public.payments (school_id, paid_on)
  where status = 'confirmed';

create index if not exists expenses_spent_on_idx
  on public.expenses (school_id, spent_on)
  where deleted_at is null;

create index if not exists invoice_lines_invoice_idx
  on public.invoice_lines (invoice_id);

create index if not exists absences_day_idx
  on public.absences (school_id, day);

create index if not exists lessons_day_idx
  on public.lessons (school_id, day);

analyze public.invoices;
analyze public.invoice_lines;
analyze public.payments;
analyze public.expenses;
