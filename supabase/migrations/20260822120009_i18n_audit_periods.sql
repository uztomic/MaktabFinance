-- =====================================================================
--  09 — KO'P TILLILIK, AUDIT JURNALI VA DAVR QULFI
--       (TZ 5.6, 5.4.10, 5.4.9)
--
--  Uchta majburiy mexanizm:
--
--  1) TARJIMALAR — TZ 5.6.5: "Yangi til qo'shish uchun kodga
--     o'zgartirish talab qilinmaydi". Shuning uchun bot xabarlari va
--     hisobot sarlavhalari bazada saqlanadi.
--
--  2) AUDIT — TZ 5.4.10: "Har bir moliyaviy o'zgarish audit jurnalida
--     qayd etiladi: kim, qachon, qaysi qiymatdan qaysi qiymatga".
--     Bu trigger orqali AVTOMATIK bo'ladi — dasturchi yozishni
--     unutishi mumkin bo'lgan joy qolmaydi.
--
--  3) DAVR QULFI — TZ 5.4.9: "Yopilgan davr qulflanadi. Qulflangan davr
--     yozuvlari tahrirlanmaydi, tuzatish faqat joriy davrda tuzatuvchi
--     yozuv orqali".
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. TARJIMALAR (TZ 5.6.5)
-- ---------------------------------------------------------------------

create table if not exists public.translations (
  id         uuid primary key default gen_random_uuid(),
  -- 'bot' | 'report' | 'error' | 'ui'
  scope      text not null,
  key        text not null,
  lang       text not null check (lang in ('uz', 'uz-cyrl', 'ru')),
  text       text not null,
  -- null = platforma standarti; to'ldirilgan = shu maktab uchun
  -- moslashtirilgan matn (masalan maktab o'z uslubida yozmoqchi).
  school_id  uuid references public.schools(id) on delete cascade,
  updated_at timestamptz not null default now()
);

comment on table public.translations is
  'TZ 5.6.5 — yangi til qo''shish uchun kodga o''zgartirish kerak emas. '
  'Bot xabarlari va hisobot sarlavhalari shu jadvaldan olinadi.';
comment on column public.translations.school_id is
  'null = platforma standarti. To''ldirilgan bo''lsa maktabning o''z matni '
  'standartni bekor qiladi.';

create unique index if not exists translations_default_idx
  on public.translations(scope, key, lang) where school_id is null;
create unique index if not exists translations_school_idx
  on public.translations(scope, key, lang, school_id) where school_id is not null;

select app.attach_touch_trigger('translations');

-- Tarjimani oladi: maktab matni > platforma standarti > standart til > kalit.
create or replace function app.t(
  p_scope     text,
  p_key       text,
  p_lang      text,
  p_school_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- 1) Maktabning o'z matni
    (select tr.text from public.translations tr
      where tr.scope = p_scope and tr.key = p_key and tr.lang = p_lang
        and tr.school_id = p_school_id limit 1),
    -- 2) Platforma standarti
    (select tr.text from public.translations tr
      where tr.scope = p_scope and tr.key = p_key and tr.lang = p_lang
        and tr.school_id is null limit 1),
    -- 3) Standart til (o'zbek lotin)
    (select tr.text from public.translations tr
      where tr.scope = p_scope and tr.key = p_key and tr.lang = 'uz'
        and tr.school_id is null limit 1),
    -- 4) Tarjima topilmadi — kalitning o'zi qaytadi, matn yo'qolmaydi
    p_key
  );
$$;

comment on function app.t(text, text, text, uuid) is
  'Tarjima olish: maktab matni > platforma standarti > o''zbek lotin > kalit.';

-- ---------------------------------------------------------------------
-- 2. YOPILGAN DAVRLAR (TZ 5.4.9, 4.6.7, 4.5.7)
-- ---------------------------------------------------------------------

create table if not exists public.closed_periods (
  school_id  uuid not null references public.schools(id) on delete cascade,
  -- Oyning 1-sanasi.
  period     date not null,
  -- null = butun maktab; to'ldirilgan = faqat shu filial yopildi.
  branch_id  uuid references public.branches(id) on delete cascade,
  closed_at  timestamptz not null default now(),
  closed_by  uuid references public.app_users(id) on delete set null,
  note       text,
  primary key (school_id, period, branch_id)
);

comment on table public.closed_periods is
  'TZ 5.4.9 — yopilgan hisob davrlari. Bu davrdagi moliyaviy yozuvlar '
  'TAHRIRLANMAYDI; tuzatish faqat joriy davrda tuzatuvchi yozuv orqali.';

-- NULL branch_id primary key da tenglashmaydi, shuning uchun alohida indeks.
create unique index if not exists closed_periods_school_idx
  on public.closed_periods(school_id, period) where branch_id is null;

-- Berilgan sana yopilgan davrgami?
create or replace function app.period_is_closed(
  p_school_id uuid,
  p_date      date,
  p_branch_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.closed_periods cp
     where cp.school_id = p_school_id
       and cp.period = date_trunc('month', p_date)::date
       and (cp.branch_id is null or cp.branch_id = p_branch_id)
  );
$$;

comment on function app.period_is_closed(uuid, date, uuid) is
  'Sana yopilgan davrga tushadimi? Maktab bo''yicha yopilish barcha '
  'filialga taalluqli.';

create or replace function app.assert_period_open(
  p_school_id uuid,
  p_date      date,
  p_branch_id uuid default null
)
returns void
language plpgsql
stable
as $$
begin
  if app.period_is_closed(p_school_id, p_date, p_branch_id) then
    raise exception
      'Davr yopilgan (%). Tuzatish faqat joriy davrda tuzatuvchi yozuv orqali (TZ 5.4.9)',
      to_char(p_date, 'YYYY-MM')
      using errcode = '42501';
  end if;
end;
$$;

-- =====================================================================
--  DAVR QULFI TRIGGERI
--
--  Jadvalga biriktirilganda TG_ARGV[0] sifatida sana ustunining nomi
--  beriladi. Shu tufayli bitta trigger barcha moliyaviy jadvalga
--  yaraydi — har biriga alohida kod yozilmaydi.
-- =====================================================================
create or replace function app.guard_closed_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col       text := tg_argv[0];
  v_date      date;
  v_school    uuid;
  v_branch    uuid;
  v_row       jsonb := to_jsonb(coalesce(new, old));
begin
  v_date   := (v_row ->> v_col)::date;
  v_school := (v_row ->> 'school_id')::uuid;
  v_branch := nullif(v_row ->> 'branch_id', '')::uuid;

  if v_date is null or v_school is null then
    return coalesce(new, old);
  end if;

  -- Platforma admini ham yopilgan davrni ocholmaydi (TZ 4.13.7).
  perform app.assert_period_open(v_school, v_date, v_branch);

  -- UPDATE da eski sana ham tekshiriladi: yozuvni yopiq davrdan
  -- ochiq davrga "ko'chirib" chiqarib bo'lmasin.
  if tg_op = 'UPDATE' then
    perform app.assert_period_open(
      (to_jsonb(old) ->> 'school_id')::uuid,
      (to_jsonb(old) ->> v_col)::date,
      nullif(to_jsonb(old) ->> 'branch_id', '')::uuid);
  end if;

  return coalesce(new, old);
end;
$$;

comment on function app.guard_closed_period() is
  'TZ 5.4.9 — yopilgan davr yozuvini o''zgartirishga urinishni to''xtatadi. '
  'Sana ustuni nomi TG_ARGV[0] orqali beriladi.';

create or replace function app.attach_period_guard(p_table text, p_date_column text)
returns void
language plpgsql
as $$
begin
  execute format(
    'drop trigger if exists trg_%1$s_period_guard on public.%1$I', p_table);
  execute format(
    'create trigger trg_%1$s_period_guard
       before insert or update or delete on public.%1$I
       for each row execute function app.guard_closed_period(%2$L)',
    p_table, p_date_column);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. AUDIT JURNALI (TZ 5.4.10, 4.13.5.6)
-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id           bigint generated always as identity primary key,
  school_id    uuid not null,
  user_id      uuid,
  table_name   text not null,
  record_id    text,
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before       jsonb,
  after        jsonb,
  -- Faqat o'zgargan maydonlar — jurnalni o'qish oson bo'lsin.
  changed_keys text[],
  -- TZ 4.13.5.6 — impersonation rejimidagi amal ALOHIDA belgilanadi
  -- va maktab direktoriga ko'rinadi (TZ 4.13.5.2).
  impersonated_by uuid,
  at           timestamptz not null default now()
);

comment on table public.audit_log is
  'TZ 5.4.10 — har bir moliyaviy o''zgarish: kim, qachon, qaysi qiymatdan '
  'qaysi qiymatga. FAQAT QO''SHISH — tahrirlash siyosati yaratilmaydi.';
comment on column public.audit_log.impersonated_by is
  'TZ 4.13.5.6 — texnik yordam sessiyasida bajarilgan amal shu maydon '
  'bilan belgilanadi va direktor uni o''z panelida ko''radi.';

create index if not exists audit_log_school_idx on public.audit_log(school_id, at desc);
create index if not exists audit_log_record_idx on public.audit_log(table_name, record_id, at desc);
create index if not exists audit_log_impersonation_idx
  on public.audit_log(school_id, at desc) where impersonated_by is not null;

-- =====================================================================
--  UMUMIY AUDIT TRIGGERI
--
--  Bitta funksiya barcha moliyaviy jadval uchun. Dasturchi yangi
--  jadval qo'shganda faqat `app.attach_audit_trigger('jadval')` yozadi.
-- =====================================================================
create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_school  uuid;
  v_id      text;
  v_keys    text[];
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    -- updated_at har doim o'zgaradi — uni farqdan chiqaramiz.
    select array_agg(k) into v_keys
      from jsonb_object_keys(v_after) k
     where k <> 'updated_at'
       and (v_after -> k) is distinct from (v_before -> k);

    -- Mazmunli o'zgarish yo'q — jurnalni shovqin bilan to'ldirmaymiz.
    if v_keys is null then
      return new;
    end if;
  else
    v_before := to_jsonb(old);
  end if;

  v_school := coalesce(
    (v_after  ->> 'school_id')::uuid,
    (v_before ->> 'school_id')::uuid);
  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');

  if v_school is not null then
    insert into public.audit_log
      (school_id, user_id, table_name, record_id, action,
       before, after, changed_keys, impersonated_by)
    values
      (v_school, (select auth.uid()), tg_table_name, v_id, tg_op,
       v_before, v_after, v_keys,
       nullif(app.jwt_claim('imp_admin'), '')::uuid);
  end if;

  return coalesce(new, old);
end;
$$;

comment on function app.audit_trigger() is
  'TZ 5.4.10 — universal audit triggeri. Impersonation sessiyasida '
  'impersonated_by to''ldiriladi (TZ 4.13.5.6).';

create or replace function app.attach_audit_trigger(p_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'drop trigger if exists trg_%1$s_audit on public.%1$I', p_table);
  execute format(
    'create trigger trg_%1$s_audit
       after insert or update or delete on public.%1$I
       for each row execute function app.audit_trigger()', p_table);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. TRIGGERLARNI BIRIKTIRISH
--
--  Audit — barcha moliyaviy va ma'lumotnoma jadvaliga.
--  Davr qulfi — faqat davrga bog'liq moliyaviy jadvalga.
-- ---------------------------------------------------------------------

do $do$
declare
  t text;
  audited text[] := array[
    'schools', 'branches', 'app_users', 'user_branches',
    'students', 'parents', 'student_parents', 'contracts', 'discount_types',
    'services', 'service_prices', 'student_services', 'absences', 'calendar_days',
    'invoices', 'invoice_lines', 'payments', 'cash_receipts',
    'bank_statements', 'bank_statement_rows', 'payment_proofs',
    'expense_categories', 'expenses', 'teachers', 'teacher_branches',
    'lessons', 'payroll_settings', 'payroll_runs', 'payroll_lines',
    'leads', 'closed_periods', 'school_subscriptions', 'role_permissions'
  ];
begin
  foreach t in array audited loop
    perform app.attach_audit_trigger(t);
  end loop;
end $do$;

do $do$
declare
  r record;
  -- jadval → sana ustuni
  guarded text[][] := array[
    ['invoices',   'period'],
    ['payments',   'paid_on'],
    ['expenses',   'spent_on'],
    ['absences',   'day'],       -- TZ 4.5.7
    ['lessons',    'day'],
    ['payroll_runs', 'period']
  ];
  i int;
begin
  for i in 1 .. array_length(guarded, 1) loop
    perform app.attach_period_guard(guarded[i][1], guarded[i][2]);
  end loop;
end $do$;

grant execute on function
  app.t(text, text, text, uuid),
  app.period_is_closed(uuid, date, uuid),
  app.assert_period_open(uuid, date, uuid)
to authenticated, service_role;
