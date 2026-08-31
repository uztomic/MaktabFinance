-- =====================================================================
--  TO'LIQ O'CHIRISH
--
--  Oldingi migratsiyada o'qituvchini o'chirish darsi yoki oylik
--  hisobi bo'lsa RAD ETILARDI. Mantiq to'g'ri edi, lekin amalda
--  boshi berk ko'chaga olib bordi: sinov uchun kiritilgan yozuvda
--  ham bitta dars va bitta hisoblangan oylik paydo bo'lib qoladi —
--  ular avtomatik hisoblanadi — va yozuvni olib tashlashning
--  yo'li qolmaydi.
--
--  Endi ikkita yo'l bor:
--
--    · oylik hisobini alohida o'chirish
--    · o'qituvchini darslari va hisoblari bilan birga o'chirish
--
--  YAGONA CHEKLOV SAQLANADI: TASDIQLANGAN oylik. U xarajat yozuvini
--  yaratgan, ya'ni pul haqiqatda berilgan. Uni o'chirish kassa
--  hisobotida tushuntirib bo'lmaydigan farq qoldiradi. Bunday holda
--  avval oylikni BEKOR QILISH kerak — u xarajatni ham qaytaradi —
--  keyin o'chirish ochiladi.
-- =====================================================================

-- =====================================================================
--  1. OYLIK HISOBINI O'CHIRISH
-- =====================================================================

create or replace function public.delete_payroll_run(
  p_run_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.payroll_runs%rowtype;
begin
  select * into r from public.payroll_runs where id = p_run_id;
  if not found then
    raise exception 'Oylik hisobi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('payroll.approve');
  perform app.assert_period_open(r.school_id, r.period, null);

  if r.status = 'approved' then
    raise exception
      'Tasdiqlangan oylik o''chirilmaydi — pul berilgan. Avval bekor qiling.'
      using errcode = '42501';
  end if;

  --  Xarajat faqat tasdiqlanganda yaratiladi, lekin ehtiyot uchun
  --  tekshiramiz: bog'liq xarajat qolib ketsa u yetim bo'lib qoladi.
  if exists (
    select 1 from public.expenses e
     where e.payroll_run_id = p_run_id and e.deleted_at is null
  ) then
    raise exception 'Bu hisobga bog''liq xarajat bor — avval bekor qiling'
      using errcode = '42501';
  end if;

  delete from public.payroll_lines where payroll_run_id = p_run_id;
  delete from public.payroll_runs where id = p_run_id;

  return jsonb_build_object('payroll_run_id', p_run_id, 'deleted', true);
end;
$$;

comment on function public.delete_payroll_run(uuid, text) is
  'Hisoblangan (tasdiqlanmagan) oylikni butunlay o''chiradi. '
  'Tasdiqlangani o''chirilmaydi — pul berilgan, avval bekor qilinadi.';

grant execute on function public.delete_payroll_run(uuid, text) to authenticated;

-- =====================================================================
--  2. O'QITUVCHINI TO'LIQ O'CHIRISH
--
--  `p_force` bilan darslari, ustamalari va TASDIQLANMAGAN oylik
--  hisoblari ham o'chadi. Yozuvning o'zi bazadan chiqib ketadi.
-- =====================================================================

create or replace function public.delete_teacher(
  p_teacher_id uuid,
  p_reason     text,
  p_force      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t          public.teachers%rowtype;
  v_approved int;
  v_payroll  int;
  v_lessons  int;
  v_adv      int;
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

  select count(*) into v_approved from public.payroll_runs
   where teacher_id = p_teacher_id and status = 'approved';

  --  Pul berilgan bo'lsa yo'l yopiq — bu yagona qat'iy cheklov.
  if v_approved > 0 then
    raise exception
      'Bu o''qituvchida % ta TASDIQLANGAN oylik bor — pul berilgan. Avval o''sha oylikni bekor qiling.',
      v_approved
      using errcode = '42501';
  end if;

  select count(*) into v_payroll from public.payroll_runs
   where teacher_id = p_teacher_id;
  select count(*) into v_lessons from public.lessons
   where teacher_id = p_teacher_id;
  select count(*) into v_adv from public.teacher_advances
   where teacher_id = p_teacher_id;

  if not p_force and (v_payroll > 0 or v_lessons > 0 or v_adv > 0) then
    raise exception
      'Bu o''qituvchining % ta oylik hisobi, % ta darsi va % ta avansi bor. Ular bilan birga o''chirish uchun tasdiqlang.',
      v_payroll, v_lessons, v_adv
      using errcode = '42501';
  end if;

  --  Sinf rahbarligi FK bo'yicha o'zi bo'shaydi (ON DELETE SET NULL),
  --  lekin buni ATAYLAB oldindan qilamiz: `classes` da audit triggeri
  --  bor va o'zgarish kim tomonidan bo'lgani yozilib qolsin.
  update public.classes
     set teacher_id = null
   where teacher_id = p_teacher_id and deleted_at is null;

  --  Tizimga kirish hisobi. Auth yozuvi o'chirilmaydi — u boshqa
  --  maktabda ishlatilayotgan bo'lishi mumkin emas, lekin o'chirish
  --  Edge Function talab qiladi va bu yerdan chaqirib bo'lmaydi.
  if t.user_id is not null then
    update public.app_users
       set is_active = false, deleted_at = now()
     where id = t.user_id;
  end if;

  --  RESTRICT bo'lganlar qo'lda: qolganlari CASCADE bilan ketadi
  --  (`lessons`, `teacher_allowances`, `teacher_branches`).
  delete from public.payroll_lines
   where payroll_run_id in (
     select id from public.payroll_runs where teacher_id = p_teacher_id);
  delete from public.payroll_runs where teacher_id = p_teacher_id;
  delete from public.teacher_advances where teacher_id = p_teacher_id;

  delete from public.teachers where id = p_teacher_id;

  return jsonb_build_object(
    'teacher_id',      p_teacher_id,
    'deleted',         true,
    'payroll_removed', v_payroll,
    'lessons_removed', v_lessons,
    'advances_removed', v_adv);
end;
$$;

comment on function public.delete_teacher(uuid, text, boolean) is
  'O''qituvchini butunlay o''chiradi. `p_force` bilan darslari, '
  'avanslari va tasdiqlanmagan oylik hisoblari ham. Tasdiqlangan '
  'oylik bo''lsa rad etadi — pul berilgan, avval bekor qilinadi.';

grant execute on function public.delete_teacher(uuid, text, boolean)
  to authenticated;

--  Eski ikki argumentli variant olib tashlanadi: ikkitasi qolsa
--  chaqiruv qaysi biriga tushishi noaniq bo'lardi.
drop function if exists public.delete_teacher(uuid, text);
