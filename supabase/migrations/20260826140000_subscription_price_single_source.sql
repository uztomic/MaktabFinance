-- =====================================================================
--  44 — OBUNA NARXI IKKI XIL KO'RSATILARDI
--
--  MUAMMO. "Obuna va to'lov" sahifasida ikkita raqam bir-biriga zid
--  turardi:
--
--      Obuna holati  → Oylik to'lov        900 000
--      Narx qanday hisoblangan → Oylik jami 500 000
--
--  Sababi — ikkita manba:
--
--    · `school_subscriptions.monthly_amount` — maktab yaratilganda
--      BIR MARTA yozilgan va shundan keyin hech qachon yangilanmagan;
--    · `school_price()` — har safar qaytadan hisoblaydi (filial soni,
--      o'quvchi soni va `platform_settings` dagi narxlar bo'yicha).
--
--  Filial qo'shilsa yoki o'quvchi soni limitdan oshsa, saqlangan raqam
--  eskirib qoladi. Mijoz esa ekranda ikki xil summa ko'radi va qaysi
--  biriga ishonishni bilmaydi — bu to'lov masalasida yo'l qo'yib
--  bo'lmaydigan hol.
--
--  YECHIM. Narx BIR JOYDA hisoblanadi (`app.school_monthly_fee`).
--  `school_price()` ham, kunlik tariflash ham o'shanga murojaat
--  qiladi, va `monthly_amount` endi har kuni yangilanib turadi.
--
--  KESISHGAN BOG'LIQLIK. Bu migratsiya PLATFORMA qismiga tayanadi:
--  `app.billing_num`, `public.school_subscriptions` va
--  `public.subscription_invoices` boshqa repoda yaratiladi
--  (`MaktabFinanceSupperAdmin`). Ular bir bazani bo'lishadi, lekin
--  alohida qo'llanadi.
--
--  Shuning uchun platforma jadvallariga TEGADIGAN qismlar mavjudlik
--  tekshiruvi bilan o'raladi. Busiz shu reponi yolg'iz o'zi toza
--  bazaga qo'llab bo'lmasdi: migratsiya `school_subscriptions`
--  jadvali yo'qligida yiqilardi.
--
--  Funksiyalarning O'ZI shartsiz yaratiladi — plpgsql tanasi chaqirilgunga
--  qadar tekshirilmaydi, ya'ni ular platformasiz ham bemalol turaveradi
--  va platforma qo'shilgan zahoti ishlab ketadi.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Narx hisobi — yagona manba
--
--  Huquq tekshiruvi YO'Q: bu ichki yordamchi (`app` sxemasi), tashqi
--  chaqiruvga ochilmaydi. Tekshiruv `public.school_price` da qoladi.
--  Ajratishning sababi — kunlik tariflash cron sifatida ishlaydi va
--  o'sha yerda "bu maktab sizniki emas" degan tekshiruv noto'g'ri
--  ishlab, narx yangilanmay qolardi.
-- ---------------------------------------------------------------------

create or replace function app.school_monthly_fee(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base       numeric := coalesce(app.billing_num('billing.base_monthly'), 500000);
  v_branch     numeric := coalesce(app.billing_num('billing.branch_price'), 450000);
  v_per_branch int     := coalesce(app.billing_num('billing.students_per_branch'), 250)::int;
  v_step       int     := coalesce(app.billing_num('billing.student_step'), 50)::int;
  v_step_price numeric := coalesce(app.billing_num('billing.student_step_price'), 50000);
  v_setup      numeric := coalesce(app.billing_num('billing.setup_fee'), 600000);

  v_branches   int;
  v_students   int;
  v_included   int;
  v_extra      int;
  v_steps      int;
  v_first      boolean;
begin
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
$$;

comment on function app.school_monthly_fee(uuid) is
  'Obuna narxining YAGONA hisobi. Huquq tekshiruvi public.school_price '
  'da; bu yerda yo''q, chunki kunlik tariflash cron sifatida ishlaydi.';

-- ---------------------------------------------------------------------
--  2. Ochiq funksiya — faqat huquq tekshiruvi qo'shiladi
-- ---------------------------------------------------------------------

create or replace function public.school_price(p_school_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Maktab o'zining narxini ko'ra oladi, super admin — hammasini.
  if not (app.is_platform_admin()
          or app.is_service_context()
          or p_school_id = app.school_id()) then
    raise exception 'Bu maktab narxini ko''rish huquqi yo''q'
      using errcode = '42501';
  end if;

  return app.school_monthly_fee(p_school_id);
end;
$$;

comment on function public.school_price(uuid) is
  'Maktabning joriy obuna narxi va uning tarkibi. Hisob '
  'app.school_monthly_fee da — saqlangan qiymat bilan farq qilmasin.';

revoke all on function public.school_price(uuid) from public, anon;
grant execute on function public.school_price(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
--  3. Saqlangan summa endi eskirmaydi
--
--  `recompute_school_billing` har kuni cron orqali ishlaydi va
--  holatni yangilaydi. Endi u summani ham yangilaydi — shunda super
--  admin ro'yxatidagi raqam ham, maktab ekranidagi raqam ham bir xil.
-- ---------------------------------------------------------------------

create or replace function app.sync_subscription_amount(p_school_id uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare v_fee numeric;
begin
  v_fee := (app.school_monthly_fee(p_school_id) ->> 'monthly_total')::numeric;

  update public.school_subscriptions
     set monthly_amount = v_fee
   where school_id = p_school_id
     and status <> 'cancelled'
     and monthly_amount is distinct from v_fee;

  return v_fee;
end;
$$;

comment on function app.sync_subscription_amount(uuid) is
  'Saqlangan oylik summani joriy hisob bilan tenglashtiradi.';

-- Mavjud maktablarni darhol tenglashtiramiz.
do $do$
declare s uuid;
begin
  --  Platforma qismi hali qo'llanmagan bo'lsa tenglashtiradigan narsa
  --  ham yo'q. Kunlik tariflash uni keyinroq o'zi bajaradi.
  if to_regclass('public.school_subscriptions') is null
     or to_regprocedure('app.billing_num(text)') is null then
    raise notice 'Platforma qismi yo''q — obuna summasi tenglashtirilmadi';
    return;
  end if;

  for s in select id from public.schools where deleted_at is null loop
    perform app.sync_subscription_amount(s);
  end loop;
end $do$;

-- Kunlik qayta hisoblashga ulaymiz.
do $do$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_school_billing';

  if v_src is null then
    raise notice 'recompute_school_billing topilmadi — o''tkazib yuborildi';
    return;
  end if;

  if position('sync_subscription_amount' in v_src) > 0 then
    return;   -- allaqachon ulangan
  end if;

  --  Summani holatdan OLDIN yangilaymiz: holat o'zgarmasa ham
  --  (funksiya erta `return` qiladi) summa yangilanib qolsin.
  v_src := replace(
    v_src,
    '  select * into v_school from public.schools where id = p_school_id;',
    '  select * into v_school from public.schools where id = p_school_id;'
    || E'\n\n  --  Narx har kuni qayta hisoblanadi: filial qo''shilsa yoki\n'
    || E'  --  o''quvchi soni limitdan oshsa, saqlangan summa eskirmasin.\n'
    || E'  perform app.sync_subscription_amount(p_school_id);');

  execute v_src;
end $do$;
