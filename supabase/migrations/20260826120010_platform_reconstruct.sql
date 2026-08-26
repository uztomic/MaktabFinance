-- =====================================================================
--  41 — SUPER ADMIN OBYEKTLARINI TIKLASH
--
--  NEGA BU FAYL BOR. Super admin qismi (tariflash, obuna to'lovlari,
--  muloqot, impersonation) bazaga QO'LLANGAN, lekin uning migratsiya
--  fayllari repoga tushmay qolgan. `schema_migrations` da 10 ta yozuv
--  turibdi — 20260826120000 dan 20260826120009 gacha — fayllari esa yo'q.
--
--  Bu jimgina yotgan xavf edi. Toza bazaga `db.mjs push` qilinsa
--  (yangi loyiha, sinov muhiti, ofisdagi ikkinchi nusxa) o'sha 10 ta
--  migratsiya bajarilmaydi va tizim bir-biriga mos kelmaydigan ikki
--  holatda bo'lib qoladi: panelda obuna sahifasi bor, bazada jadval yo'q.
--
--  Shuning uchun yo'qolgan obyektlar JONLI BAZADAN o'qib olindi va shu
--  yerga yozildi. Fayl mavjud bazada hech narsani o'zgartirmaydi —
--  hamma joyda `if not exists` va `create or replace`. Toza bazada esa
--  butun super admin qismini qayta quradi.
--
--  Tarkibi: 4 ta enum, 5 ta jadval,
--  ularning indekslari, RLS siyosatlari va triggerlari,
--  29 ta funksiya.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Sanoq turlari
-- ---------------------------------------------------------------------

do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'subscription_invoice_status') then
    create type public.subscription_invoice_status as enum ('unpaid', 'partial', 'paid', 'void');
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'subscription_payment_status') then
    create type public.subscription_payment_status as enum ('pending', 'confirmed', 'rejected');
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'support_priority') then
    create type public.support_priority as enum ('low', 'normal', 'high');
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'support_thread_status') then
    create type public.support_thread_status as enum ('open', 'answered', 'closed');
  end if;
end $do$;


-- ---------------------------------------------------------------------
--  2. Jadvallar
-- ---------------------------------------------------------------------

create table if not exists public.platform_settings (
  key                    text not null,
  value                  jsonb not null,
  note                   text,
  is_public              boolean default false not null,
  updated_at             timestamp with time zone default now() not null
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'platform_settings_pkey'
                   and conrelid = 'public.platform_settings'::regclass) then
    alter table public.platform_settings add constraint platform_settings_pkey PRIMARY KEY (key);
  end if;
end $do$;

alter table public.platform_settings enable row level security;

drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings
  for select to authenticated
  using ((is_public OR ( SELECT app.is_platform_admin() AS is_platform_admin)));

drop trigger if exists trg_platform_settings_touch on public.platform_settings;
CREATE TRIGGER trg_platform_settings_touch BEFORE UPDATE ON public.platform_settings FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

grant select on public.platform_settings to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.platform_settings to service_role;

comment on table public.platform_settings is 'Platforma darajasidagi sozlamalar (narx formulasi, bloklash muddatlari). Yozish siyosati YO''Q — faqat RPC orqali.';


create table if not exists public.support_threads (
  id                     uuid default gen_random_uuid() not null,
  school_id              uuid not null,
  subject                text not null,
  status                 public.support_thread_status default 'open'::support_thread_status not null,
  priority               public.support_priority default 'normal'::support_priority not null,
  opened_by              uuid,
  opened_by_platform     boolean default false not null,
  payment_id             uuid,
  last_message_at        timestamp with time zone default now() not null,
  school_read_at         timestamp with time zone,
  platform_read_at       timestamp with time zone,
  closed_at              timestamp with time zone,
  created_at             timestamp with time zone default now() not null,
  updated_at             timestamp with time zone default now() not null
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_threads_pkey'
                   and conrelid = 'public.support_threads'::regclass) then
    alter table public.support_threads add constraint support_threads_pkey PRIMARY KEY (id);
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_threads_payment_id_fkey'
                   and conrelid = 'public.support_threads'::regclass) then
    alter table public.support_threads add constraint support_threads_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES subscription_payments(id) ON DELETE SET NULL;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_threads_school_id_fkey'
                   and conrelid = 'public.support_threads'::regclass) then
    alter table public.support_threads add constraint support_threads_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_threads_subject_check'
                   and conrelid = 'public.support_threads'::regclass) then
    alter table public.support_threads add constraint support_threads_subject_check CHECK ((length(btrim(subject)) >= 3));
  end if;
end $do$;

create index if not exists support_threads_school_idx ON public.support_threads USING btree (school_id, last_message_at DESC);

create index if not exists support_threads_open_idx ON public.support_threads USING btree (last_message_at DESC) WHERE (status <> 'closed'::support_thread_status);

alter table public.support_threads enable row level security;

drop policy if exists support_threads_select on public.support_threads;
create policy support_threads_select on public.support_threads
  for select to authenticated
  using (((school_id = ( SELECT app.school_id() AS school_id)) OR ( SELECT app.is_platform_admin() AS is_platform_admin)));

drop trigger if exists trg_support_threads_touch on public.support_threads;
CREATE TRIGGER trg_support_threads_touch BEFORE UPDATE ON public.support_threads FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

grant select on public.support_threads to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.support_threads to service_role;

comment on table public.support_threads is 'Maktab va ijrochi o''rtasidagi yozishma mavzusi. O''CHIRILMAYDI — yopilgani `closed` holatiga o''tadi (TZ 5.4.8).';


create table if not exists public.support_messages (
  id                     bigint not null,
  thread_id              uuid not null,
  school_id              uuid not null,
  sender_id              uuid,
  from_platform          boolean not null,
  is_system              boolean default false not null,
  body                   text not null,
  file_path              text,
  created_at             timestamp with time zone default now() not null
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_pkey'
                   and conrelid = 'public.support_messages'::regclass) then
    alter table public.support_messages add constraint support_messages_pkey PRIMARY KEY (id);
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_thread_id_fkey'
                   and conrelid = 'public.support_messages'::regclass) then
    alter table public.support_messages add constraint support_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES support_threads(id) ON DELETE CASCADE;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_messages_body_check'
                   and conrelid = 'public.support_messages'::regclass) then
    alter table public.support_messages add constraint support_messages_body_check CHECK ((length(btrim(body)) >= 1));
  end if;
end $do$;

create index if not exists support_messages_thread_idx ON public.support_messages USING btree (thread_id, created_at);

create index if not exists support_messages_school_idx ON public.support_messages USING btree (school_id, created_at DESC);

alter table public.support_messages enable row level security;

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
  for select to authenticated
  using (((school_id = ( SELECT app.school_id() AS school_id)) OR ( SELECT app.is_platform_admin() AS is_platform_admin)));

grant select on public.support_messages to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.support_messages to service_role;

comment on table public.support_messages is 'Yozishma xabarlari. FAQAT QO''SHISH — tahrirlash va o''chirish siyosatlari yaratilmaydi (TZ 5.4.13).';


create table if not exists public.subscription_invoices (
  id                     uuid default gen_random_uuid() not null,
  school_id              uuid not null,
  period                 date not null,
  issued_on              date default CURRENT_DATE not null,
  due_date               date not null,
  setup_fee              numeric(14,2) default 0 not null,
  base_amount            numeric(14,2) default 0 not null,
  branches_count         integer default 1 not null,
  branches_extra         integer default 0 not null,
  branches_amount        numeric(14,2) default 0 not null,
  students_count         integer default 0 not null,
  students_included      integer default 0 not null,
  students_extra_steps   integer default 0 not null,
  students_amount        numeric(14,2) default 0 not null,
  total_amount           numeric(14,2) not null,
  paid_amount            numeric(14,2) default 0 not null,
  status                 public.subscription_invoice_status default 'unpaid'::subscription_invoice_status not null,
  note                   text,
  created_at             timestamp with time zone default now() not null,
  updated_at             timestamp with time zone default now() not null
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_pkey'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_pkey PRIMARY KEY (id);
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_school_id_fkey'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_base_amount_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_base_amount_check CHECK ((base_amount >= (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_branches_amount_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_branches_amount_check CHECK ((branches_amount >= (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_paid_amount_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_paid_amount_check CHECK ((paid_amount >= (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_setup_fee_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_setup_fee_check CHECK ((setup_fee >= (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_students_amount_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_students_amount_check CHECK ((students_amount >= (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_invoices_total_amount_check'
                   and conrelid = 'public.subscription_invoices'::regclass) then
    alter table public.subscription_invoices add constraint subscription_invoices_total_amount_check CHECK ((total_amount >= (0)::numeric));
  end if;
end $do$;

create unique index if not exists subscription_invoices_period_idx ON public.subscription_invoices USING btree (school_id, period) WHERE (status <> 'void'::subscription_invoice_status);

create index if not exists subscription_invoices_due_idx ON public.subscription_invoices USING btree (due_date) WHERE (status = ANY (ARRAY['unpaid'::subscription_invoice_status, 'partial'::subscription_invoice_status]));

create index if not exists subscription_invoices_school_idx ON public.subscription_invoices USING btree (school_id, period DESC);

alter table public.subscription_invoices enable row level security;

drop policy if exists subscription_invoices_select on public.subscription_invoices;
create policy subscription_invoices_select on public.subscription_invoices
  for select to authenticated
  using (((school_id = ( SELECT app.school_id() AS school_id)) OR ( SELECT app.is_platform_admin() AS is_platform_admin)));

drop trigger if exists trg_subscription_invoices_audit on public.subscription_invoices;
CREATE TRIGGER trg_subscription_invoices_audit AFTER INSERT OR DELETE OR UPDATE ON public.subscription_invoices FOR EACH ROW EXECUTE FUNCTION app.audit_trigger();

drop trigger if exists trg_subscription_invoices_touch on public.subscription_invoices;
CREATE TRIGGER trg_subscription_invoices_touch BEFORE UPDATE ON public.subscription_invoices FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

grant select on public.subscription_invoices to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.subscription_invoices to service_role;

comment on table public.subscription_invoices is 'Maktabga chiqarilgan oylik hisob-faktura. O''CHIRILMAYDI — xato chiqarilgani `void` bilan bekor qilinadi (TZ 5.4.8).';


create table if not exists public.subscription_payments (
  id                     uuid default gen_random_uuid() not null,
  school_id              uuid not null,
  invoice_id             uuid,
  amount                 numeric(14,2) not null,
  paid_on                date not null,
  months                 smallint default 1 not null,
  method                 text default 'bank'::text not null,
  file_path              text,
  note                   text,
  status                 public.subscription_payment_status default 'pending'::subscription_payment_status not null,
  submitted_by           uuid,
  reviewed_by            uuid,
  reviewed_at            timestamp with time zone,
  reject_reason          text,
  created_at             timestamp with time zone default now() not null,
  updated_at             timestamp with time zone default now() not null
);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_pkey'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_pkey PRIMARY KEY (id);
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_invoice_id_fkey'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES subscription_invoices(id) ON DELETE SET NULL;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_reviewed_by_fkey'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES platform_admins(id) ON DELETE SET NULL;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_school_id_fkey'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_school_id_fkey FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT;
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payment_reject_needs_reason'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payment_reject_needs_reason CHECK (((status <> 'rejected'::subscription_payment_status) OR ((reject_reason IS NOT NULL) AND (length(btrim(reject_reason)) >= 5))));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_amount_check'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_amount_check CHECK ((amount > (0)::numeric));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_method_check'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_method_check CHECK ((method = ANY (ARRAY['bank'::text, 'cash'::text, 'card'::text, 'other'::text])));
  end if;
end $do$;

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_payments_months_check'
                   and conrelid = 'public.subscription_payments'::regclass) then
    alter table public.subscription_payments add constraint subscription_payments_months_check CHECK (((months >= 1) AND (months <= 24)));
  end if;
end $do$;

create index if not exists subscription_payments_pending_idx ON public.subscription_payments USING btree (created_at DESC) WHERE (status = 'pending'::subscription_payment_status);

create index if not exists subscription_payments_school_idx ON public.subscription_payments USING btree (school_id, created_at DESC);

alter table public.subscription_payments enable row level security;

drop policy if exists subscription_payments_select on public.subscription_payments;
create policy subscription_payments_select on public.subscription_payments
  for select to authenticated
  using (((school_id = ( SELECT app.school_id() AS school_id)) OR ( SELECT app.is_platform_admin() AS is_platform_admin)));

drop trigger if exists trg_subscription_payments_audit on public.subscription_payments;
CREATE TRIGGER trg_subscription_payments_audit AFTER INSERT OR DELETE OR UPDATE ON public.subscription_payments FOR EACH ROW EXECUTE FUNCTION app.audit_trigger();

drop trigger if exists trg_subscription_payments_touch on public.subscription_payments;
CREATE TRIGGER trg_subscription_payments_touch BEFORE UPDATE ON public.subscription_payments FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

grant select on public.subscription_payments to authenticated;

grant delete, insert, references, select, trigger, truncate, update on public.subscription_payments to service_role;

comment on table public.subscription_payments is 'Maktab yuborgan obuna to''lovi va uning cheki. `pending` holat obunani UZAYTIRMAYDI — faqat super admin tasdig''i uzaytiradi.';



-- ---------------------------------------------------------------------
--  3. Funksiyalar
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.apply_subscription_payment(p_school_id uuid, p_amount numeric, p_paid_on date, p_months integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sub    public.school_subscriptions%rowtype;
  v_left   numeric := p_amount;
  v_inv    record;
  v_apply  numeric;
  v_next   date;
begin
  select * into v_sub
    from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled'
   limit 1;
  if not found then
    raise exception 'Maktabda faol obuna yo''q' using errcode = 'P0002';
  end if;

  -- --- Eng eski qarzdan boshlab yopamiz ----------------------------
  for v_inv in
    select * from public.subscription_invoices
     where school_id = p_school_id
       and status in ('unpaid', 'partial')
     order by period
  loop
    exit when v_left <= 0;
    v_apply := least(v_left, v_inv.total_amount - v_inv.paid_amount);

    update public.subscription_invoices
       set paid_amount = paid_amount + v_apply,
           status = case
             when paid_amount + v_apply >= total_amount then 'paid'::public.subscription_invoice_status
             else 'partial'::public.subscription_invoice_status
           end
     where id = v_inv.id;

    v_left := v_left - v_apply;
  end loop;

  -- --- Muddatni siljitamiz -----------------------------------------
  --  Asos — MAVJUD muddat, bugungi sana emas. Uch oy kechikkan
  --  maktab bir oylik to'lasa, u hali ham ikki oy qarzdor bo'lib
  --  qoladi: qarz kechirilmaydi.
  v_next := (coalesce(v_sub.next_payment_date, p_paid_on)
             + (p_months * interval '1 month'))::date;

  --  TO'LOV SINOVNI TUGATADI. Busiz `recompute` obunani hamon
  --  `trial` deb ko'radi (chunki `trial_ends_at` hali kelajakda) va
  --  pul to'lagan maktab "sinovda" bo'lib qolaveradi — hisob-faktura
  --  ham chiqarilmaydi, chunki cron sinovdagi maktabni o'tkazib
  --  yuboradi. Ya'ni bir marta to'lagan maktab boshqa hech qachon
  --  hisob olmaydi.
  update public.school_subscriptions
     set next_payment_date = v_next,
         last_paid_at      = p_paid_on,
         status = case
           when status = 'trial' then 'active'::public.subscription_status
           else status
         end
   where id = v_sub.id;

  return jsonb_build_object(
    'school_id',         p_school_id,
    'next_payment_date', v_next,
    'unapplied',         v_left,
    -- Holat zinapoyasi qayta hisoblanadi: yangi muddat kelajakda
    -- bo'lsa maktab shu yerda `active` ga qaytadi.
    'billing',           app.recompute_school_billing(p_school_id));
end;
$function$;

CREATE OR REPLACE FUNCTION app.billing_num(p_key text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (value #>> '{}')::numeric
    from public.platform_settings
   where key = p_key;
$function$;

CREATE OR REPLACE FUNCTION app.notify_school(p_school_id uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_thread uuid;
begin
  select id into v_thread
    from public.support_threads
   where school_id = p_school_id
     and subject = 'Obuna va to''lov'
     and opened_by_platform
   order by created_at
   limit 1;

  if v_thread is null then
    insert into public.support_threads
      (school_id, subject, priority, opened_by_platform)
    values
      (p_school_id, 'Obuna va to''lov', 'high', true)
    returning id into v_thread;
  end if;

  perform app.support_post(v_thread, p_school_id, null, true, p_body, null, true);
  return v_thread;
end;
$function$;

CREATE OR REPLACE FUNCTION app.plog(p_action text, p_entity text, p_entity_id text, p_school_id uuid, p_before jsonb DEFAULT NULL::jsonb, p_after jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  insert into public.platform_log
    (admin_id, action, entity, entity_id, school_id, before, after)
  values (
    -- DIQQAT: `admin_id` da `platform_admins` ga FK bor. Bu jurnalga
    -- MAKTAB ham sabab bo'ladi (direktor obuna cheki yuborganda), va
    -- o'shanda `auth.uid()` direktorning ID si — u `platform_admins`
    -- da YO'Q. Shartsiz yozilsa 23503 chiqadi: direktor chek yubora
    -- olmaydi, ya'ni bloklangan holatdan chiqish eshigi qulflanadi.
    case when app.is_platform_admin() then (select auth.uid()) end,
    p_action, p_entity, p_entity_id, p_school_id, p_before,
    -- Haqiqiy ijrochi har doim saqlanadi — kim qilgani yo'qolmaydi.
    coalesce(p_after, '{}'::jsonb)
      || jsonb_build_object(
           'by_user',     (select auth.uid()),
           'by_platform', app.is_platform_admin())
  );
$function$;

CREATE OR REPLACE FUNCTION app.recompute_school_billing(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_grace   int := coalesce(app.billing_num('billing.grace_days'), 15)::int;
  v_suspend int := coalesce(app.billing_num('billing.suspend_days'), 45)::int;
  v_sub     public.school_subscriptions%rowtype;
  v_school  public.schools%rowtype;
  v_overdue int;
  v_new_sub public.subscription_status;
  v_new_sch public.school_status;
begin
  select * into v_sub
    from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled'
   limit 1;

  if not found then
    return jsonb_build_object('school_id', p_school_id, 'changed', false,
                              'reason', 'obuna yo''q');
  end if;

  select * into v_school from public.schools where id = p_school_id;

  -- Arxivlangan maktab to'lov zinapoyasidan chiqariladi.
  if v_school.status = 'archived' or v_school.deleted_at is not null then
    return jsonb_build_object('school_id', p_school_id, 'changed', false,
                              'reason', 'arxiv');
  end if;

  -- --- Sinov muddati hali tugamagan ---------------------------------
  if v_sub.status = 'trial'
     and v_sub.trial_ends_at is not null
     and v_sub.trial_ends_at >= current_date then
    v_new_sub := 'trial';
    v_new_sch := 'trial';
  else
    -- Muddat qo'yilmagan bo'lsa kechikish hisoblanmaydi.
    if v_sub.next_payment_date is null then
      v_new_sub := 'active';
      v_new_sch := 'active';
    else
      v_overdue := current_date - v_sub.next_payment_date;

      if v_overdue < 0 then
        v_new_sub := 'active';    v_new_sch := 'active';
      elsif v_overdue < v_grace then
        v_new_sub := 'grace';     v_new_sch := 'active';
      elsif v_overdue < v_suspend then
        v_new_sub := 'restricted'; v_new_sch := 'restricted';
      else
        v_new_sub := 'suspended';  v_new_sch := 'suspended';
      end if;
    end if;
  end if;

  if v_new_sub = v_sub.status and v_new_sch = v_school.status then
    return jsonb_build_object('school_id', p_school_id, 'changed', false,
                              'status', v_new_sch, 'overdue_days', v_overdue);
  end if;

  update public.school_subscriptions
     set status = v_new_sub
   where id = v_sub.id;

  update public.schools
     set status = v_new_sch
   where id = p_school_id;

  perform app.plog(
    'billing_status_recomputed', 'schools', p_school_id::text, p_school_id,
    jsonb_build_object('school_status', v_school.status,
                       'subscription_status', v_sub.status),
    jsonb_build_object('school_status', v_new_sch,
                       'subscription_status', v_new_sub,
                       'overdue_days', v_overdue));

  return jsonb_build_object(
    'school_id', p_school_id, 'changed', true,
    'from', v_school.status, 'status', v_new_sch,
    'subscription_status', v_new_sub, 'overdue_days', v_overdue);
end;
$function$;

CREATE OR REPLACE FUNCTION app.require_platform_admin()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  if not app.is_platform_admin() then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;
  v_id := (select auth.uid());
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION app.school_is_visible()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.is_platform_admin()
      or exists (
           select 1
             from public.schools s
             join public.app_users u on u.school_id = s.id
            where u.id = (select auth.uid())
              and u.is_active
              and u.deleted_at is null
              and s.deleted_at is null
              and s.status <> 'suspended'
         );
$function$;

CREATE OR REPLACE FUNCTION app.support_post(p_thread_id uuid, p_school_id uuid, p_sender_id uuid, p_from_platform boolean, p_body text, p_file_path text DEFAULT NULL::text, p_is_system boolean DEFAULT false)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id bigint;
begin
  insert into public.support_messages
    (thread_id, school_id, sender_id, from_platform, is_system, body, file_path)
  values
    (p_thread_id, p_school_id, p_sender_id, p_from_platform, p_is_system,
     btrim(p_body), p_file_path)
  returning id into v_id;

  update public.support_threads
     set last_message_at = now(),
         -- Yopilgan mavzuga yozilsa u qayta ochiladi: savol davom
         -- etayotgan bo'lsa uni sun'iy ravishda yopiq tutish noto'g'ri.
         status = case
           when p_is_system         then status
           when p_from_platform     then 'answered'::public.support_thread_status
           else                          'open'::public.support_thread_status
         end,
         closed_at = case when p_is_system then closed_at else null end,
         -- Yozgan tomon o'z xabarini o'qigan hisoblanadi.
         platform_read_at = case when p_from_platform then now() else platform_read_at end,
         school_read_at   = case when p_from_platform then school_read_at else now() end
   where id = p_thread_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.end_impersonation(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid := app.require_platform_admin();
  v_s     public.impersonation_sessions%rowtype;
begin
  select * into v_s from public.impersonation_sessions where id = p_session_id;
  if not found then
    raise exception 'Sessiya topilmadi' using errcode = 'P0002';
  end if;

  if v_s.ended_at is not null then
    return jsonb_build_object('session_id', p_session_id, 'changed', false,
                              'ended_at', v_s.ended_at);
  end if;

  update public.impersonation_sessions
     set ended_at = now()
   where id = p_session_id;

  insert into public.impersonation_log
    (session_id, admin_id, school_id, target_user_id, mode, action, detail)
  values
    (p_session_id, v_s.admin_id, v_s.school_id, v_s.target_user_id, v_s.mode,
     'session_ended',
     jsonb_build_object('ended_by', v_admin,
                        'by_other_admin', v_admin <> v_s.admin_id));

  perform app.plog('impersonation_ended', 'impersonation_sessions',
                   p_session_id::text, v_s.school_id,
                   jsonb_build_object('ended_at', null),
                   jsonb_build_object('ended_at', now(), 'ended_by', v_admin));

  return jsonb_build_object('session_id', p_session_id, 'changed', true);
end;
$function$;

revoke all on function public.end_impersonation(p_session_id uuid) from public, anon;
grant execute on function public.end_impersonation(p_session_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.issue_subscription_invoice(p_school_id uuid, p_period date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_period date := date_trunc('month', coalesce(p_period, current_date))::date;
  v_price  jsonb;
  v_sub    public.school_subscriptions%rowtype;
  v_total  numeric;
  v_due    date;
  v_id     uuid;
begin
  -- Cron ham chaqiradi, super admin ham.
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  -- Takror chiqarilmasin.
  select id into v_id
    from public.subscription_invoices
   where school_id = p_school_id and period = v_period and status <> 'void';
  if found then
    return jsonb_build_object('invoice_id', v_id, 'created', false,
                              'period', v_period);
  end if;

  v_price := public.school_price(p_school_id);

  select * into v_sub
    from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled'
   limit 1;

  -- To'lov muddati: obunadagi sana, bo'lmasa oyning 5-sanasi.
  v_due := coalesce(v_sub.next_payment_date, v_period + 4);

  v_total := (v_price ->> 'monthly_total')::numeric
           + (v_price ->> 'setup_fee')::numeric;

  insert into public.subscription_invoices (
    school_id, period, due_date,
    setup_fee, base_amount,
    branches_count, branches_extra, branches_amount,
    students_count, students_included, students_extra_steps, students_amount,
    total_amount)
  values (
    p_school_id, v_period, v_due,
    (v_price ->> 'setup_fee')::numeric,
    (v_price ->> 'base_amount')::numeric,
    (v_price ->> 'branches_count')::int,
    (v_price ->> 'branches_extra')::int,
    (v_price ->> 'branches_amount')::numeric,
    (v_price ->> 'students_count')::int,
    (v_price ->> 'students_included')::int,
    (v_price ->> 'students_extra_steps')::int,
    (v_price ->> 'students_amount')::numeric,
    v_total)
  returning id into v_id;

  -- Obunadagi oylik summa hisob-faktura bilan bir xil bo'lib tursin.
  if v_sub.id is not null then
    update public.school_subscriptions
       set monthly_amount = (v_price ->> 'monthly_total')::numeric
     where id = v_sub.id;
  end if;

  perform app.plog('invoice_issued', 'subscription_invoices',
                   v_id::text, p_school_id, null,
                   jsonb_build_object('period', v_period, 'total', v_total));

  return jsonb_build_object('invoice_id', v_id, 'created', true,
                            'period', v_period, 'total', v_total,
                            'due_date', v_due, 'breakdown', v_price);
end;
$function$;

revoke all on function public.issue_subscription_invoice(p_school_id uuid, p_period date) from public, anon;
grant execute on function public.issue_subscription_invoice(p_school_id uuid, p_period date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.log_platform_action(p_action text, p_entity text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text, p_school_id uuid DEFAULT NULL::uuid, p_detail jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_admin();

  if p_action is null or length(btrim(p_action)) = 0 then
    raise exception 'Amal nomi ko''rsatilishi shart' using errcode = '22023';
  end if;

  perform app.plog(btrim(p_action), p_entity, p_entity_id, p_school_id,
                   null, p_detail);
end;
$function$;

revoke all on function public.log_platform_action(p_action text, p_entity text, p_entity_id text, p_school_id uuid, p_detail jsonb) from public, anon;
grant execute on function public.log_platform_action(p_action text, p_entity text, p_entity_id text, p_school_id uuid, p_detail jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_support_read(p_thread_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_platform boolean := app.is_platform_admin();
  v_thread   public.support_threads%rowtype;
begin
  select * into v_thread from public.support_threads where id = p_thread_id;
  if not found then
    raise exception 'Mavzu topilmadi' using errcode = 'P0002';
  end if;

  if v_platform then
    update public.support_threads set platform_read_at = now() where id = p_thread_id;
  else
    if v_thread.school_id is distinct from app.school_id() then
      raise exception 'Bu yozishmaga kirish huquqi yo''q' using errcode = '42501';
    end if;
    update public.support_threads set school_read_at = now() where id = p_thread_id;
  end if;

  return jsonb_build_object('thread_id', p_thread_id, 'read_at', now());
end;
$function$;

revoke all on function public.mark_support_read(p_thread_id uuid) from public, anon;
grant execute on function public.mark_support_read(p_thread_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.open_support_thread(p_subject text, p_body text, p_school_id uuid DEFAULT NULL::uuid, p_priority support_priority DEFAULT 'normal'::support_priority, p_file_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_platform boolean := app.is_platform_admin();
  v_user     uuid := (select auth.uid());
  v_school   uuid;
  v_id       uuid;
begin
  if length(btrim(coalesce(p_subject, ''))) < 3 then
    raise exception 'Mavzu kamida 3 belgi bo''lishi kerak' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'Xabar bo''sh bo''lishi mumkin emas' using errcode = '22023';
  end if;

  if v_platform then
    if p_school_id is null then
      raise exception 'Maktab tanlanishi kerak' using errcode = '22023';
    end if;
    v_school := p_school_id;
  else
    v_school := app.school_id();
    if v_school is null then
      raise exception 'Maktab konteksti topilmadi' using errcode = '42501';
    end if;
    -- Texnik yordam sessiyasidagi o'qish rejimi yozmaydi.
    if app.is_readonly_session() then
      raise exception 'Faqat o''qish rejimida yozib bo''lmaydi'
        using errcode = '42501';
    end if;
  end if;

  insert into public.support_threads
    (school_id, subject, priority, opened_by, opened_by_platform)
  values
    (v_school, btrim(p_subject), p_priority, v_user, v_platform)
  returning id into v_id;

  perform app.support_post(v_id, v_school, v_user, v_platform,
                           p_body, p_file_path, false);

  if v_platform then
    perform app.plog('support_thread_opened', 'support_threads',
                     v_id::text, v_school, null,
                     jsonb_build_object('subject', btrim(p_subject)));
  end if;

  return jsonb_build_object('thread_id', v_id, 'school_id', v_school);
end;
$function$;

revoke all on function public.open_support_thread(p_subject text, p_body text, p_school_id uuid, p_priority support_priority, p_file_path text) from public, anon;
grant execute on function public.open_support_thread(p_subject text, p_body text, p_school_id uuid, p_priority support_priority, p_file_path text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_overview()
 RETURNS TABLE(schools_total integer, schools_trial integer, schools_active integer, schools_restricted integer, schools_suspended integer, schools_archived integer, mrr numeric, unpaid_amount numeric, unpaid_invoices integer, overdue_schools integer, students_total integer, branches_total integer, users_total integer, pending_payments integer, open_threads integer, unread_threads integer, new_schools_30d integer, churn_90d integer, failed_messages integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform_admin() then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::int from public.schools where deleted_at is null),
    (select count(*)::int from public.schools where deleted_at is null and status = 'trial'),
    (select count(*)::int from public.schools where deleted_at is null and status = 'active'),
    (select count(*)::int from public.schools where deleted_at is null and status = 'restricted'),
    (select count(*)::int from public.schools where deleted_at is null and status = 'suspended'),
    (select count(*)::int from public.schools where deleted_at is null and status = 'archived'),

    -- Oylik takrorlanuvchi daromad. Sinov va to'xtatilgan maktablar
    -- KIRMAYDI — ular hozir pul keltirmayapti.
    (select coalesce(sum(sub.monthly_amount), 0)
       from public.school_subscriptions sub
       join public.schools s on s.id = sub.school_id
      where s.deleted_at is null
        and sub.status in ('active', 'grace')),

    (select coalesce(sum(total_amount - paid_amount), 0)
       from public.subscription_invoices
      where status in ('unpaid', 'partial')),
    (select count(*)::int from public.subscription_invoices
      where status in ('unpaid', 'partial')),
    (select count(*)::int
       from public.school_subscriptions sub
       join public.schools s on s.id = sub.school_id
      where s.deleted_at is null
        and sub.status <> 'cancelled'
        and sub.next_payment_date is not null
        and sub.next_payment_date < current_date),

    (select count(*)::int from public.students
      where status = 'active' and deleted_at is null),
    (select count(*)::int from public.branches
      where is_active and deleted_at is null),
    (select count(*)::int from public.app_users
      where is_active and deleted_at is null),

    (select count(*)::int from public.subscription_payments where status = 'pending'),
    (select count(*)::int from public.support_threads where status <> 'closed'),
    (select count(distinct th.id)::int
       from public.support_threads th
       join public.support_messages m on m.thread_id = th.id
      where not m.from_platform
        and (th.platform_read_at is null or m.created_at > th.platform_read_at)),

    (select count(*)::int from public.schools
      where deleted_at is null and created_at >= now() - interval '30 days'),
    -- Chiqib ketganlar: oxirgi 90 kunda arxivga o'tganlar.
    (select count(*)::int from public.schools
      where status = 'archived' and updated_at >= now() - interval '90 days'),
    (select count(*)::int from public.message_queue
      where status in ('failed', 'blocked'));
end;
$function$;

revoke all on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_revenue(p_months integer DEFAULT 12)
 RETURNS TABLE(period date, issued numeric, collected numeric, invoices integer, schools integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.is_platform_admin() then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  -- DIQQAT: chiqish ustunlari (`period`, `schools`) jadval ustunlari
  -- bilan bir xil nomlanadi. plpgsql ularni O'ZGARUVCHI deb oladi va
  -- `column reference "period" is ambiguous` (42702) chiqadi.
  -- Shuning uchun har bir jadvalga taxallus berilgan va ichkarida
  -- HAMMA ustun to'liq nom bilan yoziladi.
  return query
  with months as (
    select generate_series(
             date_trunc('month', current_date) - ((p_months - 1) * interval '1 month'),
             date_trunc('month', current_date),
             interval '1 month')::date as m_period
  )
  select
    m.m_period,
    coalesce(i.issued, 0),
    coalesce(pay.collected, 0),
    coalesce(i.cnt, 0),
    coalesce(i.school_cnt, 0)
  from months m
  left join lateral (
    select sum(si.total_amount)              as issued,
           count(*)::int                     as cnt,
           count(distinct si.school_id)::int as school_cnt
      from public.subscription_invoices si
     where si.status <> 'void' and si.period = m.m_period
  ) i on true
  left join lateral (
    select sum(sp.amount) as collected
      from public.subscription_payments sp
     where sp.status = 'confirmed'
       and date_trunc('month', sp.paid_on)::date = m.m_period
  ) pay on true
  order by m.m_period;
end;
$function$;

revoke all on function public.platform_revenue(p_months integer) from public, anon;
grant execute on function public.platform_revenue(p_months integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_school_card(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
begin
  if not app.is_platform_admin() then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'school', jsonb_build_object(
      'id', s.id, 'name', s.name, 'legal_name', s.legal_name,
      'tax_id', s.tax_id, 'address', s.address, 'phone', s.phone,
      'email', s.email, 'status', s.status, 'timezone', s.timezone,
      'default_lang', s.default_lang, 'created_at', s.created_at),

    'size', jsonb_build_object(
      'students', (select count(*) from public.students
                    where school_id = s.id and status = 'active' and deleted_at is null),
      'students_all', (select count(*) from public.students
                    where school_id = s.id and deleted_at is null),
      'branches', (select count(*) from public.branches
                    where school_id = s.id and is_active and deleted_at is null),
      'users',    (select count(*) from public.app_users
                    where school_id = s.id and is_active and deleted_at is null),
      'teachers', (select count(*) from public.teachers
                    where school_id = s.id and is_active and deleted_at is null),
      'classes',  (select count(*) from public.classes
                    where school_id = s.id and is_active and deleted_at is null)),

    -- FAQAT SANALAR. Summalar ataylab yo'q (TZ E2).
    'activity', jsonb_build_object(
      'last_audit',   (select max(at) from public.audit_log where school_id = s.id),
      'last_invoice', (select max(created_at) from public.invoices where school_id = s.id),
      'last_payment', (select max(created_at) from public.payments where school_id = s.id),
      'last_sign_in', (select max(au.last_sign_in_at)
                         from public.app_users u
                         join auth.users au on au.id = u.id
                        where u.school_id = s.id)),

    'price', public.school_price(s.id),

    'director', (
      select jsonb_build_object('id', u.id, 'full_name', u.full_name,
                                'email', u.email, 'phone', u.phone)
        from public.app_users u
       where u.school_id = s.id and u.role = 'director'
         and u.is_active and u.deleted_at is null
       order by u.created_at limit 1)
  )
  into v
  from public.schools s
  where s.id = p_school_id;

  if v is null then
    raise exception 'Maktab topilmadi' using errcode = 'P0002';
  end if;

  return v;
end;
$function$;

revoke all on function public.platform_school_card(p_school_id uuid) from public, anon;
grant execute on function public.platform_school_card(p_school_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_schools()
 RETURNS TABLE(school_id uuid, name text, tax_id text, phone text, status school_status, created_at timestamp with time zone, plan_code text, plan_name text, max_students integer, max_branches integer, subscription_status subscription_status, monthly_amount numeric, trial_ends_at date, next_payment_date date, last_paid_at date, overdue_days integer, students_count integer, branches_count integer, users_count integer, teachers_count integer, students_included integer, over_limit boolean, unpaid_amount numeric, pending_payments integer, unread_messages integer, last_activity timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_per_branch int := coalesce(app.billing_num('billing.students_per_branch'), 250)::int;
begin
  if not app.is_platform_admin() then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  return query
  select
    s.id, s.name, s.tax_id, s.phone, s.status, s.created_at,

    p.code, p.name, p.max_students, p.max_branches,

    sub.status, sub.monthly_amount, sub.trial_ends_at,
    sub.next_payment_date, sub.last_paid_at,
    case when sub.next_payment_date is null then null
         else (current_date - sub.next_payment_date) end,

    cnt.students, cnt.branches, cnt.users, cnt.teachers,
    cnt.branches * v_per_branch,
    -- Sotuv signali (TZ E1): o'quvchi soni filiallar bergan limitdan
    -- yoki tarif chegarasidan oshgan.
    (cnt.students > cnt.branches * v_per_branch)
      or (p.max_students is not null and cnt.students > p.max_students),

    coalesce(bill.unpaid, 0), coalesce(bill.pending, 0),
    coalesce(msg.unread, 0), act.last_at
  from public.schools s
  left join public.school_subscriptions sub
         on sub.school_id = s.id and sub.status <> 'cancelled'
  left join public.plans p on p.id = sub.plan_id

  -- O'lcham. Har biri alohida `count` — bitta `join` bilan qilinsa
  -- dekart ko'paytmasi chiqadi va sonlar bir necha barobar oshadi.
  left join lateral (
    select
      (select count(*)::int from public.students st
        where st.school_id = s.id and st.status = 'active' and st.deleted_at is null) as students,
      (select count(*)::int from public.branches b
        where b.school_id = s.id and b.is_active and b.deleted_at is null) as branches,
      (select count(*)::int from public.app_users u
        where u.school_id = s.id and u.is_active and u.deleted_at is null) as users,
      (select count(*)::int from public.teachers t
        where t.school_id = s.id and t.is_active and t.deleted_at is null) as teachers
  ) cnt on true

  left join lateral (
    select
      sum(i.total_amount - i.paid_amount) filter (
        where i.status in ('unpaid', 'partial')) as unpaid,
      (select count(*)::int from public.subscription_payments sp
        where sp.school_id = s.id and sp.status = 'pending') as pending
    from public.subscription_invoices i
    where i.school_id = s.id
  ) bill on true

  left join lateral (
    select count(*)::int as unread
      from public.support_threads th
      join public.support_messages m on m.thread_id = th.id
     where th.school_id = s.id
       and not m.from_platform
       and (th.platform_read_at is null or m.created_at > th.platform_read_at)
  ) msg on true

  -- Oxirgi faollik — audit jurnalining oxirgi yozuvi. Indeks
  -- (school_id, at desc) borligi uchun bu arzon so'rov.
  left join lateral (
    select max(a.at) as last_at
      from public.audit_log a
     where a.school_id = s.id
  ) act on true

  where s.deleted_at is null
  order by s.name;
end;
$function$;

revoke all on function public.platform_schools() from public, anon;
grant execute on function public.platform_schools() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_support_message(p_thread_id uuid, p_body text, p_file_path text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_platform boolean := app.is_platform_admin();
  v_user     uuid := (select auth.uid());
  v_thread   public.support_threads%rowtype;
  v_id       bigint;
begin
  if length(btrim(coalesce(p_body, ''))) < 1 then
    raise exception 'Xabar bo''sh bo''lishi mumkin emas' using errcode = '22023';
  end if;

  select * into v_thread from public.support_threads where id = p_thread_id;
  if not found then
    raise exception 'Mavzu topilmadi' using errcode = 'P0002';
  end if;

  if not v_platform then
    if v_thread.school_id is distinct from app.school_id() then
      raise exception 'Bu yozishmaga kirish huquqi yo''q' using errcode = '42501';
    end if;
    if app.is_readonly_session() then
      raise exception 'Faqat o''qish rejimida yozib bo''lmaydi'
        using errcode = '42501';
    end if;
  end if;

  v_id := app.support_post(p_thread_id, v_thread.school_id, v_user,
                           v_platform, p_body, p_file_path, false);

  return jsonb_build_object('message_id', v_id, 'thread_id', p_thread_id);
end;
$function$;

revoke all on function public.post_support_message(p_thread_id uuid, p_body text, p_file_path text) from public, anon;
grant execute on function public.post_support_message(p_thread_id uuid, p_body text, p_file_path text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_subscription_payment(p_school_id uuid, p_amount numeric, p_paid_on date DEFAULT CURRENT_DATE, p_months integer DEFAULT 1, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid := app.require_platform_admin();
  v_pay   uuid;
  v_res   jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Summa noldan katta bo''lishi kerak' using errcode = '22023';
  end if;
  if p_months < 1 or p_months > 24 then
    raise exception 'Oylar soni 1 dan 24 gacha bo''lishi kerak' using errcode = '22023';
  end if;

  -- Qo'lda belgilangan to'lov ham CHEK JADVALIGA tushadi: maktab uni
  -- o'z panelida ko'rsin, "pulni to'ladim, tizimda yo'q" degan nizo
  -- chiqmasin.
  insert into public.subscription_payments
    (school_id, amount, paid_on, months, method, note,
     status, reviewed_by, reviewed_at)
  values
    (p_school_id, p_amount, p_paid_on, p_months, 'bank',
     coalesce(p_note, 'Platforma operatori qo''lda belgiladi'),
     'confirmed', v_admin, now())
  returning id into v_pay;

  v_res := app.apply_subscription_payment(p_school_id, p_amount, p_paid_on, p_months);

  perform app.plog('payment_recorded', 'subscription_payments',
                   v_pay::text, p_school_id, null,
                   jsonb_build_object('amount', p_amount, 'months', p_months,
                                      'paid_on', p_paid_on, 'admin_id', v_admin));

  return v_res || jsonb_build_object('payment_id', v_pay);
end;
$function$;

revoke all on function public.record_subscription_payment(p_school_id uuid, p_amount numeric, p_paid_on date, p_months integer, p_note text) from public, anon;
grant execute on function public.record_subscription_payment(p_school_id uuid, p_amount numeric, p_paid_on date, p_months integer, p_note text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_subscription_payment(p_payment_id uuid, p_approve boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid := app.require_platform_admin();
  v_pay   public.subscription_payments%rowtype;
  v_res   jsonb := '{}'::jsonb;
  v_thread uuid;
  v_text  text;
begin
  select * into v_pay from public.subscription_payments where id = p_payment_id;
  if not found then
    raise exception 'To''lov topilmadi' using errcode = 'P0002';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'Bu to''lov allaqachon ko''rib chiqilgan (%)', v_pay.status
      using errcode = '22023';
  end if;

  if not p_approve and (p_reason is null or length(btrim(p_reason)) < 5) then
    raise exception 'Rad etish sababi ko''rsatilishi shart (kamida 5 belgi)'
      using errcode = '22023';
  end if;

  -- Enum ustuniga `case` yozilganda tur ANIQ ko'rsatilishi shart:
  -- shoxlaridagi literal `text` deb olinadi va Postgres 42804 beradi.
  update public.subscription_payments
     set status        = (case when p_approve then 'confirmed' else 'rejected' end)
                           ::public.subscription_payment_status,
         reviewed_by   = v_admin,
         reviewed_at   = now(),
         reject_reason = case when p_approve then null else btrim(p_reason) end
   where id = p_payment_id;

  if p_approve then
    v_res := app.apply_subscription_payment(
               v_pay.school_id, v_pay.amount, v_pay.paid_on, v_pay.months);
    v_text := 'To''lov tasdiqlandi. Obuna '
              || (v_res ->> 'next_payment_date') || ' gacha uzaytirildi.';
  else
    v_text := 'To''lov rad etildi. Sabab: ' || btrim(p_reason);
  end if;

  -- Maktabga xabar — yozishma orqali. Chek bilan ochilgan mavzu bo'lsa
  -- o'shanga, bo'lmasa yangisi ochiladi.
  select id into v_thread
    from public.support_threads
   where payment_id = p_payment_id
   order by created_at
   limit 1;

  if v_thread is null then
    insert into public.support_threads
      (school_id, subject, opened_by, opened_by_platform, payment_id)
    values
      (v_pay.school_id, 'Obuna to''lovi', v_admin, true, p_payment_id)
    returning id into v_thread;
  end if;

  perform app.support_post(v_thread, v_pay.school_id, v_admin, true,
                           v_text, null, true);

  perform app.plog(
    case when p_approve then 'payment_approved' else 'payment_rejected' end,
    'subscription_payments', p_payment_id::text, v_pay.school_id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', case when p_approve then 'confirmed' else 'rejected' end,
                       'amount', v_pay.amount, 'reason', btrim(coalesce(p_reason, '')),
                       'admin_id', v_admin));

  return v_res || jsonb_build_object('payment_id', p_payment_id,
                                     'approved', p_approve,
                                     'thread_id', v_thread);
end;
$function$;

revoke all on function public.review_subscription_payment(p_payment_id uuid, p_approve boolean, p_reason text) from public, anon;
grant execute on function public.review_subscription_payment(p_payment_id uuid, p_approve boolean, p_reason text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_billing_cycle()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_lead     int := coalesce(app.billing_num('billing.invoice_lead_days'), 5)::int;
  r          record;
  v_res      jsonb;
  v_invoiced int := 0;
  v_changed  int := 0;
  v_errors   int := 0;
  v_msg      text;
begin
  if not (app.is_service_context() or app.is_platform_admin()) then
    raise exception 'Bu amal faqat platforma operatori uchun'
      using errcode = '42501';
  end if;

  for r in
    select s.id, s.name, s.status as school_status,
           sub.status as sub_status, sub.next_payment_date, sub.trial_ends_at
      from public.schools s
      join public.school_subscriptions sub on sub.school_id = s.id
     where s.deleted_at is null
       and s.status <> 'archived'
       and sub.status <> 'cancelled'
     order by s.name
  loop
    begin
      -- --- Hisob-faktura ------------------------------------------
      --  Muddat yaqinlashganda chiqariladi. Sinovdagi maktabga
      --  chiqarilmaydi — sinov tugagach birinchi hisob-faktura
      --  o'z-o'zidan keladi.
      if r.next_payment_date is not null
         and r.next_payment_date <= current_date + v_lead
         and not (r.sub_status = 'trial'
                  and r.trial_ends_at is not null
                  and r.trial_ends_at >= current_date)
      then
        v_res := public.issue_subscription_invoice(
                   r.id, date_trunc('month', r.next_payment_date)::date);
        if (v_res ->> 'created')::boolean then
          v_invoiced := v_invoiced + 1;
          perform app.notify_school(r.id,
            'Yangi hisob-faktura chiqarildi. Summa: '
            || trim(to_char((v_res ->> 'total')::numeric, '999G999G999'))
            || ' so''m. To''lov muddati: '
            || to_char((v_res ->> 'due_date')::date, 'DD.MM.YYYY') || '.');
        end if;
      end if;

      -- --- Holat zinapoyasi ----------------------------------------
      v_res := app.recompute_school_billing(r.id);

      if (v_res ->> 'changed')::boolean then
        v_changed := v_changed + 1;

        v_msg := case v_res ->> 'status'
          when 'active' then
            'To''lov qabul qilindi — maktab to''liq ishlashga qaytdi.'
          when 'restricted' then
            'To''lov ' || (v_res ->> 'overdue_days')
            || ' kun kechikdi. Maktab FAQAT O''QISH rejimiga o''tdi: '
            || 'ma''lumot joyida, lekin yangi yozuv kiritib bo''lmaydi. '
            || 'To''lovdan keyin hammasi darhol tiklanadi.'
          when 'suspended' then
            'To''lov ' || (v_res ->> 'overdue_days')
            || ' kun kechikdi. Maktab VAQTINCHA TO''XTATILDI. '
            || 'Ma''lumotingiz saqlanmoqda va hech narsa yo''qolmaydi. '
            || 'Chekni yuborganingizdan va u tasdiqlangandan keyin '
            || 'hamma narsa avvalgidek ishlaydi.'
          else null
        end;

        if v_msg is not null then
          perform app.notify_school(r.id, v_msg);
        end if;
      end if;

    exception when others then
      v_errors := v_errors + 1;
      raise notice 'To''lov sikli xatosi (%): %', r.name, sqlerrm;
    end;
  end loop;

  perform app.plog('billing_cycle_run', 'schools', null, null, null,
                   jsonb_build_object('invoiced', v_invoiced,
                                      'changed', v_changed,
                                      'errors', v_errors));

  return jsonb_build_object('ran_at', now(), 'invoiced', v_invoiced,
                            'changed', v_changed, 'errors', v_errors);
end;
$function$;

revoke all on function public.run_billing_cycle() from public, anon;
grant execute on function public.run_billing_cycle() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.school_price(p_school_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_base        numeric := coalesce(app.billing_num('billing.base_monthly'), 500000);
  v_branch      numeric := coalesce(app.billing_num('billing.branch_price'), 450000);
  v_per_branch  int     := coalesce(app.billing_num('billing.students_per_branch'), 250)::int;
  v_step        int     := coalesce(app.billing_num('billing.student_step'), 50)::int;
  v_step_price  numeric := coalesce(app.billing_num('billing.student_step_price'), 50000);
  v_setup       numeric := coalesce(app.billing_num('billing.setup_fee'), 600000);

  v_branches    int;
  v_students    int;
  v_included    int;
  v_extra       int;
  v_steps       int;
  v_first       boolean;
begin
  -- Maktab o'zining narxini ko'ra oladi, super admin — hammasini.
  if not (app.is_platform_admin()
          or app.is_service_context()
          or p_school_id = app.school_id()) then
    raise exception 'Bu maktab narxini ko''rish huquqi yo''q'
      using errcode = '42501';
  end if;

  select count(*) into v_branches
    from public.branches
   where school_id = p_school_id and is_active and deleted_at is null;

  select count(*) into v_students
    from public.students
   where school_id = p_school_id and status = 'active' and deleted_at is null;

  -- Filialsiz maktab bo'lmaydi, lekin nolga bo'lish xavfini yopamiz.
  v_branches := greatest(v_branches, 1);

  v_included := v_branches * v_per_branch;
  v_extra    := greatest(0, v_students - v_included);
  v_steps    := ceil(v_extra::numeric / v_step)::int;

  -- Ulanish to'lovi faqat BIRINCHI hisob-fakturada.
  select not exists (
    select 1 from public.subscription_invoices
     where school_id = p_school_id and status <> 'void'
  ) into v_first;

  return jsonb_build_object(
    'school_id',            p_school_id,
    'branches_count',       v_branches,
    'branches_extra',       v_branches - 1,
    'branches_amount',      (v_branches - 1) * v_branch,
    'students_count',       v_students,
    'students_included',    v_included,
    'students_extra',       v_extra,
    'students_extra_steps', v_steps,
    'students_amount',      v_steps * v_step_price,
    'base_amount',          v_base,
    'monthly_total',        v_base + (v_branches - 1) * v_branch + v_steps * v_step_price,
    'setup_fee',            case when v_first then v_setup else 0 end,
    'is_first_invoice',     v_first,
    'params', jsonb_build_object(
      'base_monthly',        v_base,
      'branch_price',        v_branch,
      'students_per_branch', v_per_branch,
      'student_step',        v_step,
      'student_step_price',  v_step_price,
      'setup_fee',           v_setup)
  );
end;
$function$;

revoke all on function public.school_price(p_school_id uuid) from public, anon;
grant execute on function public.school_price(p_school_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.school_users(p_school_id uuid)
 RETURNS TABLE(id uuid, full_name text, role user_role, email text, phone text, is_active boolean, last_sign_in timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id, u.full_name, u.role, u.email::text, u.phone, u.is_active,
         au.last_sign_in_at
    from public.app_users u
    left join auth.users au on au.id = u.id
   where u.school_id = p_school_id
     and u.deleted_at is null
     and app.is_platform_admin()
   order by u.is_active desc, u.full_name;
$function$;

revoke all on function public.school_users(p_school_id uuid) from public, anon;
grant execute on function public.school_users(p_school_id uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_platform_setting(p_key text, p_value jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid := app.require_platform_admin();
  v_old   jsonb;
begin
  select value into v_old from public.platform_settings where key = p_key;
  if not found then
    raise exception 'Sozlama topilmadi: %', p_key using errcode = 'P0002';
  end if;

  update public.platform_settings set value = p_value where key = p_key;

  perform app.plog('setting_changed', 'platform_settings', p_key, null,
                   jsonb_build_object('value', v_old),
                   jsonb_build_object('value', p_value,
                                      'reason', btrim(coalesce(p_reason, '')),
                                      'admin_id', v_admin));

  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$function$;

revoke all on function public.set_platform_setting(p_key text, p_value jsonb, p_reason text) from public, anon;
grant execute on function public.set_platform_setting(p_key text, p_value jsonb, p_reason text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_school_plan(p_school_id uuid, p_plan_code text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin  uuid := app.require_platform_admin();
  v_plan   public.plans%rowtype;
  v_sub    public.school_subscriptions%rowtype;
  v_price  numeric;
begin
  select * into v_plan from public.plans where code = p_plan_code and is_active;
  if not found then
    raise exception 'Tarif topilmadi: %', p_plan_code using errcode = 'P0002';
  end if;

  select * into v_sub
    from public.school_subscriptions
   where school_id = p_school_id and status <> 'cancelled'
   limit 1;
  if not found then
    raise exception 'Maktabda faol obuna yo''q' using errcode = 'P0002';
  end if;

  v_price := (public.school_price(p_school_id) ->> 'monthly_total')::numeric;

  update public.school_subscriptions
     set plan_id = v_plan.id,
         monthly_amount = v_price
   where id = v_sub.id;

  perform app.plog('school_plan_changed', 'school_subscriptions',
                   v_sub.id::text, p_school_id,
                   jsonb_build_object('plan_id', v_sub.plan_id,
                                      'monthly_amount', v_sub.monthly_amount),
                   jsonb_build_object('plan_id', v_plan.id,
                                      'plan_code', v_plan.code,
                                      'monthly_amount', v_price,
                                      'reason', btrim(coalesce(p_reason, '')),
                                      'admin_id', v_admin));

  return jsonb_build_object('school_id', p_school_id, 'plan_code', v_plan.code,
                            'monthly_amount', v_price);
end;
$function$;

revoke all on function public.set_school_plan(p_school_id uuid, p_plan_code text, p_reason text) from public, anon;
grant execute on function public.set_school_plan(p_school_id uuid, p_plan_code text, p_reason text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_school_status(p_school_id uuid, p_status school_status, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin uuid := app.require_platform_admin();
  v_old   public.school_status;
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'Sabab ko''rsatilishi shart (kamida 5 belgi)'
      using errcode = '22023';
  end if;

  select status into v_old from public.schools where id = p_school_id;
  if not found then
    raise exception 'Maktab topilmadi' using errcode = 'P0002';
  end if;

  if v_old = p_status then
    return jsonb_build_object('school_id', p_school_id, 'changed', false,
                              'status', p_status);
  end if;

  update public.schools set status = p_status where id = p_school_id;

  perform app.plog('school_status_changed', 'schools',
                   p_school_id::text, p_school_id,
                   jsonb_build_object('status', v_old),
                   jsonb_build_object('status', p_status,
                                      'reason', btrim(p_reason),
                                      'admin_id', v_admin));

  return jsonb_build_object('school_id', p_school_id, 'changed', true,
                            'from', v_old, 'status', p_status);
end;
$function$;

revoke all on function public.set_school_status(p_school_id uuid, p_status school_status, p_reason text) from public, anon;
grant execute on function public.set_school_status(p_school_id uuid, p_status school_status, p_reason text) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_support_thread_status(p_thread_id uuid, p_status support_thread_status)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_platform boolean := app.is_platform_admin();
  v_thread   public.support_threads%rowtype;
begin
  select * into v_thread from public.support_threads where id = p_thread_id;
  if not found then
    raise exception 'Mavzu topilmadi' using errcode = 'P0002';
  end if;

  if not v_platform and v_thread.school_id is distinct from app.school_id() then
    raise exception 'Bu yozishmaga kirish huquqi yo''q' using errcode = '42501';
  end if;

  update public.support_threads
     set status    = p_status,
         closed_at = case when p_status = 'closed' then now() else null end
   where id = p_thread_id;

  return jsonb_build_object('thread_id', p_thread_id, 'status', p_status);
end;
$function$;

revoke all on function public.set_support_thread_status(p_thread_id uuid, p_status support_thread_status) from public, anon;
grant execute on function public.set_support_thread_status(p_thread_id uuid, p_status support_thread_status) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.start_impersonation(p_school_id uuid, p_target_user_id uuid, p_mode impersonation_mode DEFAULT 'read'::impersonation_mode, p_reason text DEFAULT NULL::text, p_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_admin   uuid := app.require_platform_admin();
  v_id      uuid;
  v_expires timestamptz;
  v_closed  int;
  v_target  record;
begin
  -- --- Sabab. `read` rejimida ham majburiy -------------------------
  --  Jadval cheklovi faqat `write` uchun talab qiladi, TZ esa har
  --  qanday sessiya uchun. Kuchliroq shartni funksiya qo'yadi.
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Sabab ko''rsatilishi shart (kamida 10 belgi)'
      using errcode = '22023';
  end if;

  if p_minutes < 5 or p_minutes > 120 then
    raise exception 'Sessiya muddati 5 dan 120 daqiqagacha bo''lishi kerak'
      using errcode = '22023';
  end if;

  -- --- Maqsadli foydalanuvchi AYNAN shu maktabdami ------------------
  select u.id, u.full_name, u.role, u.school_id
    into v_target
    from public.app_users u
   where u.id = p_target_user_id
     and u.school_id = p_school_id
     and u.is_active
     and u.deleted_at is null;

  if not found then
    raise exception 'Foydalanuvchi bu maktabda topilmadi yoki faol emas'
      using errcode = 'P0002';
  end if;

  -- --- Bitta adminda bitta faol sessiya ----------------------------
  --  Ikkita ochiq sessiya bo'lsa, hook `order by started_at desc`
  --  bilan oxirgisini oladi va admin qaysi maktabda ishlayotganini
  --  bilmay qoladi. Eskisi jimgina yopiladi va jurnalga tushadi.
  update public.impersonation_sessions
     set ended_at = now()
   where admin_id = v_admin and ended_at is null;
  get diagnostics v_closed = row_count;

  if v_closed > 0 then
    insert into public.impersonation_log
      (admin_id, school_id, mode, action, detail)
    values
      (v_admin, p_school_id, p_mode, 'auto_closed_previous',
       jsonb_build_object('count', v_closed));
  end if;

  v_expires := now() + (p_minutes * interval '1 minute');

  insert into public.impersonation_sessions
    (admin_id, school_id, target_user_id, mode, reason, expires_at)
  values
    (v_admin, p_school_id, p_target_user_id, p_mode, btrim(p_reason), v_expires)
  returning id into v_id;

  -- --- Ikkita jurnal (TZ 2.5 §2) ------------------------------------
  insert into public.impersonation_log
    (session_id, admin_id, school_id, target_user_id, mode, action, detail)
  values
    (v_id, v_admin, p_school_id, p_target_user_id, p_mode, 'session_started',
     jsonb_build_object('reason', btrim(p_reason),
                        'minutes', p_minutes,
                        'target_name', v_target.full_name,
                        'target_role', v_target.role));

  perform app.plog('impersonation_started', 'impersonation_sessions',
                   v_id::text, p_school_id, null,
                   jsonb_build_object('mode', p_mode,
                                      'reason', btrim(p_reason),
                                      'target_user_id', p_target_user_id,
                                      'expires_at', v_expires));

  return jsonb_build_object(
    'session_id',     v_id,
    'school_id',      p_school_id,
    'target_user_id', p_target_user_id,
    'target_name',    v_target.full_name,
    'mode',           p_mode,
    'expires_at',     v_expires,
    'closed_previous', v_closed);
end;
$function$;

revoke all on function public.start_impersonation(p_school_id uuid, p_target_user_id uuid, p_mode impersonation_mode, p_reason text, p_minutes integer) from public, anon;
grant execute on function public.start_impersonation(p_school_id uuid, p_target_user_id uuid, p_mode impersonation_mode, p_reason text, p_minutes integer) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_subscription_payment(p_amount numeric, p_paid_on date, p_months integer DEFAULT 1, p_method text DEFAULT 'bank'::text, p_file_path text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_school uuid := app.school_id();
  v_user   uuid := (select auth.uid());
  v_id     uuid;
  v_thread uuid;
begin
  if v_school is null then
    raise exception 'Maktab konteksti topilmadi' using errcode = '42501';
  end if;

  -- Faqat direktor darajasidagi huquq. Buxgalter obuna to'lovini
  -- yubormaydi — bu maktab bilan ijrochi o'rtasidagi shartnoma.
  if not app.can('users.manage') then
    raise exception 'Obuna to''lovini yuborish huquqi yo''q'
      using errcode = '42501';
  end if;

  -- Texnik yordam sessiyasida o'qish rejimida — yo'q.
  if app.is_readonly_session() then
    raise exception 'Faqat o''qish rejimida yozib bo''lmaydi'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Summa noldan katta bo''lishi kerak' using errcode = '22023';
  end if;
  if p_paid_on > current_date then
    raise exception 'To''lov sanasi kelajakda bo''lishi mumkin emas'
      using errcode = '22023';
  end if;
  if p_months < 1 or p_months > 24 then
    raise exception 'Oylar soni 1 dan 24 gacha bo''lishi kerak' using errcode = '22023';
  end if;

  insert into public.subscription_payments
    (school_id, amount, paid_on, months, method, file_path, note,
     status, submitted_by)
  values
    (v_school, p_amount, p_paid_on, p_months, p_method, p_file_path,
     p_note, 'pending', v_user)
  returning id into v_id;

  -- Chek bilan birga yozishma mavzusi ochiladi: super admin savol
  -- bersa yozadigan joyi bo'lsin, maktab esa javobni ko'rsin.
  insert into public.support_threads
    (school_id, subject, opened_by, opened_by_platform, payment_id, priority)
  values
    (v_school, 'Obuna to''lovi — ' || to_char(p_paid_on, 'DD.MM.YYYY'),
     v_user, false, v_id, 'normal')
  returning id into v_thread;

  perform app.support_post(
    v_thread, v_school, v_user, false,
    'To''lov cheki yuborildi. Summa: ' || trim(to_char(p_amount, '999G999G999'))
      || '. Sana: ' || to_char(p_paid_on, 'DD.MM.YYYY')
      || '. Davr: ' || p_months || ' oy.',
    p_file_path, true);

  perform app.plog('payment_submitted', 'subscription_payments',
                   v_id::text, v_school, null,
                   jsonb_build_object('amount', p_amount, 'paid_on', p_paid_on,
                                      'months', p_months));

  return jsonb_build_object('payment_id', v_id, 'thread_id', v_thread,
                            'status', 'pending');
end;
$function$;

revoke all on function public.submit_subscription_payment(p_amount numeric, p_paid_on date, p_months integer, p_method text, p_file_path text, p_note text) from public, anon;
grant execute on function public.submit_subscription_payment(p_amount numeric, p_paid_on date, p_months integer, p_method text, p_file_path text, p_note text) to authenticated, service_role;
