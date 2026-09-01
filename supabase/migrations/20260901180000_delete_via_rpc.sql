-- =====================================================================
--  O'CHIRISH — GRANT ORQALI EMAS, FUNKSIYA ORQALI
--
--  Oldingi ikkita migratsiyada xato yo'l tanlangan edi:
--
--    · `calendar_days` ga DELETE siyosati qo'shildi — foydasiz,
--      chunki jadval darajasida GRANT yo'q edi
--    · `user_branches` va `teacher_branches` ga DELETE GRANTI
--      berildi — bu esa TZ 5.4.8 ni buzdi
--
--  Xavfsizlik invarianti (`app.security_invariants`) buni tutdi va
--  to'g'ri qildi: `authenticated` roliga DELETE HECH QAYERDA
--  berilmaydi. Sabab shu — brauzerdagi kod yo'l qo'yib yuborilgan
--  bitta xato so'rov bilan jadvalni tozalab yuborishi mumkin
--  bo'lardi.
--
--  To'g'ri yo'l: o'chirish `security definer` funksiya orqali
--  bo'ladi. U egasining huquqi bilan ishlaydi, GRANT ga muhtoj
--  emas va nima o'chirilishini O'ZI hal qiladi.
-- =====================================================================

revoke delete on public.user_branches    from authenticated;
revoke delete on public.teacher_branches from authenticated;

drop policy if exists user_branches_delete    on public.user_branches;
drop policy if exists teacher_branches_delete on public.teacher_branches;
drop policy if exists calendar_days_delete    on public.calendar_days;

-- =====================================================================
--  KALENDAR KUNINI O'CHIRISH
-- =====================================================================

create or replace function public.delete_calendar_day(
  p_day       date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_n      int;
begin
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;
  perform app.assert_may_write('services.manage');

  delete from public.calendar_days
   where school_id = v_school
     and day = p_day
     and (branch_id is not distinct from p_branch_id);
  get diagnostics v_n = row_count;

  return jsonb_build_object('day', p_day, 'removed', v_n);
end;
$$;

comment on function public.delete_calendar_day(date, uuid) is
  'Kalendardan kunni olib tashlaydi. Bayram yoki ta''til — moliyaviy '
  'yozuv emas, shuning uchun arxivlanmaydi.';

grant execute on function public.delete_calendar_day(date, uuid) to authenticated;

-- =====================================================================
--  XODIMNING FILIALLARI
--
--  Ro'yxat butunlay ALMASHTIRILADI: eskisi olib tashlanadi, yangisi
--  yoziladi. Buni ikkita alohida so'rov bilan qilish mumkin emas edi
--  — o'chirish uchun GRANT kerak bo'lardi.
-- =====================================================================

create or replace function public.set_user_branches(
  p_user_id    uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_n      int := 0;
begin
  perform app.assert_may_write('users.manage');

  if not exists (
    select 1 from public.app_users u
     where u.id = p_user_id and u.school_id = v_school and u.deleted_at is null
  ) then
    raise exception 'Xodim topilmadi' using errcode = '22023';
  end if;

  delete from public.user_branches where user_id = p_user_id;

  --  Faqat SHU maktabning filiallari — so'rovdagi ro'yxatga
  --  ishonilmaydi.
  insert into public.user_branches (user_id, branch_id)
  select p_user_id, b.id
    from public.branches b
   where b.id = any(p_branch_ids)
     and b.school_id = v_school
     and b.deleted_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('user_id', p_user_id, 'branches', v_n);
end;
$$;

comment on function public.set_user_branches(uuid, uuid[]) is
  'Xodimning filial ro''yxatini butunlay almashtiradi. Begona '
  'maktabning filiali qabul qilinmaydi.';

grant execute on function public.set_user_branches(uuid, uuid[]) to authenticated;

-- =====================================================================
--  O'QITUVCHINING FILIALLARI
--
--  Hozircha panel uni almashtirmaydi, lekin bir xil naqsh saqlansin:
--  keyin kerak bo'lganda yana GRANT qo'shish vasvasasi tug'ilmasin.
-- =====================================================================

create or replace function public.set_teacher_branches(
  p_teacher_id uuid,
  p_branch_ids uuid[],
  p_shares     numeric[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_n      int := 0;
  i        int;
begin
  perform app.assert_may_write('teachers.manage');

  if not exists (
    select 1 from public.teachers t
     where t.id = p_teacher_id and t.school_id = v_school
       and t.deleted_at is null
  ) then
    raise exception 'O''qituvchi topilmadi' using errcode = '22023';
  end if;

  if coalesce(array_length(p_branch_ids, 1), 0) = 0 then
    raise exception 'Kamida bitta filial ko''rsatilishi kerak'
      using errcode = '22023';
  end if;

  delete from public.teacher_branches where teacher_id = p_teacher_id;

  for i in 1 .. array_length(p_branch_ids, 1) loop
    if exists (
      select 1 from public.branches b
       where b.id = p_branch_ids[i] and b.school_id = v_school
         and b.deleted_at is null
    ) then
      insert into public.teacher_branches (teacher_id, branch_id, load_share)
      values (p_teacher_id, p_branch_ids[i],
              coalesce(p_shares[i], 1.0));
      v_n := v_n + 1;
    end if;
  end loop;

  return jsonb_build_object('teacher_id', p_teacher_id, 'branches', v_n);
end;
$$;

comment on function public.set_teacher_branches(uuid, uuid[], numeric[]) is
  'O''qituvchining filiallari va yuklama ulushini almashtiradi.';

grant execute on function public.set_teacher_branches(uuid, uuid[], numeric[])
  to authenticated;
