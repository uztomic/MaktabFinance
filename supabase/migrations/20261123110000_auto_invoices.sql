-- =====================================================================
--  HISOBLANMA TO'LIQ AVTOMATIK
--
--  Mijoz talabi (2026-11-23): "dastur hammasini o'zi hisoblab, real
--  vaqtda ko'rsatib tursin". Qo'lda qadamlar (shakllantirish,
--  yakunlash, tasdiqlash) olib tashlandi — ularni tizim bajaradi.
--  Oyni yopish va ota-onaga eslatma panelda qoladi (Hisobotlar).
-- =====================================================================

-- 1. finalize_invoices: cron yakunlaganda davomat bo'shliqlari to'sqinlik qilmaydi.
CREATE OR REPLACE FUNCTION public.finalize_invoices(p_branch_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_school    uuid;
  v_period    date := date_trunc('month', p_period)::date;
  v_month_end date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_method    text;
  v_gaps      int;
  v_gap_list  text;

  r           record;
  v_qty       numeric(10,2);
  v_amount    numeric(14,2);
  v_diff      numeric(14,2);
  v_next_inv  uuid;
  v_finalized int := 0;
  v_carried   numeric(14,2) := 0;
begin
  select school_id into v_school from public.branches where id = p_branch_id;
  if v_school is null then
    raise exception 'Filial topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('invoices.generate');
  perform app.assert_branch(p_branch_id);
  perform app.assert_period_open(v_school, v_period, p_branch_id);

  -- --- TZ 4.6.1.2 — qayd etuv to'liqligini tekshirish ---------------
  select count(*), string_agg(distinct to_char(day, 'DD.MM') || ' ' || class_name, ', ')
    into v_gaps, v_gap_list
    from app.absence_gaps(p_branch_id, v_period, v_month_end);

  --  Avtomatik yakunlashda (cron) belgilanmagan kun = hamma kelgan
  --  (TZ 4.5 asosiy tamoyili). Qo'lda yakunlashda eski himoya qoladi.
  if v_gaps > 0 and not app.is_service_context() then
    raise exception
      'Yo''qlik qayd etuvi to''liq emas: % ta sinf-kun belgilanmagan (%). Qayta hisoblash TZ 4.6.1.2 ga ko''ra to''xtatildi.',
      v_gaps, left(v_gap_list, 300)
      using errcode = '23514';
  end if;

  -- TZ 4.6.1.3 — farqni ko'chirish usuli sozlamadan.
  v_method := coalesce(
    app.school_setting(v_school, 'billing.daily_diff_method', '"recalculate"'::jsonb) #>> '{}',
    'recalculate');

  for r in
    select l.id as line_id, l.invoice_id, l.service_id, l.unit_price, l.amount,
           i.student_id, i.branch_id, l.source
      from public.invoice_lines l
      join public.invoices i on i.id = l.invoice_id
     where i.branch_id = p_branch_id
       and i.period = v_period
       and i.status in ('preliminary', 'final')
       and l.is_preliminary
  loop
    v_qty := app.billable_days(
               r.student_id, r.service_id,
               greatest(v_period, (r.source ->> 'from')::date),
               least(v_month_end, (r.source ->> 'to')::date));
    v_amount := round(r.unit_price * v_qty, 2);
    v_diff := v_amount - r.amount;

    if v_method = 'carryover' and v_diff <> 0 then
      -- Joriy oy qatori o'zgarmaydi, farq keyingi oyga ko'chiriladi.
      select id into v_next_inv
        from public.invoices
       where student_id = r.student_id
         and period = (v_period + interval '1 month')::date
         and status <> 'cancelled';

      if v_next_inv is not null then
        insert into public.invoice_lines
          (school_id, invoice_id, kind, service_id, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (v_school, v_next_inv, 'carryover', r.service_id,
           'O''tgan oy tuzatuvi (' || to_char(v_period, 'MM.YYYY') || ')',
           1, v_diff, v_diff, 90,
           jsonb_build_object('from_period', v_period,
                              'from_line', r.line_id,
                              'actual_days', v_qty));
        v_carried := v_carried + v_diff;
      end if;

      -- Qator endi yakuniy deb belgilanadi (summasi o'zgarmadi).
      update public.invoice_lines
         set is_preliminary = false,
             source = r.source || jsonb_build_object(
               'stage', 'final', 'actual_days', v_qty,
               'diff_method', 'carryover', 'diff', v_diff)
       where id = r.line_id;
    else
      -- Joriy oy qatorining o'zi qayta hisoblanadi.
      update public.invoice_lines
         set quantity = v_qty,
             amount = v_amount,
             is_preliminary = false,
             description = replace(description, ' (dastlabki)', ''),
             source = r.source || jsonb_build_object(
               'stage', 'final', 'actual_days', v_qty,
               'diff_method', 'recalculate', 'diff', v_diff)
       where id = r.line_id;
    end if;
  end loop;

  update public.invoices
     set status = 'final', finalized_at = now()
   where branch_id = p_branch_id
     and period = v_period
     and status = 'preliminary';

  get diagnostics v_finalized = row_count;

  return jsonb_build_object(
    'period', v_period,
    'branch_id', p_branch_id,
    'finalized', v_finalized,
    'method', v_method,
    'carried_amount', v_carried);
end;
$function$;

-- =====================================================================
--  2. AVTOMATIK HISOB SIKLI
--
--  Har 10 daqiqada, har filial uchun:
--    a) JORIY OY — hisoblanmasi yo'q faol o'quvchi bo'lsa yoki biror
--       hisoblanma eskirgan bo'lsa (shartnoma, chegirma, xizmat
--       o'zgargan) — `generate_invoices` qayta ishga tushadi. U
--       dublikat yaratmaydi, tasdiqlanganiga tegmaydi, qo'lda
--       qo'shilgan chegirmani saqlaydi. Hech narsa o'zgarmagan bo'lsa
--       chaqirilmaydi — audit jurnali keraksiz yozuv bilan to'lmaydi.
--    b) O'TGAN OY — tasdiqlanmagan hisoblanma qolgan bo'lsa: yakunlash
--       (kunlik xizmatlar yo'qlik bo'yicha aniq hisoblanadi) va
--       tasdiqlash. Davr yopilgan bo'lsa tegilmaydi.
--
--  Maktab avtomatikani `invoices.auto_generate` sozlamasi bilan
--  o'chira oladi (eski xatti-harakat saqlanadi).
-- =====================================================================

create or replace function public.run_monthly_invoices(
  p_period  date    default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_period   date;
  v_end      date;
  v_prev     date;
  v_res      jsonb;
  v_details  jsonb := '[]'::jsonb;
  v_need     boolean;
  v_made     int;
  v_runs     int := 0;
  v_closed   int := 0;
  v_failed   int := 0;
begin
  if not app.is_service_context() then
    raise exception 'Bu vazifani faqat tizim bajaradi' using errcode = '42501';
  end if;

  for r in
    select b.id as branch_id, b.school_id, b.name as branch_name,
           s.name as school_name,
           coalesce(s.timezone, 'Asia/Tashkent') as tz
      from public.branches b
      join public.schools  s on s.id = b.school_id
     where b.deleted_at is null and b.is_active
       and s.deleted_at is null
       and s.status in ('trial', 'active')
     order by s.name, b.name
  loop
    if app.school_setting(r.school_id, 'invoices.auto_generate',
                          'true'::jsonb) <> 'true'::jsonb then
      continue;
    end if;

    v_period := coalesce(p_period, date_trunc('month', (now() at time zone r.tz))::date);
    v_end    := (v_period + interval '1 month - 1 day')::date;
    v_prev   := (v_period - interval '1 month')::date;

    -- --- a) Joriy oy -------------------------------------------------
    if not app.period_is_closed(r.school_id, v_period, r.branch_id) then
      v_need :=
        exists (
          select 1
            from public.students st
            join public.contracts c on c.student_id = st.id and c.is_active
           where st.branch_id = r.branch_id
             and st.deleted_at is null
             and st.status = 'active'
             and c.starts_on <= v_end
             and coalesce(c.ends_on, v_period) >= v_period
             and coalesce(st.enrolled_on, v_period) <= v_end
             and coalesce(st.left_on, v_end) >= v_period
             and app.is_billable_month(r.school_id, c.billing_months, v_period)
             and not exists (
               select 1 from public.invoices i
                where i.student_id = st.id and i.period = v_period
                  and i.status <> 'cancelled'))
        or exists (select 1 from public.stale_invoices(r.branch_id, v_period));

      if v_need and not p_dry_run then
        begin
          v_res  := public.generate_invoices(r.branch_id, v_period);
          v_made := coalesce((v_res ->> 'created')::int, 0);
          v_runs := v_runs + 1;
          v_details := v_details || jsonb_build_object(
            'branch', r.branch_name, 'period', v_period, 'generate', v_res);

          if v_made > 0 then
            insert into public.school_settings (school_id, key, value, note)
            values (r.school_id, 'invoices.last_auto_run',
                    jsonb_build_object('period', v_period, 'at', now(),
                                       'branch_id', r.branch_id, 'created', v_made),
                    'Avtomatik shakllantirish')
            on conflict (school_id, key) do update set value = excluded.value;
          end if;
        exception when others then
          v_failed := v_failed + 1;
          v_details := v_details || jsonb_build_object(
            'branch', r.branch_name, 'period', v_period, 'error', sqlerrm);
        end;
      end if;
    end if;

    -- --- b) O'tgan oy: yakunlash va tasdiqlash ----------------------
    if p_period is null
       and not app.period_is_closed(r.school_id, v_prev, r.branch_id)
       and exists (select 1 from public.invoices i
                    where i.branch_id = r.branch_id and i.period = v_prev
                      and i.status in ('preliminary', 'final'))
       and not p_dry_run then
      begin
        if exists (select 1 from public.invoices i
                    where i.branch_id = r.branch_id and i.period = v_prev
                      and i.status = 'preliminary') then
          perform public.finalize_invoices(r.branch_id, v_prev);
        end if;
        v_res := public.approve_invoices(r.branch_id, v_prev);
        v_closed := v_closed + 1;
        v_details := v_details || jsonb_build_object(
          'branch', r.branch_name, 'period', v_prev, 'approve', v_res);
      exception when others then
        v_failed := v_failed + 1;
        v_details := v_details || jsonb_build_object(
          'branch', r.branch_name, 'period', v_prev, 'error', sqlerrm);
      end;
    end if;
  end loop;

  return jsonb_build_object('generated', v_runs, 'approved_months', v_closed,
                            'failed', v_failed, 'details', v_details);
end;
$$;

revoke all on function public.run_monthly_invoices(date, boolean)
  from public, anon, authenticated;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'maktab_monthly_invoices') then
    perform cron.unschedule('maktab_monthly_invoices');
  end if;
  perform cron.schedule('maktab_monthly_invoices', '*/10 * * * *',
                        'select public.run_monthly_invoices();');
exception when others then
  raise notice 'Cron rejalashtirilmadi: %', sqlerrm;
end $do$;

-- =====================================================================
--  3. YOPILGAN OYNI QAYTA OCHISH — FAQAT EGASI (direktor)
--
--  Ilgari yopilgan oyni hech kim ocha olmasdi. Endi faqat direktor,
--  SABAB yozib ochadi. O'chirish audit jurnaliga tushadi
--  (trg_closed_periods_audit) — kim, qachon, nega ochgani ko'rinadi.
--  Buxgalter, menejer va boshqalar ocha olmaydi.
-- =====================================================================

create or replace function public.unlock_period(
  p_period    date,
  p_branch_id uuid default null,
  p_reason    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_period date := date_trunc('month', p_period)::date;
  v_n      int;
begin
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;
  if app.role() is distinct from 'director' then
    raise exception 'Yopilgan oyni faqat direktor ochadi' using errcode = '42501';
  end if;
  if app.is_readonly_session() then
    raise exception 'Texnik yordam sessiyasi faqat o''qish rejimida' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sababni yozing' using errcode = '22023';
  end if;

  --  Sabab audit jurnaliga tushishi uchun avval yozuvga qo'shiladi.
  update public.closed_periods
     set note = coalesce(note || ' | ', '') || 'Ochildi: ' || btrim(p_reason)
   where school_id = v_school and period = v_period
     and branch_id is not distinct from p_branch_id;

  delete from public.closed_periods
   where school_id = v_school and period = v_period
     and branch_id is not distinct from p_branch_id;
  get diagnostics v_n = row_count;

  return jsonb_build_object('period', v_period, 'branch_id', p_branch_id,
                            'reopened', v_n > 0);
end;
$$;

revoke all on function public.unlock_period(date, uuid, text) from public, anon;
grant execute on function public.unlock_period(date, uuid, text)
  to authenticated, service_role;
