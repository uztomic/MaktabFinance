-- =====================================================================
--  SINOV — XAVFSIZLIK
--
--  `app.security_invariants()` o'nta qoidani tekshiradi va biror biri
--  buzilgan bo'lsa XATO tashlaydi. Bu fayl uni chaqiradi va natijani
--  SANAB ham ko'radi.
--
--  Nega sanash kerak: funksiya kelajakda o'zgartirilib, tekshiruv
--  jimgina olib tashlansa, "xato bo'lmadi" degani "hammasi joyida"
--  degani bo'lmay qoladi. Soni kutilganidan kam bo'lsa — sinov
--  yiqiladi.
-- =====================================================================

do $$
declare
  r      record;
  v_n    int := 0;
  v_kut  int := 10;   -- kutilgan invariantlar soni
begin
  raise notice '';
  raise notice '=== XAVFSIZLIK INVARIANTLARI ===';

  for r in select * from app.security_invariants() loop
    v_n := v_n + 1;
    raise notice '  % — %', r.tekshiruv, r.tafsilot;
  end loop;

  if v_n <> v_kut then
    raise exception
      'XATO: % ta invariant tekshirildi, % ta kutilgan edi. '
      'Tekshiruv olib tashlanganmi?', v_n, v_kut;
  end if;

  raise notice '  → % ta invariantning hammasi o''tdi', v_n;
  raise notice '';
end $$;

-- ---------------------------------------------------------------------
--  QO'SHIMCHA: mijoz roli moliyaviy jadvalga yoza olmasligi
--
--  Invariant 4 siyosat MAVJUDLIGINI tekshiradi. Bu esa HUQUQ
--  darajasini: `authenticated` ga INSERT/UPDATE grant berilgan
--  bo'lsa, siyosat yo'qligi bilan baribir yopiq, lekin bu holat
--  chalkash va kelajakda xatoga olib keladi.
-- ---------------------------------------------------------------------

do $$
declare v_bad text;
begin
  select string_agg(table_name || ' (' || privilege_type || ')', ', ')
    into v_bad
    from information_schema.role_table_grants
   where grantee = 'authenticated'
     and table_schema = 'public'
     and privilege_type in ('INSERT', 'UPDATE')
     and table_name in ('payments', 'invoices', 'invoice_lines',
                        'cash_receipts', 'payroll_runs', 'payroll_lines');

  if v_bad is not null then
    raise exception
      'XATO: moliyaviy jadvalga mijoz roliga yozish huquqi berilgan — %',
      v_bad;
  end if;

  raise notice 'OK: moliyaviy jadvallarga mijozdan yozish huquqi yo''q';
end $$;

-- ---------------------------------------------------------------------
--  QO'SHIMCHA: audit jurnalini o'zgartirib bo'lmasligi (TZ 4.13.7)
--
--  "Jurnalsiz o'zgartirish texnik jihatdan imkonsiz" degani —
--  jurnalning O'ZI ham o'zgarmas bo'lishi kerak.
-- ---------------------------------------------------------------------

do $$
declare v_n int;
begin
  select count(*) into v_n
    from information_schema.role_table_grants
   where grantee = 'authenticated'
     and table_schema = 'public'
     and table_name in ('audit_log', 'platform_log', 'impersonation_log')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

  if v_n > 0 then
    raise exception
      'XATO: jurnal jadvallariga yozish huquqi berilgan (% ta)', v_n;
  end if;

  raise notice 'OK: jurnallar o''zgarmas — faqat o''qish';
  raise notice '';
  raise notice '=== XAVFSIZLIK SINOVI TUGADI ===';
end $$;
