-- =====================================================================
--  42 — "HAMMASINI HISOBLASH" TUGMASI XATO BERMASIN
--
--  MUAMMO. Oylik sahifasida "Hammasini hisoblash" bosilganda sariq
--  ogohlantirish chiqardi:
--
--      Hisoblash: 0 · Xatolik yuz berdi: 22
--
--  Aslida hech qanday xato yo'q edi. O'sha oyning hisoblari
--  ALLAQACHON TASDIQLANGAN, va `calc_payroll` tasdiqlangan hisobni
--  qayta hisoblashdan bosh tortadi (TZ 4.11.8) — bu to'g'ri va
--  buzilmasligi kerak bo'lgan qoida.
--
--  Lekin `calc_payroll_batch` bu holatni oddiy xato deb sanardi.
--  Natijada direktor har oy oxirida "22 ta xatolik" ko'rib, tizimga
--  ishonchini yo'qotardi — holbuki tizim aynan kerakli ishni qilgan.
--
--  YECHIM. Tasdiqlangan hisob ALOHIDA sanaladi: `skipped`. Bu xato
--  emas, ataylab o'tkazib yuborilgan. Haqiqiy xatolar esa endi
--  ko'rinadigan bo'ladi — ilgari ular 22 ta soxta xato orasida
--  ko'milib ketardi.
-- =====================================================================

create or replace function public.calc_payroll_batch(p_period date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school  uuid := app.school_id();
  v_period  date := date_trunc('month', p_period)::date;
  r         record;
  v_ok      int := 0;
  v_skip    int := 0;
  v_fail    int := 0;
  v_errors  jsonb := '[]'::jsonb;
begin
  perform app.assert_may_write('payroll.manage');

  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;

  for r in
    select id, full_name from public.teachers
     where school_id = v_school and is_active and deleted_at is null
     order by full_name
  loop
    --  Tasdiqlangan hisob qayta hisoblanmaydi (TZ 4.11.8). Buni
    --  OLDINDAN tekshiramiz: istisnoga urib, keyin uni "xato" deb
    --  yozish noto'g'ri xabar beradi.
    if exists (
      select 1 from public.payroll_runs
       where teacher_id = r.id and period = v_period and status = 'approved'
    ) then
      v_skip := v_skip + 1;
      continue;
    end if;

    begin
      perform public.calc_payroll(r.id, v_period);
      v_ok := v_ok + 1;
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_object(
        'teacher', r.full_name, 'error', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'calculated', v_ok,
    'skipped',    v_skip,
    'failed',     v_fail,
    'errors',     v_errors);
end;
$$;

comment on function public.calc_payroll_batch(date) is
  'Barcha faol o''qituvchi uchun oylik hisobi. Tasdiqlangan hisob '
  'qayta hisoblanmaydi (TZ 4.11.8) va bu XATO emas — `skipped` '
  'bo''lib alohida qaytariladi.';

revoke all on function public.calc_payroll_batch(date) from public, anon;
grant execute on function public.calc_payroll_batch(date)
  to authenticated, service_role;
