-- =====================================================================
--  OYLIKNI BEKOR QILISH va AVTOMATIK TAXMINIY HISOB
--
--  Ikkita kamchilik bir-biriga bog'liq:
--
--  1. Tasdiqlangan oylikni QAYTARIB BO'LMASDI. `approve_payroll`
--     xarajat yozuvini yaratadi va shu bilan tamom — xato summa
--     kiritilgan bo'lsa ham tuzatib bo'lmasdi. Qo'lda ham
--     o'chirilmaydi: `trg_expenses_guard_payroll` to'sadi.
--
--  2. Oylik faqat qo'lda hisoblanardi. Shu sababli davr prognozida
--     "Xodimlar oyligi" doim 0 bo'lib turardi va "qo'lda qoladi"
--     raqami haqiqatdan uzoq edi.
-- =====================================================================

-- =====================================================================
--  0. O'QUVCHI SINFGA O'ZI BOG'LANSIN
--
--  Trigger nomni `class_id` dan olardi, teskarisini qilmasdi. Panelda
--  bu yetarli — u har doim `class_id` yozadi. Lekin ommaviy import
--  faqat matnni yozgan va 227 o'quvchi sinfsiz qolgan.
--
--  Oqibati darhol ko'rinmagan, lekin keng: "Sinflar bo'yicha"
--  hisoboti hamma sinfda 0 ko'rsatgan, sinf davomati va ota-onaga
--  xabar ishlamagan, sinf rahbari ustamasi hisoblanmagan — chunki
--  ularning hammasi `students.class_id = classes.id` bog'lanishiga
--  tayanadi.
--
--  Endi bog'lanish IKKI TOMONLAMA: `class_id` bo'lsa nomi undan
--  olinadi, faqat nomi bo'lsa `class_id` nomdan topiladi. Bunday
--  xato boshqa takrorlanmaydi.
-- =====================================================================

create or replace function app.sync_student_class_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.class_id is not null then
    select c.name, coalesce(new.grade_level, c.grade_level)
      into new.class_name, new.grade_level
      from public.classes c
     where c.id = new.class_id;

  elsif coalesce(new.class_name, '') <> '' then
    --  Nomi bor, bog'lanish yo'q — nomdan topamiz. Sinf nomi bitta
    --  filialda yagona, shuning uchun natija bir qiymatli.
    select c.id, coalesce(new.grade_level, c.grade_level)
      into new.class_id, new.grade_level
      from public.classes c
     where c.branch_id = new.branch_id
       and c.name = new.class_name
       and c.deleted_at is null
     limit 1;
  end if;

  return new;
end;
$$;

-- =====================================================================
--  1. XARAJAT QO'RIQCHISIGA ATAYLAB QOLDIRILGAN ESHIK
--
--  Oylikdan yaratilgan xarajat qo'lda o'zgartirilmaydi — bu to'g'ri
--  qoida va saqlanib qoladi. Lekin `cancel_payroll` uni bekor qila
--  olishi SHART, aks holda pulni qaytarishning yo'li yo'q.
--
--  Bayroq tranzaksiya ichida amal qiladi (`set_config(..., true)`) va
--  uni faqat o'sha funksiya qo'yadi: PostgREST orqali `set_config`
--  chaqirib bo'lmaydi. Bu xavfsizlik chegarasi emas — RLS va
--  huquq tekshiruvi joyida qoladi — faqat biznes qoidasi.
-- =====================================================================

create or replace function app.guard_payroll_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(old.payroll_run_id, new.payroll_run_id) is not null
     and not app.is_service_context()
     and coalesce(current_setting('app.payroll_cancel', true), '') <> '1' then
    raise exception
      'Bu xarajat oylik hisobidan avtomatik yaratilgan va qo''lda o''zgartirilmaydi (TZ 4.10.2)'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- =====================================================================
--  2. OYLIKNI BEKOR QILISH
--
--  Uchala ehtiyojni bitta amal qoplaydi:
--    · berilgan oylikni qaytarish  → xarajat bekor qilinadi
--    · xato summani tuzatish       → bekor qilib, qayta hisoblanadi
--    · butunlay olib tashlash      → bekor qilingan holatda qoladi
--
--  Yozuv O'CHIRILMAYDI. Oylik berilgani va keyin qaytarilgani
--  jurnalda ko'rinib turishi kerak — aks holda pul qayerga ketgani
--  tushunarsiz bo'lib qoladi.
--
--  Bekor qilingandan keyin `calc_payroll` shu davr uchun YANGI hisob
--  yaratadi: u faqat `status <> 'cancelled'` bo'lgan hisobni qidiradi.
--  Ya'ni tuzatish uchun alohida funksiya kerak emas.
-- =====================================================================

create or replace function public.cancel_payroll(
  p_run_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.payroll_runs%rowtype;
  v_net numeric(14,2);
  v_exp int := 0;
begin
  --  Sabab MAJBURIY: pul qaytarilganda "nega" degan savol albatta
  --  tug'iladi va javob jurnalda turishi kerak.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Bekor qilish sababi ko''rsatilishi shart'
      using errcode = '22023';
  end if;

  select * into r from public.payroll_runs where id = p_run_id;
  if not found then
    raise exception 'Oylik hisobi topilmadi' using errcode = '22023';
  end if;
  if r.status = 'cancelled' then
    raise exception 'Bu hisob allaqachon bekor qilingan' using errcode = '22023';
  end if;

  --  Bekor qilish tasdiqlashdan kam mas'uliyatli emas — huquq ham
  --  o'sha.
  perform app.assert_may_write('payroll.approve');
  perform app.assert_period_open(r.school_id, r.period, null);

  select net_total into v_net
    from public.v_payroll_totals where payroll_run_id = p_run_id;

  --  Xarajat o'chirilmaydi, `deleted_at` qo'yiladi.
  perform set_config('app.payroll_cancel', '1', true);
  update public.expenses
     set deleted_at = now()
   where payroll_run_id = p_run_id
     and deleted_at is null;
  get diagnostics v_exp = row_count;
  perform set_config('app.payroll_cancel', '0', true);

  update public.payroll_runs
     set status     = 'cancelled',
         expense_id = null,
         note       = concat_ws(' | ', nullif(note, ''),
                        'Bekor qilindi: ' || btrim(p_reason))
   where id = p_run_id;

  return jsonb_build_object(
    'payroll_run_id',    p_run_id,
    'was_status',        r.status,
    'net',               coalesce(v_net, 0),
    'expenses_removed',  v_exp);
end;
$$;

comment on function public.cancel_payroll(uuid, text) is
  'Oylik hisobini bekor qiladi va undan yaratilgan xarajatni '
  'qaytaradi. Yozuv o''chirilmaydi. Keyin qayta hisoblash mumkin.';

grant execute on function public.cancel_payroll(uuid, text) to authenticated;

-- =====================================================================
--  3. AVTOMATIK TAXMINIY OYLIK
--
--  Har kuni ishlaydi va faqat HISOBLANMAGAN o'qituvchi uchun hisob
--  quradi. Hisob `draft` holatida qoladi — pul o'z-o'zidan berilmaydi,
--  tasdiqlashni odam bosadi.
--
--  NEGA "faqat yo'g'ini": `calc_payroll` mavjud hisobning qatorlarini
--  o'chirib qayta quradi. Kunlik cron buni har kecha qilsa, qo'lda
--  kiritilgan tuzatish yo'qolardi. Hisoblanma bilan bir xil qoida.
-- =====================================================================

create or replace function public.run_monthly_payroll(
  p_period  date    default null,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          record;
  te         record;
  v_period   date;
  v_calc     int := 0;
  v_failed   int := 0;
  v_schools  int := 0;
  v_details  jsonb := '[]'::jsonb;
  v_made     int;
begin
  if not app.is_service_context() then
    raise exception 'Bu vazifani faqat tizim bajaradi'
      using errcode = '42501';
  end if;

  for s in
    select sc.id, sc.name, coalesce(sc.timezone, 'Asia/Tashkent') as tz
      from public.schools sc
     where sc.deleted_at is null
       and sc.status in ('trial', 'active')
     order by sc.name
  loop
    v_period := coalesce(
      p_period,
      date_trunc('month', (now() at time zone s.tz))::date);

    if app.school_setting(s.id, 'payroll.auto_calc', 'true'::jsonb)
       <> 'true'::jsonb then
      continue;
    end if;

    v_made := 0;

    for te in
      select t.id, t.full_name
        from public.teachers t
       where t.school_id = s.id
         and t.is_active
         and t.deleted_at is null
         --  ASOSIY SHART: hisobi bor bo'lsa tegilmaydi.
         and not exists (
           select 1 from public.payroll_runs pr
            where pr.teacher_id = t.id
              and pr.period = v_period
              and pr.status <> 'cancelled')
       order by t.full_name
    loop
      if p_dry_run then
        v_made := v_made + 1;
        continue;
      end if;

      --  Bitta o'qituvchidagi xato qolganlarini to'xtatmasligi kerak:
      --  filial biriktirilmagan yoki sozlama to'liq emas bo'lishi
      --  mumkin, bu o'sha xodimga tegishli.
      begin
        perform public.calc_payroll(te.id, v_period);
        v_made := v_made + 1;
      exception when others then
        v_failed := v_failed + 1;
        v_details := v_details || jsonb_build_object(
          'school', s.name, 'teacher', te.full_name, 'error', sqlerrm);
      end;
    end loop;

    if v_made > 0 then
      v_schools := v_schools + 1;
      v_calc := v_calc + v_made;

      if not p_dry_run then
        insert into public.school_settings (school_id, key, value, note)
        values (
          s.id, 'payroll.last_auto_run',
          jsonb_build_object('period', v_period, 'at', now(),
                             'calculated', v_made),
          'Avtomatik taxminiy hisob')
        on conflict (school_id, key) do update
          set value = excluded.value;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'schools',    v_schools,
    'calculated', v_calc,
    'failed',     v_failed,
    'details',    v_details);
end;
$$;

comment on function public.run_monthly_payroll(date, boolean) is
  'Har kuni: oyligi hali hisoblanmagan o''qituvchiga taxminiy hisob '
  'quradi. Hisob `draft` — pul avtomatik berilmaydi. Mavjud hisobga '
  'tegilmaydi, qo''lda kiritilgan tuzatish yo''qolmasligi uchun.';

revoke all on function public.run_monthly_payroll(date, boolean)
  from public, anon, authenticated;

-- =====================================================================
--  CRON — 01:30 UTC = 06:30 Toshkent.
--  Hisoblanmadan (01:00) KEYIN: oylik dars soatlariga ham tayanadi.
-- =====================================================================
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron yo''q — vazifa rejalashtirilmadi.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'maktab_monthly_payroll') then
    perform cron.unschedule('maktab_monthly_payroll');
  end if;

  perform cron.schedule(
    'maktab_monthly_payroll', '30 1 * * *',
    'select public.run_monthly_payroll();');

  raise notice 'Cron rejalashtirildi: maktab_monthly_payroll';
exception when others then
  raise notice 'Cron rejalashtirilmadi: %', sqlerrm;
end $do$;
