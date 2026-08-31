-- =====================================================================
--  XATO KIRITILGANNI TUZATISH: DARS, O'QITUVCHI, OYLIK
--
--  Uchala joyda ham bir xil bo'shliq bor edi — kiritish mumkin,
--  tuzatish mumkin emas:
--
--    · dars soati xato kiritilsa olib tashlab bo'lmasdi, oylik esa
--      aynan shu soatlarga tayanadi
--    · ishdan bo'shagan o'qituvchini ro'yxatdan olib bo'lmasdi
--    · hisoblangan oylikka bir martalik tuzatish (mukofot, jarima)
--      kirita bo'lmasdi
--
--  Hech qayerda yozuv JISMONAN o'chirilmaydi.
-- =====================================================================

-- =====================================================================
--  1. DARSNI BEKOR QILISH
--
--  `lessons` da DELETE siyosati yo'q va bo'lmaydi ham: o'tilgan dars
--  oylik hisobining asosi, uni izsiz yo'qotib bo'lmaydi. Shuning
--  uchun `deleted_at`.
-- =====================================================================

alter table public.lessons
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_reason text;

comment on column public.lessons.deleted_at is
  'Xato kiritilgan dars bekor qilingan vaqt. Yozuv saqlanadi — oylik '
  'qayta hisoblanganda nima o''zgarganini ko''rish uchun.';

create index if not exists lessons_active_idx
  on public.lessons (teacher_id, day)
  where deleted_at is null;

--  Soatlar yig'indisi — oylikning asosi.
create or replace function app.teacher_hours(
  p_teacher_id uuid, p_from date, p_to date
)
returns table (
  branch_id     uuid,
  held_hours    numeric,
  subst_hours   numeric,
  unheld_hours  numeric,
  unheld_detail jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.branch_id,
    coalesce(sum(l.hours) filter (where l.kind = 'held'), 0)        as held_hours,
    coalesce(sum(l.hours) filter (where l.kind = 'substituted'), 0) as subst_hours,
    coalesce(sum(l.hours) filter (where l.kind = 'not_held'), 0)    as unheld_hours,
    -- Sabab bo'yicha taqsimot — to'lash qoidasi sababga bog'liq
    -- (TZ 12.1.5: bayram boshqa, o'qituvchi kelmagani boshqa).
    coalesce((
      select jsonb_object_agg(t.reason, t.hours)
        from (
          select coalesce(l2.reason, 'unspecified') as reason,
                 sum(l2.hours) as hours
            from public.lessons l2
           where l2.teacher_id = p_teacher_id
             and l2.branch_id = l.branch_id
             and l2.day between p_from and p_to
             and l2.kind = 'not_held'
             and l2.deleted_at is null
           group by 1
        ) t
    ), '{}'::jsonb) as unheld_detail
  from public.lessons l
  where l.teacher_id = p_teacher_id
    and l.day between p_from and p_to
    and l.deleted_at is null
  group by l.branch_id;
$$;

-- =====================================================================
--  2. ISHDAN BO'SHATISH va O'CHIRISH — IKKI XIL NARSA
--
--  Bularni bitta amalga qo'shib yubormaslik kerak:
--
--    ISHDAN BO'SHATISH — haqiqiy voqea. Odam ishlagan, oylik olgan,
--    dars o'tgan. U ro'yxatdan yo'qolmaydi, "oldin ishlaganlar"
--    bo'limiga o'tadi. Ketgan sanasi va sababi yoziladi.
--
--    O'CHIRISH — yozuvning o'zi xato. Sinov uchun kiritilgan yoki
--    ikki marta qo'shilgan. Bunday yozuv ro'yxatlarda umuman
--    ko'rinmasligi kerak.
--
--  O'quvchilarda bu ajratma allaqachon bor edi (`status = expelled`
--  va `deleted_at`), o'qituvchilarda esa yo'q edi.
-- =====================================================================

alter table public.teachers
  add column if not exists left_on date,
  add column if not exists leave_reason text;

comment on column public.teachers.left_on is
  'Ishdan bo''shagan sana. To''ldirilgan bo''lsa — "oldin ishlaganlar" '
  'ro''yxatida. Yozuv o''chirilmaydi: o''tgan oylar oyligi va darslari '
  'unga bog''liq.';

-- ---------------------------------------------------------------------
--  Ishdan bo'shatish
--
--  Uchta narsa birga bajarilishi kerak, aks holda yarim holat qoladi:
--    · sinf rahbarligidan uziladi — aks holda sinfda ketgan odam
--      rahbar bo'lib turadi va davomat kimdan so'ralishi noma'lum
--    · tizimga kirish yopiladi — ishdan ketgan odam ertasiga ham
--      kira olmasligi kerak
--    · yozuv saqlanadi
-- ---------------------------------------------------------------------

create or replace function public.dismiss_teacher(
  p_teacher_id uuid,
  p_reason     text,
  p_left_on    date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t         public.teachers%rowtype;
  v_classes int := 0;
  v_user    boolean := false;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sabab ko''rsatilishi shart' using errcode = '22023';
  end if;

  select * into t from public.teachers
   where id = p_teacher_id and deleted_at is null;
  if not found then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('teachers.manage');

  update public.classes
     set teacher_id = null
   where teacher_id = p_teacher_id and deleted_at is null;
  get diagnostics v_classes = row_count;

  --  Auth yozuvi o'chirilmaydi — `app_users.is_active` kirishni
  --  to'sadi (AuthProvider shu bo'yicha tekshiradi).
  if t.user_id is not null then
    update public.app_users set is_active = false where id = t.user_id;
    v_user := true;
  end if;

  update public.teachers
     set is_active    = false,
         left_on      = p_left_on,
         leave_reason = btrim(p_reason)
   where id = p_teacher_id;

  return jsonb_build_object(
    'teacher_id',     p_teacher_id,
    'left_on',        p_left_on,
    'classes_freed',  v_classes,
    'login_disabled', v_user);
end;
$$;

comment on function public.dismiss_teacher(uuid, text, date) is
  'Ishdan bo''shatadi: sinf rahbarligidan uzadi, tizimga kirishini '
  'yopadi, ketgan sanasini yozadi. Yozuv "oldin ishlaganlar" da qoladi.';

grant execute on function public.dismiss_teacher(uuid, text, date)
  to authenticated;

-- ---------------------------------------------------------------------
--  Xato yozuvni o'chirish
--
--  Ishlagan odamni bu bilan o'chirib bo'lmaydi: oyligi yoki darsi
--  bo'lsa rad etiladi. Bunday odam ISHDAN BO'SHATILADI, chunki uning
--  moliyaviy izi bor va uni yashirish hisobotlarni buzadi.
-- ---------------------------------------------------------------------

create or replace function public.delete_teacher(
  p_teacher_id uuid,
  p_reason     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t         public.teachers%rowtype;
  v_payroll int;
  v_lessons int;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sabab ko''rsatilishi shart' using errcode = '22023';
  end if;

  select * into t from public.teachers
   where id = p_teacher_id and deleted_at is null;
  if not found then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('teachers.manage');

  select count(*) into v_payroll from public.payroll_runs
   where teacher_id = p_teacher_id and status <> 'cancelled';
  select count(*) into v_lessons from public.lessons
   where teacher_id = p_teacher_id and deleted_at is null;

  if v_payroll > 0 or v_lessons > 0 then
    raise exception
      'Bu o''qituvchining % ta oylik hisobi va % ta darsi bor — o''chirib bo''lmaydi. Ishdan bo''shatish kerak.',
      v_payroll, v_lessons
      using errcode = '42501';
  end if;

  update public.classes
     set teacher_id = null
   where teacher_id = p_teacher_id and deleted_at is null;

  if t.user_id is not null then
    update public.app_users set is_active = false where id = t.user_id;
  end if;

  update public.teachers
     set deleted_at   = now(),
         is_active    = false,
         leave_reason = btrim(p_reason)
   where id = p_teacher_id;

  return jsonb_build_object('teacher_id', p_teacher_id, 'deleted', true);
end;
$$;

comment on function public.delete_teacher(uuid, text) is
  'Xato kiritilgan yozuvni o''chiradi. Oyligi yoki darsi bo''lsa rad '
  'etadi — bunday odam ishdan bo''shatiladi, o''chirilmaydi.';

grant execute on function public.delete_teacher(uuid, text) to authenticated;

-- =====================================================================
--  3. OYLIKKA QO'LDA TUZATISH
--
--  Hisoblangan raqamlarni to'g'ridan-to'g'ri tahrirlash NOTO'G'RI
--  bo'lardi: ular formuladan kelib chiqadi va qayta hisoblaganda
--  baribir tiklanadi. Sababi boshqa bo'lsa — soat xato kiritilgan,
--  stavka noto'g'ri — o'sha SABABNI tuzatib qayta hisoblash kerak.
--
--  Lekin formulaga sig'maydigan holatlar bor: bir martalik mukofot,
--  jarima, o'tgan oydan qolgan tuzatish. Ular alohida qator bo'lib
--  qo'shiladi va qayta hisoblaganda O'CHMAYDI — `calc_payroll`
--  faqat o'zi yaratgan qatorlarni tozalaydi.
-- =====================================================================

create or replace function public.add_payroll_adjustment(
  p_run_id      uuid,
  p_description text,
  p_amount      numeric,
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        public.payroll_runs%rowtype;
  v_branch uuid;
  v_id     uuid;
begin
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Izoh ko''rsatilishi shart' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Summa noldan farqli bo''lishi kerak' using errcode = '22023';
  end if;

  select * into r from public.payroll_runs where id = p_run_id;
  if not found then
    raise exception 'Oylik hisobi topilmadi' using errcode = '22023';
  end if;
  if r.status <> 'draft' then
    --  Tasdiqlangan hisobga tegilmaydi (TZ 4.11.8): xarajat yozuvi
    --  allaqachon yaratilgan va u bilan mos kelmay qoladi. Avval
    --  bekor qilib, qayta hisoblash kerak.
    raise exception 'Faqat hisoblangan (tasdiqlanmagan) oylikka tuzatish kiritiladi'
      using errcode = '42501';
  end if;

  perform app.assert_may_write('payroll.manage');
  perform app.assert_period_open(r.school_id, r.period, null);

  select branch_id into v_branch
    from public.teacher_branches
   where teacher_id = r.teacher_id
   order by load_share desc limit 1;

  insert into public.payroll_lines
    (school_id, payroll_run_id, branch_id, source_kind, description,
     quantity, unit_price, amount, sort_order, source)
  values
    (r.school_id, p_run_id, v_branch, 'manual', btrim(p_description),
     1, p_amount, p_amount, 90,
     jsonb_build_object('manual', true, 'reason', nullif(btrim(p_reason), ''),
                        'by', (select auth.uid()), 'at', now()))
  returning id into v_id;

  return jsonb_build_object('line_id', v_id, 'amount', p_amount);
end;
$$;

comment on function public.add_payroll_adjustment(uuid, text, numeric, text) is
  'Oylikka qo''lda tuzatish qatori — mukofot, jarima, o''tgan oydan '
  'qolgan farq. Qayta hisoblaganda o''chmaydi.';

grant execute on function public.add_payroll_adjustment(uuid, text, numeric, text)
  to authenticated;

--  Tuzatishni olib tashlash. Faqat qo'lda qo'shilganini — hisoblangan
--  qatorga tegib bo'lmaydi.
create or replace function public.remove_payroll_adjustment(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run    uuid;
  v_school uuid;
  v_period date;
  v_kind   text;
  v_status public.payroll_status;
begin
  select l.payroll_run_id, l.school_id, l.source_kind, r.period, r.status
    into v_run, v_school, v_kind, v_period, v_status
    from public.payroll_lines l
    join public.payroll_runs r on r.id = l.payroll_run_id
   where l.id = p_line_id;

  if v_run is null then
    raise exception 'Qator topilmadi' using errcode = '22023';
  end if;

  --  Hisoblangan qatorga tegib bo'lmaydi: u formuladan kelib
  --  chiqadi va qayta hisoblaganda baribir tiklanadi.
  if v_kind <> 'manual' then
    raise exception 'Faqat qo''lda qo''shilgan tuzatishni olib tashlash mumkin'
      using errcode = '42501';
  end if;

  if v_status <> 'draft' then
    raise exception 'Tasdiqlangan oylikka tegib bo''lmaydi' using errcode = '42501';
  end if;

  perform app.assert_may_write('payroll.manage');
  perform app.assert_period_open(v_school, v_period, null);

  delete from public.payroll_lines where id = p_line_id;

  return jsonb_build_object('line_id', p_line_id, 'removed', true);
end;
$$;

comment on function public.remove_payroll_adjustment(uuid) is
  'Qo''lda qo''shilgan tuzatish qatorini olib tashlaydi. Hisoblangan '
  'qatorga tegmaydi.';

grant execute on function public.remove_payroll_adjustment(uuid) to authenticated;

-- =====================================================================
--  4. QAYTA HISOBLASH QO'LDA KIRITILGANNI O'CHIRMASIN
--
--  Ta'rif jonli bazadan olindi va faqat bitta qatori almashtirildi —
--  butun funksiyani qo'lda ko'chirib yozish xavfli: u katta va
--  vaqt o'tishi bilan boshqa migratsiyalarda ham o'zgargan.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.calc_payroll(p_teacher_id uuid, p_period date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  t             public.teachers%rowtype;
  v_period      date := date_trunc('month', p_period)::date;
  v_month_end   date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_from        date;
  v_to          date;
  v_run_id      uuid;
  v_primary_br  uuid;

  -- Sozlamalar (TZ 4.11.10 — hammasi bazadan)
  v_base_type   text;
  v_hours_norm  numeric;
  v_hour_price  numeric;
  v_cat_factors jsonb;
  v_cat_factor  numeric;
  v_subst_pct   numeric;
  v_unheld_pol  jsonb;
  v_allowances  jsonb;
  v_deductions  jsonb;
  v_rounding    jsonb;
  v_period_cfg  jsonb;
  v_snapshot    jsonb;

  h             record;
  a             jsonb;
  d             jsonb;
  al            record;
  ent           record;

  v_base        numeric(14,2) := 0;
  v_gross       numeric(14,2) := 0;
  v_sort        smallint := 0;
  v_val         numeric(14,2);
  v_hours_total numeric := 0;
  v_paid_pct    numeric;
  v_net         numeric(14,2);
  v_rounded     numeric(14,2);
begin
  select * into t from public.teachers where id = p_teacher_id and deleted_at is null;
  if not found then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payroll.manage');
  perform app.assert_period_open(t.school_id, v_period, null);

  -- --- Sozlamalarni o'qish ------------------------------------------
  v_period_cfg  := app.payroll_setting(t.school_id, 'period', v_period,
                     '{"start_day":1,"end_day":0}'::jsonb);
  --  Oylik turi HAR XODIMGA alohida bo'lishi mumkin.
  --
  --  Maktabda bir vaqtning o'zida qat'iy oylik oladigan sinf rahbari
  --  ham, soatbay ishlaydigan to'garak rahbari ham bo'ladi. Ilgari tur
  --  butun maktabga BITTA edi va ikkinchisining oyligi noto'g'ri
  --  chiqardi. O'qituvchi kartochkasida tanlanmagan bo'lsa — maktab
  --  sozlamasi ishlatiladi.
  v_base_type   := coalesce(
    nullif(t.base_type, ''),
    app.payroll_setting(t.school_id, 'base_type', v_period,
                        '"fixed"'::jsonb) #>> '{}');
  v_hours_norm  := (app.payroll_setting(t.school_id, 'hours_per_rate', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  v_hour_price  := (app.payroll_setting(t.school_id, 'hour_price', v_period,
                     '0'::jsonb) #>> '{}')::numeric;
  v_cat_factors := app.payroll_setting(t.school_id, 'category_factors', v_period, '{}'::jsonb);
  v_subst_pct   := (app.payroll_setting(t.school_id, 'substitution_percent', v_period,
                     '100'::jsonb) #>> '{}')::numeric;
  v_unheld_pol  := app.payroll_setting(t.school_id, 'unheld_lesson_policy', v_period, '{}'::jsonb);
  v_allowances  := app.payroll_setting(t.school_id, 'allowances', v_period, '[]'::jsonb);
  v_deductions  := app.payroll_setting(t.school_id, 'deductions', v_period, '[]'::jsonb);
  v_rounding    := app.payroll_setting(t.school_id, 'rounding', v_period,
                     '{"step":1,"mode":"nearest"}'::jsonb);

  -- TZ 12.1.10 — hisob davri qaysi sanadan qaysi sanagacha.
  v_from := v_period + ((v_period_cfg ->> 'start_day')::int - 1);
  v_to   := case when coalesce((v_period_cfg ->> 'end_day')::int, 0) = 0
                 then v_month_end
                 else v_period + ((v_period_cfg ->> 'end_day')::int - 1) end;

  -- TZ 12.1.3 — soat narxi toifa yoki stajga bog'liq bo'lishi mumkin.
  v_cat_factor := coalesce((v_cat_factors ->> coalesce(t.category, ''))::numeric, 1);

  v_snapshot := jsonb_build_object(
    'base_type', v_base_type, 'hours_per_rate', v_hours_norm,
    'hour_price', v_hour_price, 'category', t.category,
    'category_factor', v_cat_factor, 'substitution_percent', v_subst_pct,
    'unheld_lesson_policy', v_unheld_pol, 'allowances', v_allowances,
    'deductions', v_deductions, 'rounding', v_rounding,
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'rate_factor', t.rate_factor, 'base_salary', t.base_salary,
    'base_type_per_teacher', t.base_type is not null);

  -- --- Hisob yozuvi (idempotent: qayta hisoblasa qatorlar quriladi) --
  select id into v_run_id
    from public.payroll_runs
   where teacher_id = p_teacher_id and period = v_period and status <> 'cancelled';

  if v_run_id is null then
    insert into public.payroll_runs
      (school_id, teacher_id, period, status, period_from, period_to, settings_snapshot)
    values
      (t.school_id, p_teacher_id, v_period, 'draft', v_from, v_to, v_snapshot)
    returning id into v_run_id;
  else
    -- TZ 4.11.8 — tasdiqlangan hisob qayta hisoblanmaydi.
    if exists (select 1 from public.payroll_runs where id = v_run_id and status = 'approved') then
      raise exception 'Oylik allaqachon tasdiqlangan — qayta hisoblab bo''lmaydi (TZ 4.11.8)'
        using errcode = '42501';
    end if;
    --  Qo'lda kiritilgan tuzatish SAQLANADI: bu funksiya faqat
    --  o'zi yaratgan qatorlarni tozalaydi. Mukofot yoki jarima
    --  formuladan kelib chiqmaydi — har qayta hisoblashda yo'qolib
    --  ketsa, uni qayta kiritish esdan chiqadi.
    delete from public.payroll_lines
     where payroll_run_id = v_run_id
       and source_kind <> 'manual';
    update public.payroll_runs
       set settings_snapshot = v_snapshot, calculated_at = now(),
           period_from = v_from, period_to = v_to
     where id = v_run_id;
  end if;

  select branch_id into v_primary_br
    from public.teacher_branches
   where teacher_id = p_teacher_id
   order by load_share desc limit 1;

  select coalesce(sum(held_hours + subst_hours), 0) into v_hours_total
    from app.teacher_hours(p_teacher_id, v_from, v_to);

  -- =================================================================
  --  1-QISM: ASOSIY HAQ (TZ 12.1.1 — qat'iy / stavka / soatbay / aralash)
  -- =================================================================

  if v_base_type = 'fixed' then
    v_base := round(t.base_salary * t.rate_factor, 2);
    if v_base > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy oylik',
         t.rate_factor, t.base_salary, v_base, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor',
                            'base_salary', t.base_salary,
                            'rate_factor', t.rate_factor));
      v_sort := v_sort + 1;
    end if;

  elsif v_base_type = 'rate' then
    -- Stavka bo'yicha: norma soat × stavka ulushi × soat narxi × toifa.
    v_base := round(v_hours_norm * t.rate_factor * v_hour_price * v_cat_factor, 2);
    --  Soat narxi sozlanmagan bo'lsa nol chiqadi. Nol qatorni yozish
    --  o'qituvchiga "stavka: 0 so'm" deb ko'rsatadi va bu xatolikni
    --  yashiradi. Sozlama muammosi alohida tekshiruvda
    --  ogohlantirish bo'lib chiqadi (payroll_config_issues).
    if v_base <> 0 then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'base',
       'Stavka (' || app.fmt_num(v_hours_norm * t.rate_factor) || ' soat)',
       v_hours_norm * t.rate_factor, round(v_hour_price * v_cat_factor, 2), v_base, v_sort,
       jsonb_build_object('formula',
                          'hours_per_rate * rate_factor * hour_price * category_factor',
                          'hours_per_rate', v_hours_norm,
                          'rate_factor', t.rate_factor,
                          'hour_price', v_hour_price,
                          'category_factor', v_cat_factor));
    v_sort := v_sort + 1;
    end if;

  else
    -- 'hourly' va 'mixed': haqiqiy o'tilgan soatlar, FILIAL KESIMIDA
    -- (TZ 4.11.4 — bir nechta filialda ishlagan xodim).
    for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
    loop
      if h.held_hours > 0 then
        v_val := round(h.held_hours * v_hour_price * v_cat_factor, 2);
        v_base := v_base + v_val;
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'lessons', 'O''tilgan darslar',
           h.held_hours, round(v_hour_price * v_cat_factor, 2), v_val, v_sort,
           jsonb_build_object('formula', 'held_hours * hour_price * category_factor',
                              'held_hours', h.held_hours,
                              'hour_price', v_hour_price,
                              'category_factor', v_cat_factor,
                              'from', v_from, 'to', v_to));
        v_sort := v_sort + 1;
      end if;
    end loop;

    -- 'mixed': qat'iy qism ham qo'shiladi.
    if v_base_type = 'mixed' and t.base_salary > 0 then
      v_val := round(t.base_salary * t.rate_factor, 2);
      v_base := v_base + v_val;
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'base', 'Qat''iy qism',
         t.rate_factor, t.base_salary, v_val, v_sort,
         jsonb_build_object('formula', 'base_salary * rate_factor'));
      v_sort := v_sort + 1;
    end if;
  end if;

  -- =================================================================
  --  2-QISM: O'RNIGA KIRILGAN VA O'TKAZILMAGAN DARSLAR
  --          (TZ 12.1.4, 12.1.5)
  -- =================================================================

  for h in select * from app.teacher_hours(p_teacher_id, v_from, v_to)
  loop
    -- --- O'rniga kirilgan darslar (TZ 12.1.4) -----------------------
    v_val := round(h.subst_hours * v_hour_price * v_cat_factor * v_subst_pct / 100, 2);
    if h.subst_hours > 0 and v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, h.branch_id, 'substitution',
         'O''rniga kirilgan darslar (' || app.fmt_num(v_subst_pct) || '%)',
         h.subst_hours,
         round(v_hour_price * v_cat_factor * v_subst_pct / 100, 2), v_val, v_sort,
         jsonb_build_object('formula',
                            'subst_hours * hour_price * category_factor * substitution_percent / 100',
                            'subst_hours', h.subst_hours,
                            'substitution_percent', v_subst_pct));
      v_sort := v_sort + 1;
    end if;

    -- --- O'tkazilmagan darslar (TZ 12.1.5) --------------------------
    -- Bayram/karantin to'lanishi va o'qituvchi kelmagani to'lanmasligi
    -- SOZLAMADA belgilanadi — kodda emas.
    for ent in select key as reason, value::text::numeric as hours
                 from jsonb_each(h.unheld_detail)
    loop
      v_paid_pct := coalesce(
        (v_unheld_pol -> ent.reason ->> 'paid_percent')::numeric,
        (v_unheld_pol -> 'default'   ->> 'paid_percent')::numeric,
        0);

      v_val := round(ent.hours * v_hour_price * v_cat_factor * v_paid_pct / 100, 2);
      if v_paid_pct > 0 and ent.hours > 0 and v_val <> 0 then
        insert into public.payroll_lines
          (school_id, payroll_run_id, branch_id, source_kind, description,
           quantity, unit_price, amount, sort_order, source)
        values
          (t.school_id, v_run_id, h.branch_id, 'unheld',
           'O''tkazilmagan dars — ' || ent.reason ||
             ' (' || app.fmt_num(v_paid_pct) || '%)',
           ent.hours,
           round(v_hour_price * v_cat_factor * v_paid_pct / 100, 2), v_val, v_sort,
           jsonb_build_object('reason', ent.reason, 'paid_percent', v_paid_pct,
                              'hours', ent.hours));
        v_sort := v_sort + 1;
      end if;
    end loop;
  end loop;

  -- Ustama bazasi — shu paytgacha yig'ilgan musbat summa.
  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- =================================================================
  --  3-QISM: USTAMALAR (TZ 12.1.6)
  -- =================================================================

  for al in
    select ta.code, ta.value_override
      from public.teacher_allowances ta
     where ta.teacher_id = p_teacher_id
       and ta.starts_on <= v_to
       and (ta.ends_on is null or ta.ends_on >= v_from)
     order by ta.code
  loop
    a := null;
    select value into a
      from jsonb_array_elements(v_allowances) value
     where value ->> 'code' = al.code
     limit 1;

    if a is null then
      continue;  -- katalogda yo'q ustama e'tiborsiz qoldiriladi
    end if;

    v_val := case
      when coalesce(a ->> 'type', 'fixed') = 'percent'
        then round(v_gross * coalesce(al.value_override, (a ->> 'value')::numeric) / 100, 2)
      else round(coalesce(al.value_override, (a ->> 'value')::numeric), 2)
    end;

    if v_val <> 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'allowance',
         coalesce(a ->> 'name', al.code), 1, v_val, v_val, v_sort,
         jsonb_build_object('code', al.code,
                            'type', a ->> 'type',
                            'value', coalesce(al.value_override, (a ->> 'value')::numeric),
                            'base', case when coalesce(a ->> 'type', 'fixed') = 'percent'
                                         then v_gross else null end,
                            'overridden', al.value_override is not null));
      v_sort := v_sort + 1;
    end if;
  end loop;

  -- Ushlanma bazasi — barcha musbat qatorlar (TZ 12.1.7).
  select coalesce(sum(amount), 0) into v_gross
    from public.payroll_lines where payroll_run_id = v_run_id and amount > 0;

  -- =================================================================
  --  4-QISM: USHLANMALAR (TZ 4.11.5, 12.1.7) — MANFIY QATORLAR
  -- =================================================================

  for d in select value from jsonb_array_elements(v_deductions) value
  loop
    v_val := case
      when coalesce(d ->> 'type', 'percent') = 'percent'
        then round(v_gross * (d ->> 'value')::numeric / 100, 2)
      else round((d ->> 'value')::numeric, 2)
    end;

    if v_val > 0 then
      insert into public.payroll_lines
        (school_id, payroll_run_id, branch_id, source_kind, description,
         quantity, unit_price, amount, sort_order, source)
      values
        (t.school_id, v_run_id, v_primary_br, 'deduction',
         coalesce(d ->> 'name', d ->> 'code'), 1, -v_val, -v_val, v_sort,
         jsonb_build_object('code', d ->> 'code', 'type', d ->> 'type',
                            'value', (d ->> 'value')::numeric,
                            'base', v_gross));
      v_sort := v_sort + 1;
    end if;
  end loop;

  -- =================================================================
  --  5-QISM: AVANS (TZ 4.11.6) — MANFIY QATOR
  -- =================================================================

  for al in
    select adv.id, adv.amount, adv.paid_on, adv.branch_id
      from public.teacher_advances adv
     where adv.teacher_id = p_teacher_id and adv.period = v_period
     order by adv.paid_on
  loop
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, al.branch_id, 'advance',
       'Avans (' || to_char(al.paid_on, 'DD.MM.YYYY') || ')',
       1, -al.amount, -al.amount, v_sort,
       jsonb_build_object('advance_id', al.id, 'paid_on', al.paid_on));
    v_sort := v_sort + 1;
  end loop;

  -- =================================================================
  --  6-QISM: YAXLITLASH (TZ 12.1.9)
  -- =================================================================

  select coalesce(sum(amount), 0) into v_net
    from public.payroll_lines where payroll_run_id = v_run_id;

  v_rounded := app.round_money(
    v_net,
    coalesce((v_rounding ->> 'step')::numeric, 1),
    coalesce(v_rounding ->> 'mode', 'nearest'));

  if v_rounded <> v_net then
    insert into public.payroll_lines
      (school_id, payroll_run_id, branch_id, source_kind, description,
       quantity, unit_price, amount, sort_order, source)
    values
      (t.school_id, v_run_id, v_primary_br, 'rounding', 'Yaxlitlash',
       1, v_rounded - v_net, v_rounded - v_net, 99,
       jsonb_build_object('before', v_net, 'after', v_rounded,
                          'step', v_rounding ->> 'step',
                          'mode', v_rounding ->> 'mode'));
  end if;

  return jsonb_build_object(
    'payroll_run_id', v_run_id,
    'teacher_id',     p_teacher_id,
    'period',         v_period,
    'period_from',    v_from,
    'period_to',      v_to,
    'gross',          v_gross,
    'net',            v_rounded,
    'hours',          v_hours_total);
end;
$function$
;

-- =====================================================================
--  5. BEKOR QILINGAN DARS BOSHQA JOYLARDA HAM SANALMASIN
--
--  Darslarni yana ikkita funksiya o'qiydi. Ular unutilsa, bekor
--  qilingan dars oylikdan chiqadi-yu, tekshiruv va hisobotda
--  qolib ketadi — raqamlar bir-biriga mos kelmaydi.
--
--  Ta'riflar jonli bazadan olindi va faqat WHERE sharti to'ldirildi.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.payroll_config_issues(p_period date DEFAULT CURRENT_DATE)
 RETURNS TABLE(code text, severity text, message text, hint text)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_school     uuid := app.school_id();
  v_period     date := date_trunc('month', p_period)::date;
  v_base_type  text;
  v_hour_price numeric;
  v_cats       jsonb;
  v_allow      jsonb;
  v_deduct     jsonb;
  v_n          integer;
  v_names      text;
begin
  if v_school is null then
    return;
  end if;

  v_base_type  := app.payroll_setting(v_school, 'base_type', v_period,
                    '"fixed"'::jsonb) #>> '{}';
  v_hour_price := (app.payroll_setting(v_school, 'hour_price', v_period,
                    '0'::jsonb) #>> '{}')::numeric;
  v_cats       := app.payroll_setting(v_school, 'category_factors', v_period, '{}'::jsonb);
  v_allow      := app.payroll_setting(v_school, 'allowances', v_period, '[]'::jsonb);
  v_deduct     := app.payroll_setting(v_school, 'deductions', v_period, '[]'::jsonb);

  -- --- 1. Soat narxi ------------------------------------------------
  --  Qat'iy oylikda ham kerak: o'rniga kirilgan dars soat narxidan
  --  hisoblanadi. Narxsiz bunday dars umuman to'lanmaydi.
  if coalesce(v_hour_price, 0) = 0 then
    if v_base_type <> 'fixed' then
      return query select
        'hour_price_zero'::text, 'error'::text,
        'Soat narxi belgilanmagan, lekin oylik turi soatga bog''liq.'::text,
        'Sozlamalar → Oylik → soat narxi'::text;
    elsif exists (select 1 from public.lessons l
                   where l.deleted_at is null
                     and l.school_id = v_school
                     and l.day >= v_period
                     and l.day < (v_period + interval '1 month')::date
                     and l.kind = 'substituted') then
      return query select
        'hour_price_zero_subst'::text, 'warning'::text,
        'Soat narxi belgilanmagan — o''rniga kirilgan darslar to''lanmaydi.'::text,
        'Sozlamalar → Oylik → soat narxi'::text;
    end if;
  end if;

  -- --- 2. Ushlanmalar ------------------------------------------------
  if jsonb_array_length(v_deduct) = 0 then
    return query select
      'no_deductions'::text, 'warning'::text,
      'Ushlanmalar ro''yxati bo''sh — daromad solig''i hisoblanmaydi.'::text,
      'Sozlamalar → Oylik → ushlanmalar'::text;
  end if;

  -- --- 3. Nol qiymatli ustamalar -------------------------------------
  select count(*), string_agg(value ->> 'name', ', ')
    into v_n, v_names
    from jsonb_array_elements(v_allow) value
   where coalesce((value ->> 'value')::numeric, 0) = 0;

  if coalesce(v_n, 0) > 0 then
    return query select
      'zero_allowance'::text, 'warning'::text,
      ('Ustama qiymati nol: ' || v_names)::text,
      'Sozlamalar → Oylik → ustamalar'::text;
  end if;

  -- --- 4. Toifa koeffitsientlari --------------------------------------
  if v_cats = '{}'::jsonb
     and exists (select 1 from public.teachers
                  where school_id = v_school and deleted_at is null
                    and coalesce(category, '') <> '') then
    return query select
      'no_category_factors'::text, 'info'::text,
      'O''qituvchilarda toifa bor, lekin toifa koeffitsienti sozlanmagan.'::text,
      'Sozlamalar → Oylik → toifa koeffitsienti'::text;
  end if;

  -- --- 5. Oyligi belgilanmagan o'qituvchilar --------------------------
  select count(*) into v_n
    from public.teachers
   where school_id = v_school and deleted_at is null and is_active
     and coalesce(base_salary, 0) = 0;

  if v_base_type in ('fixed', 'mixed') and coalesce(v_n, 0) > 0 then
    return query select
      'teacher_no_salary'::text, 'error'::text,
      (v_n || ' ta o''qituvchining oyligi belgilanmagan.')::text,
      'O''qituvchilar → kartochka → oylik'::text;
  end if;

  -- --- 6. Stavkasi nol -------------------------------------------------
  select count(*) into v_n
    from public.teachers
   where school_id = v_school and deleted_at is null and is_active
     and coalesce(rate_factor, 0) = 0;

  if coalesce(v_n, 0) > 0 then
    return query select
      'teacher_no_rate'::text, 'error'::text,
      (v_n || ' ta o''qituvchining stavka ulushi nol — oylik chiqmaydi.')::text,
      'O''qituvchilar → kartochka → stavka'::text;
  end if;

  -- --- 7. Ustamasi biriktirilmagan sinf rahbarlari ---------------------
  --  Ustama katalogda bor, lekin odamga biriktirilmagan bo'lsa hisobga
  --  tushmaydi. Bu eng ko'p uchraydigan "oyligim kam chiqibdi" sababi.
  if exists (select 1 from jsonb_array_elements(v_allow) value
              where value ->> 'code' = 'class_teacher') then
    select count(*) into v_n
      from public.classes c
      join public.teachers t on t.id = c.teacher_id
     where c.school_id = v_school and c.deleted_at is null and c.is_active
       and t.deleted_at is null
       and not exists (
             select 1 from public.teacher_allowances ta
              where ta.teacher_id = t.id and ta.code = 'class_teacher'
                and ta.starts_on <= (v_period + interval '1 month - 1 day')::date
                and (ta.ends_on is null or ta.ends_on >= v_period));

    if coalesce(v_n, 0) > 0 then
      return query select
        'class_teacher_no_allowance'::text, 'info'::text,
        (v_n || ' ta sinf rahbariga sinf rahbarligi ustamasi biriktirilmagan.')::text,
        'O''qituvchilar → kartochka → ustamalar'::text;
    end if;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_payroll(p_period date)
 RETURNS TABLE(payroll_run_id uuid, teacher_id uuid, teacher_name text, status payroll_status, gross_total numeric, deductions numeric, rounding numeric, net_total numeric, hours numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    t.payroll_run_id,
    t.teacher_id,
    te.full_name,
    t.status,
    t.gross_total,
    t.deductions_total,
    t.rounding_total,
    t.net_total,
    coalesce((
      select sum(l.hours) from public.lessons l
       where l.deleted_at is null
         and l.teacher_id = t.teacher_id
         and l.day between r.period_from and r.period_to
         and l.kind in ('held', 'substituted')
    ), 0)
  from public.v_payroll_totals t
  join public.payroll_runs r on r.id = t.payroll_run_id
  join public.teachers te on te.id = t.teacher_id
  where t.period = date_trunc('month', p_period)::date
    and t.status <> 'cancelled'
  order by te.full_name;
$function$
;
