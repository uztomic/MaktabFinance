-- =====================================================================
--  OYLIK HISOBLANMANI AVTOMATIK SHAKLLANTIRISH
--
--  Muammo: `generate_invoices` faqat qo'lda chaqirilardi. 1-sentabr
--  kelganda tizimda hech narsa o'zgarmasdi — kimdir kirib tugmani
--  bosishi kerak edi. Amalda bu qadam unutiladi va oy o'rtasida
--  "nega qarzdorlik ko'rinmayapti" degan savol tug'iladi.
--
--  YECHIM: kunlik cron. NEGA OYLIK EMAS: agar 1-kuni baza to'xtab
--  qolsa yoki cron o'tkazib yuborilsa, oylik jadval bilan butun oy
--  yo'qoladi. Kunlik jadval ertasiga o'zi tutib oladi.
--
--  Kunlik ishlash XAVFSIZ, chunki bitta qat'iy shart bor:
--
--      DAVRDA BITTA HAM HISOBLANMA BO'LSA — UMUMAN TEGILMAYDI.
--
--  Bu shart nima uchun muhim: `generate_invoices` tasdiqlanmagan
--  hisoblanmani QAYTA QURADI, ya'ni `invoice_lines` ni o'chirib
--  yangidan yozadi (20260822120012, 238-qator). Agar buxgalter qo'lda
--  qator qo'shgan bo'lsa — jarima, bir martalik to'lov — kunlik cron
--  uni har kecha o'chirib tashlagan bo'lardi. Shuning uchun avtomatika
--  faqat YO'Q narsani yaratadi, bor narsani hech qachon o'zgartirmaydi.
--
--  Oy o'rtasida kelgan o'quvchi ham shu sababdan avtomatik tushmaydi —
--  buning uchun buxgalter "Shakllantirish" tugmasini bosadi va o'zi
--  javobgar bo'ladi.
-- =====================================================================

-- =====================================================================
--  AVTOMATIK OYLIK HISOBLANMA
--
--  Qaytaradi: {branches, created, skipped, failed, details}
--
--  p_period  — sinov uchun boshqa oyni ko'rsatish (odatda null).
--  p_dry_run — hech narsa yozmasdan, nima bo'lishini ko'rsatadi.
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
  v_res      jsonb;
  v_details  jsonb := '[]'::jsonb;
  v_branches int := 0;
  v_created  int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  v_made     int;
begin
  --  Faqat cron va Edge Function. Foydalanuvchi butun platforma
  --  bo'ylab hisoblanma shakllantira olmasligi kerak.
  if not app.is_service_context() then
    raise exception 'Bu vazifani faqat tizim bajaradi'
      using errcode = '42501';
  end if;

  for r in
    select b.id      as branch_id,
           b.school_id,
           b.name     as branch_name,
           s.name     as school_name,
           coalesce(s.timezone, 'Asia/Tashkent') as tz
      from public.branches b
      join public.schools  s on s.id = b.school_id
     where b.deleted_at is null
       and b.is_active
       and s.deleted_at is null
       --  Arxiv, cheklangan va to'xtatilgan maktabga yozilmaydi.
       --  Bu `app.school_is_writable()` bilan bir xil shart, lekin
       --  u sessiyaga bog'liq — cron da sessiya yo'q.
       and s.status in ('trial', 'active')
     order by s.name, b.name
  loop
    --  Davr HAR MAKTABNING o'z mintaqasida hisoblanadi: UTC da hali
    --  31-avgust, Toshkentda esa allaqachon 1-sentabr bo'lishi mumkin.
    v_period := coalesce(
      p_period,
      date_trunc('month', (now() at time zone r.tz))::date);

    --  Maktab avtomatikani o'chirib qo'yishi mumkin.
    if app.school_setting(r.school_id, 'invoices.auto_generate',
                          'true'::jsonb) <> 'true'::jsonb then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    --  ASOSIY HIMOYA — yuqoridagi izohga qarang.
    if exists (
      select 1 from public.invoices
       where branch_id = r.branch_id
         and period    = v_period
         and status   <> 'cancelled'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_dry_run then
      v_branches := v_branches + 1;
      v_details := v_details || jsonb_build_object(
        'school', r.school_name, 'branch', r.branch_name,
        'period', v_period, 'would_run', true);
      continue;
    end if;

    --  Bitta filialdagi xato butun yugurishni to'xtatmasligi kerak:
    --  yopiq davr, buzuq shartnoma va hokazo faqat o'sha filialga
    --  tegishli. Blok ichidagi `exception` ostki tranzaksiya ochadi.
    begin
      v_res  := public.generate_invoices(r.branch_id, v_period);
      v_made := coalesce((v_res ->> 'created')::int, 0);

      v_branches := v_branches + 1;
      v_created  := v_created + v_made;
      v_details  := v_details || jsonb_build_object(
        'school', r.school_name, 'branch', r.branch_name,
        'period', v_period, 'result', v_res);

      --  Panelda ko'rsatish uchun: "01.09 da avtomatik shakllantirildi".
      --  Alohida jadval ochilmadi — hisoblanmalarning o'zi audit
      --  jurnaliga tushadi, bu yerda faqat yugurish izi kerak.
      insert into public.school_settings (school_id, key, value, note)
      values (
        r.school_id,
        'invoices.last_auto_run',
        jsonb_build_object(
          'period',    v_period,
          'at',        now(),
          'branch_id', r.branch_id,
          'created',   v_made),
        'Avtomatik shakllantirish')
      on conflict (school_id, key) do update
        set value = excluded.value;

    exception when others then
      v_failed  := v_failed + 1;
      v_details := v_details || jsonb_build_object(
        'school', r.school_name, 'branch', r.branch_name,
        'period', v_period, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'branches', v_branches,
    'created',  v_created,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'details',  v_details);
end;
$$;

comment on function public.run_monthly_invoices(date, boolean) is
  'Har kuni ishlaydi, lekin davrda hisoblanma yo''q filialgagina '
  'yozadi. Bor hisoblanmaga hech qachon tegmaydi — qo''lda qo''shilgan '
  'qatorlar o''chib ketmasligi uchun.';

revoke all on function public.run_monthly_invoices(date, boolean)
  from public, anon, authenticated;

-- =====================================================================
--  CRON
--
--  01:00 UTC = 06:00 Toshkent — ish kuni boshlanishidan oldin, ya'ni
--  buxgalter kelganda hisoblanmalar tayyor turadi.
-- =====================================================================
do $do$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron yo''q — vazifa rejalashtirilmadi.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'maktab_monthly_invoices') then
    perform cron.unschedule('maktab_monthly_invoices');
  end if;

  perform cron.schedule(
    'maktab_monthly_invoices', '0 1 * * *',
    'select public.run_monthly_invoices();');

  raise notice 'Cron rejalashtirildi: maktab_monthly_invoices';
exception when others then
  raise notice 'Cron rejalashtirilmadi: %', sqlerrm;
end $do$;
