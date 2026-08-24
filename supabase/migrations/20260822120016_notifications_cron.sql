-- =====================================================================
--  16 — AVTOMATIK XABARLAR VA REJALASHTIRILGAN VAZIFALAR (TZ 4.9)
--
--  TZ 4.9 jadvalidagi beshta voqea:
--    · Hisoblanma shakllantirildi   → invoice_created
--    · Yakuniy hisoblanma tayyor    → invoice_final
--    · Muddatga 3 kun qoldi         → due_soon
--    · Muddat o'tdi                 → overdue
--    · To'lov qabul qilindi         → payment_received  (12-migratsiyada)
--
--  TZ 4.9.3 — "Xabar yuborish vaqti sozlanadi (ish vaqtidan tashqarida
--  yubormaslik)". Shuning uchun hech bir xabar to'g'ridan-to'g'ri
--  yuborilmaydi: u `scheduled_at` bilan navbatga qo'yiladi.
-- =====================================================================

-- Takroriy eslatmani oldini olish uchun.
alter table public.invoices
  add column if not exists notified_at      timestamptz,
  add column if not exists due_soon_sent_at timestamptz,
  add column if not exists overdue_sent_at  timestamptz;

comment on column public.invoices.due_soon_sent_at is
  'TZ 4.9 — "muddatga 3 kun qoldi" eslatmasi yuborilgan vaqt. '
  'Bir hisoblanma uchun bir marta.';

-- =====================================================================
--  XABAR YUBORISH VAQTI (TZ 4.9.3)
--
--  Sozlama: messaging.quiet_hours = {"from": 20, "to": 8}
--  Ya'ni 20:00 dan 08:00 gacha xabar yuborilmaydi — ertalabki
--  birinchi ruxsat etilgan vaqtga suriladi. Vaqt MAKTAB MINTAQASIDA
--  hisoblanadi (schools.timezone).
-- =====================================================================

create or replace function app.next_send_time(p_school_id uuid)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz     text;
  v_quiet  jsonb;
  v_from   int;
  v_to     int;
  v_local  timestamptz := now();
  v_hour   int;
  v_target timestamptz;
begin
  select timezone into v_tz from public.schools where id = p_school_id;
  v_tz := coalesce(v_tz, 'Asia/Tashkent');

  v_quiet := app.school_setting(p_school_id, 'messaging.quiet_hours',
                                '{"from":20,"to":8}'::jsonb);
  v_from := coalesce((v_quiet ->> 'from')::int, 20);
  v_to   := coalesce((v_quiet ->> 'to')::int, 8);

  v_hour := extract(hour from (now() at time zone v_tz))::int;

  -- Sukut vaqtidan tashqarida — darhol yuborish mumkin.
  if v_from = v_to then
    return v_local;
  elsif v_from < v_to then
    if v_hour < v_from or v_hour >= v_to then return v_local; end if;
  else
    -- Kechadan ertalabgacha (masalan 20 → 8).
    if v_hour >= v_to and v_hour < v_from then return v_local; end if;
  end if;

  -- Sukut vaqti ichida — keyingi ruxsat etilgan soatga suramiz.
  v_target := date_trunc('day', now() at time zone v_tz)
              + make_interval(hours => v_to);

  if v_target <= (now() at time zone v_tz) then
    v_target := v_target + interval '1 day';
  end if;

  return v_target at time zone v_tz;
end;
$$;

comment on function app.next_send_time(uuid) is
  'TZ 4.9.3 — ish vaqtidan tashqarida xabar yubormaslik. Sukut '
  'vaqtida bo''lsa keyingi ruxsat etilgan soatni qaytaradi.';

-- =====================================================================
--  1. HISOBLANMA XABARI (TZ 4.9 — "Hisoblanma shakllantirildi")
-- =====================================================================

create or replace function public.notify_invoices(
  p_branch_id uuid,
  p_period    date,
  p_final     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_sent  int := 0;
  v_when  timestamptz;
  v_school uuid;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  perform app.assert_may_write('invoices.generate');
  perform app.assert_branch(p_branch_id);

  v_when := app.next_send_time(v_school);

  for r in
    select t.invoice_id, t.student_id, t.total, t.due_date, s.payment_code
      from public.v_invoice_totals t
      join public.students s on s.id = t.student_id
     where t.branch_id = p_branch_id
       and t.period = date_trunc('month', p_period)::date
       and t.status <> 'cancelled'
       and (case when p_final
                 then (select i.notified_at from public.invoices i where i.id = t.invoice_id) is not null
                 else true end)
  loop
    perform app.enqueue_for_student(
      r.student_id,
      case when p_final then 'invoice_final' else 'invoice_created' end,
      jsonb_build_object(
        'period',  to_char(p_period, 'MM.YYYY'),
        'total',   to_char(r.total, 'FM999G999G999G990'),
        'due',     to_char(r.due_date, 'DD.MM.YYYY'),
        'code',    r.payment_code),
      v_when);

    update public.invoices set notified_at = now() where id = r.invoice_id;
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('queued', v_sent, 'scheduled_at', v_when);
end;
$$;

comment on function public.notify_invoices(uuid, date, boolean) is
  'TZ 4.9 — hisoblanma xabarini navbatga qo''yadi. TZ 4.6.1.1 — '
  'dastlabki va yakuniy summa alohida shablon bilan ajratiladi.';

-- =====================================================================
--  2. QARZDORLIK ESLATMALARI (TZ 4.9)
--
--  Kunlik cron chaqiradi. Ikkita voqea:
--    · Muddatga N kun qoldi (sozlama: messaging.reminder_days_before)
--    · Muddat o'tdi
-- =====================================================================

create or replace function public.send_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_days   int;
  v_when   timestamptz;
  v_soon   int := 0;
  v_over   int := 0;
begin
  if not app.is_service_context() then
    raise exception 'Bu funksiya faqat rejalashtirilgan vazifa uchun'
      using errcode = '42501';
  end if;

  -- --- Muddatga N kun qoldi ----------------------------------------
  for r in
    select i.id, i.school_id, i.student_id, i.due_date, t.total, s.payment_code,
           bal.balance
      from public.invoices i
      join public.v_invoice_totals t on t.invoice_id = i.id
      join public.students s on s.id = i.student_id
      join public.v_student_balances bal on bal.student_id = i.student_id
     where i.status in ('preliminary', 'final', 'approved')
       and i.due_soon_sent_at is null
       and bal.balance > 0
       and i.due_date >= current_date
  loop
    v_days := coalesce(
      (app.school_setting(r.school_id, 'messaging.reminder_days_before',
                          '3'::jsonb) #>> '{}')::int, 3);

    if r.due_date = current_date + v_days then
      v_when := app.next_send_time(r.school_id);
      perform app.enqueue_for_student(
        r.student_id, 'due_soon',
        jsonb_build_object(
          'days',    v_days,
          'due',     to_char(r.due_date, 'DD.MM.YYYY'),
          'balance', to_char(r.balance, 'FM999G999G999G990'),
          'code',    r.payment_code),
        v_when);
      update public.invoices set due_soon_sent_at = now() where id = r.id;
      v_soon := v_soon + 1;
    end if;
  end loop;

  -- --- Muddat o'tdi -------------------------------------------------
  for r in
    select i.id, i.school_id, i.student_id, i.due_date, s.payment_code, bal.balance
      from public.invoices i
      join public.students s on s.id = i.student_id
      join public.v_student_balances bal on bal.student_id = i.student_id
     where i.status in ('preliminary', 'final', 'approved')
       and i.overdue_sent_at is null
       and i.due_date < current_date
       and bal.balance > 0
  loop
    v_when := app.next_send_time(r.school_id);
    perform app.enqueue_for_student(
      r.student_id, 'overdue',
      jsonb_build_object(
        'due',     to_char(r.due_date, 'DD.MM.YYYY'),
        'days',    (current_date - r.due_date),
        'balance', to_char(r.balance, 'FM999G999G999G990'),
        'code',    r.payment_code),
      v_when);
    update public.invoices set overdue_sent_at = now() where id = r.id;
    v_over := v_over + 1;
  end loop;

  return jsonb_build_object('due_soon', v_soon, 'overdue', v_over);
end;
$$;

comment on function public.send_due_reminders() is
  'TZ 4.9 — "Muddatga 3 kun qoldi" va "Muddat o''tdi" eslatmalari. '
  'Har bir hisoblanma uchun bir martadan.';

-- =====================================================================
--  3. YO'QLIK OGOHLANTIRISHI (TZ 4.5.6)
--
--  Kiritilmagan ish kunlarini aniqlaydi. Natija buxgalter va
--  navbatchining panelida ko'rinadi.
-- =====================================================================

create or replace function public.pending_absence_warnings(
  p_branch_id uuid default null,
  p_days_back int default 7
)
returns table (branch_id uuid, branch_name text, day date, class_name text)
language sql
stable
as $$
  select b.id, b.name, g.day, g.class_name
    from public.branches b
   cross join lateral app.absence_gaps(
     b.id, current_date - p_days_back, current_date - 1) g
   where b.deleted_at is null
     and b.is_active
     and (p_branch_id is null or b.id = p_branch_id)
   order by g.day desc, b.name, g.class_name;
$$;

comment on function public.pending_absence_warnings(uuid, int) is
  'TZ 4.5.6 — yo''qlik kiritilmagan ish kunlari. Panelda ogohlantirish '
  'sifatida ko''rsatiladi.';

-- =====================================================================
--  4. EDGE FUNCTION CHAQIRISH (pg_net + Vault)
--
--  Cron Telegram xabarlarini yuborish uchun `queue-sender` Edge
--  Function'ni chaqiradi. URL va service_role kaliti KODDA EMAS —
--  Supabase Vault da saqlanadi (scripts/setup-secrets.mjs bilan
--  o'rnatiladi, repo'ga tushmaydi).
-- =====================================================================

create or replace function app.invoke_edge_function(
  p_name text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_id  bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key' limit 1;

  if v_url is null or v_key is null then
    raise notice 'Vault da project_url yoki service_role_key yo''q — % chaqirilmadi', p_name;
    return null;
  end if;

  select net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key),
    body    := p_body,
    timeout_milliseconds := 25000
  ) into v_id;

  return v_id;
end;
$$;

comment on function app.invoke_edge_function(text, jsonb) is
  'Cron uchun: Edge Function ni pg_net orqali chaqiradi. Kalitlar '
  'Vault da, kodda emas.';

revoke all on function app.invoke_edge_function(text, jsonb) from public, anon, authenticated;

-- =====================================================================
--  5. CRON JADVALLARI (TZ 5.1, 5.2)
--
--  Vaqtlar UTC da. Toshkent = UTC+5.
-- =====================================================================

do $do$
declare
  jobs text[][] := array[
    -- nomi,                    jadval,          buyruq
    ['maktab_queue_sender',     '* * * * *',
     'select app.invoke_edge_function(''queue-sender'', ''{}''::jsonb);'],

    -- 03:00 UTC = 08:00 Toshkent — ish kuni boshlanishidan oldin.
    ['maktab_cleanup',          '0 22 * * *',
     'select public.cleanup_expired_files();'],

    -- 04:00 UTC = 09:00 Toshkent — eslatmalar ish vaqtida yuborilsin.
    ['maktab_due_reminders',    '0 4 * * *',
     'select public.send_due_reminders();']
  ];
  i int;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron yo''q — vazifalar rejalashtirilmadi.';
    return;
  end if;

  for i in 1 .. array_length(jobs, 1) loop
    begin
      if exists (select 1 from cron.job where jobname = jobs[i][1]) then
        perform cron.unschedule(jobs[i][1]);
      end if;
      perform cron.schedule(jobs[i][1], jobs[i][2], jobs[i][3]);
      raise notice 'Cron rejalashtirildi: %', jobs[i][1];
    exception when others then
      raise notice 'Cron % rejalashtirilmadi: %', jobs[i][1], sqlerrm;
    end;
  end loop;
end $do$;

do $do$
declare f text;
begin
  foreach f in array array[
    'public.notify_invoices(uuid, date, boolean)',
    'public.pending_absence_warnings(uuid, int)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $do$;

revoke all on function public.send_due_reminders() from public, anon, authenticated;
grant execute on function public.send_due_reminders() to service_role;
grant execute on function app.next_send_time(uuid) to authenticated, service_role;
