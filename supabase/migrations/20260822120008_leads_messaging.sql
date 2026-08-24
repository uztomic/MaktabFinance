-- =====================================================================
--  08 — MUROJAATLAR VA TELEGRAM XABAR NAVBATI (TZ 4.2, 4.9)
--
--  XABAR NAVBATI NEGA KERAK (TZ 4.9.1): Telegram sekundiga ~30 ta
--  xabar cheklovini qo'llaydi. 300 o'quvchiga hisoblanma xabarini
--  to'g'ridan-to'g'ri yuborish botni bloklanishga olib keladi.
--  Shuning uchun yuborish talabi navbatga yoziladi va alohida
--  rejalashtirilgan funksiya uni bo'lib-bo'lib qayta ishlaydi.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MUROJAATLAR (TZ 4.2)
-- ---------------------------------------------------------------------

create table if not exists public.leads (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id)  on delete restrict,
  branch_id        uuid not null references public.branches(id) on delete restrict,
  full_name        text not null,
  phone            text not null,
  -- Mo'ljallanayotgan sinf
  target_class     text,
  -- Murojaat manbasi: tavsiya, instagram, reklama, o'zi keldi...
  source           text,
  status           public.lead_status not null default 'new',
  -- TZ 4.2.2 — "Bugun bog'lanish kerak" filtri shu maydon bo'yicha.
  next_contact_on  date,
  note             text,
  assigned_to      uuid references public.app_users(id) on delete set null,
  -- TZ 4.2.3 — qabul qilinganda yaratilgan o'quvchi kartochkasi.
  student_id       uuid references public.students(id) on delete set null,
  created_by       uuid references public.app_users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.leads is
  'TZ 4.2 — maktabga qiziqib murojaat qilgan ota-onalar. Qabul qilinganda '
  'ma''lumot asosida o''quvchi kartochkasi AVTOMATIK yaratiladi (TZ 4.2.3), '
  'qayta kiritilmaydi.';

create index if not exists leads_status_idx on public.leads(branch_id, status);
-- TZ 4.2.2 — "Bugun bog'lanish kerak" filtri uchun.
create index if not exists leads_next_contact_idx on public.leads(school_id, next_contact_on)
  where status in ('new', 'contacted', 'visited');

select app.attach_touch_trigger('leads');

-- TZ 4.2.4 — har bir holat o'zgarishi kim va qachon qilgani bilan qayd etiladi.
create table if not exists public.lead_events (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  school_id   uuid not null,
  from_status public.lead_status,
  to_status   public.lead_status not null,
  note        text,
  changed_by  uuid references public.app_users(id) on delete set null,
  changed_at  timestamptz not null default now()
);

comment on table public.lead_events is
  'TZ 4.2.4 — murojaat holati tarixi. Faqat qo''shiladi.';

create index if not exists lead_events_lead_idx on public.lead_events(lead_id, changed_at desc);

-- Holat o'zgarishini avtomatik qayd etadi — qo'lda yozish unutilmaydi.
create or replace function app.log_lead_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_events (lead_id, school_id, from_status, to_status, changed_by)
    values (new.id, new.school_id, null, new.status, (select auth.uid()));
  elsif new.status is distinct from old.status then
    insert into public.lead_events (lead_id, school_id, from_status, to_status, changed_by)
    values (new.id, new.school_id, old.status, new.status, (select auth.uid()));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_status on public.leads;
create trigger trg_leads_status
  after insert or update of status on public.leads
  for each row execute function app.log_lead_status();

-- ---------------------------------------------------------------------
-- 2. TELEGRAM UPDATE DEDUPLIKATSIYASI (TZ 5.4.18)
--
--  Telegram javob olmasa AYNAN O'SHA update ni qayta yuboradi.
--  Bu jadval bo'lmasa bitta chek ikki marta qayd etilishi mumkin.
-- ---------------------------------------------------------------------

create table if not exists public.telegram_updates (
  update_id    bigint primary key,
  chat_id      bigint,
  received_at  timestamptz not null default now()
);

comment on table public.telegram_updates is
  'TZ 5.4.18 — qayta ishlangan update_id saqlanadi, takrori RAD ETILADI. '
  'Bu bo''lmasa Telegram qayta yuborgan xabar ikkinchi marta bajariladi.';

-- Eski yozuvlarni tozalash uchun (cleanup cron 7 kundan eskisini o'chiradi).
create index if not exists telegram_updates_received_idx
  on public.telegram_updates(received_at);

-- ---------------------------------------------------------------------
-- 3. BOT SUHBAT HOLATI
--
--  Ko'p bosqichli oqimlar uchun (telefon so'rash, farzand tanlash,
--  chek summasini kiritish).
-- ---------------------------------------------------------------------

create table if not exists public.telegram_sessions (
  chat_id     bigint primary key,
  parent_id   uuid references public.parents(id) on delete set null,
  state       text not null default 'idle',
  context     jsonb not null default '{}'::jsonb,
  lang        text  not null default 'uz'
              check (lang in ('uz', 'uz-cyrl', 'ru')),
  updated_at  timestamptz not null default now()
);

comment on table public.telegram_sessions is
  'Bot suhbat holati. parent_id bu yerda saqlansa ham, HAR BIR so''rovda '
  'ota-ona doirasi qaytadan tekshiriladi (TZ 5.4.15) — sessiyaga ishonilmaydi.';

-- ---------------------------------------------------------------------
-- 4. XABAR NAVBATI (TZ 4.9.1)
-- ---------------------------------------------------------------------

create table if not exists public.message_queue (
  id            bigint generated always as identity primary key,
  school_id     uuid not null references public.schools(id) on delete cascade,
  parent_id     uuid references public.parents(id) on delete set null,
  student_id    uuid references public.students(id) on delete set null,
  chat_id       bigint not null,
  -- TZ 5.6.2 / 4.9.5 — xabar ota-onaning TANLAGAN TILIDA yuboriladi.
  lang          text not null default 'uz'
                check (lang in ('uz', 'uz-cyrl', 'ru')),
  -- Tarjima kaliti va o'rnini bosuvchi qiymatlar. Matn yuborish
  -- paytida shakllantiriladi — til o'zgarsa eski navbat ham to'g'ri chiqadi.
  template_key  text not null,
  params        jsonb not null default '{}'::jsonb,
  -- Tayyor matn (yuborilgandan keyin to'ldiriladi) — jurnal uchun (TZ 4.9.4).
  body          text,
  status        public.message_status not null default 'pending',
  attempts      smallint not null default 0,
  last_error    text,
  -- TZ 4.9.3 — ish vaqtidan tashqarida yubormaslik.
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.message_queue is
  'TZ 4.9.1 — ommaviy yuborish TO''G''RIDAN-TO''G''RI bajarilmaydi. '
  'queue-sender cron navbatni bo''lib-bo''lib qayta ishlaydi.';
comment on column public.message_queue.status is
  'blocked = foydalanuvchi botni bloklagan. TAKROR URINILMAYDI (TZ 4.9.1.5).';
comment on column public.message_queue.scheduled_at is
  'TZ 4.9.3 — shu vaqtdan oldin yuborilmaydi (ish vaqti chegarasi).';

-- Yuboruvchi shu indeks bo'yicha oladi.
create index if not exists message_queue_ready_idx
  on public.message_queue(scheduled_at)
  where status = 'pending';
create index if not exists message_queue_school_idx
  on public.message_queue(school_id, created_at desc);

-- TZ 4.9.4 — yetkazilmagan xabarlarni ko'rish uchun.
create index if not exists message_queue_failed_idx
  on public.message_queue(school_id, status)
  where status in ('failed', 'blocked');

-- ---------------------------------------------------------------------
-- 5. XABARNI NAVBATGA QO'YISH
--
--  Barcha modul shu funksiya orqali xabar yuboradi — hech qayerda
--  to'g'ridan-to'g'ri Telegram API chaqirilmaydi.
-- ---------------------------------------------------------------------

create or replace function app.enqueue_message(
  p_school_id    uuid,
  p_parent_id    uuid,
  p_student_id   uuid,
  p_template_key text,
  p_params       jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.parents%rowtype;
  v_id     bigint;
begin
  select * into v_parent from public.parents
   where id = p_parent_id and deleted_at is null and is_active;

  -- Telegram ga ulanmagan ota-onaga xabar navbatga qo'yilmaydi.
  if not found or v_parent.telegram_id is null then
    return null;
  end if;

  insert into public.message_queue
    (school_id, parent_id, student_id, chat_id, lang, template_key, params, scheduled_at)
  values
    (p_school_id, p_parent_id, p_student_id, v_parent.telegram_id,
     v_parent.lang, p_template_key, coalesce(p_params, '{}'::jsonb),
     coalesce(p_scheduled_at, now()))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.enqueue_message(uuid, uuid, uuid, text, jsonb, timestamptz) is
  'Xabarni navbatga qo''yishning YAGONA nuqtasi. Til ota-ona profilidan '
  'olinadi (TZ 4.9.5). Telegram ga ulanmagan ota-onaga qo''yilmaydi.';

-- O'quvchining barcha ota-onasiga xabar (TZ 4.3.2 — bir nechta ota-ona).
create or replace function app.enqueue_for_student(
  p_student_id   uuid,
  p_template_key text,
  p_params       jsonb default '{}'::jsonb,
  p_scheduled_at timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row   record;
begin
  for v_row in
    select sp.parent_id, s.school_id
      from public.student_parents sp
      join public.students s on s.id = sp.student_id
     where sp.student_id = p_student_id
       and s.deleted_at is null
  loop
    if app.enqueue_message(v_row.school_id, v_row.parent_id, p_student_id,
                           p_template_key, p_params, p_scheduled_at) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function app.enqueue_for_student(uuid, text, jsonb, timestamptz) is
  'O''quvchining barcha ota-onasiga xabar navbatga qo''yadi (TZ 4.3.2).';

grant execute on function
  app.enqueue_message(uuid, uuid, uuid, text, jsonb, timestamptz),
  app.enqueue_for_student(uuid, text, jsonb, timestamptz)
to authenticated, service_role;
