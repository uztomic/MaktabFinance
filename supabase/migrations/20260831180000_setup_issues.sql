-- =====================================================================
--  SOZLAMADAGI JIM KAMCHILIKLAR
--
--  Tizimning eng yomon xatosi — xato bermaydigani. Turonda 227
--  o'quvchi bor, lekin bironta ota-ona kiritilmagan. Natijada:
--
--    · kunlik davomat xabari hech kimga bormaydi
--    · kvitansiya raqami ota-onaga yetmaydi
--    · to'lov muddati eslatmasi yuborilmaydi
--
--  va bularning hech biri xato bermaydi. Navbatga qo'yiladigan xabar
--  soni shunchaki nol bo'ladi. Maktab esa tizim ishlayapti deb
--  o'ylab yuraveradi.
--
--  Bu funksiya shunday holatlarni sanab beradi. Har biri UCHUN
--  javob boshqacha, shuning uchun ular bitta "xato" qilib
--  qo'shilmaydi — har qaysisi alohida qatorda, o'z og'irligi bilan.
--
--  Faqat o'qiydi.
-- =====================================================================

create or replace function public.school_setup_issues(
  p_branch_id uuid default null
)
returns table (
  code     text,
  severity text,   -- 'danger' | 'warn' | 'info'
  count    integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
begin
  if v_school is null then
    return;
  end if;

  --  1. Ota-onasi yo'q o'quvchilar. Telegram bo'yicha hech narsa
  --     yetib bormaydi — eng jim yo'qotish.
  return query
  select 'no_parent', 'danger', count(*)::integer
    from public.students st
   where st.school_id = v_school
     and st.deleted_at is null
     and st.status = 'active'
     and (p_branch_id is null or st.branch_id = p_branch_id)
     and not exists (
       select 1 from public.student_parents sp
        where sp.student_id = st.id)
  having count(*) > 0;

  --  2. Ota-ona bor, lekin botga ulanmagan. Xabar navbatga
  --     qo'yiladi va yuborilmay qoladi.
  return query
  select 'parent_no_telegram', 'warn', count(*)::integer
    from public.parents p
   where p.school_id = v_school
     and p.deleted_at is null
     and p.is_active
     and p.telegram_id is null
     and exists (
       select 1 from public.student_parents sp where sp.parent_id = p.id)
  having count(*) > 0;

  --  3. Faol shartnomasi yo'q o'quvchi — hisoblanmaga umuman
  --     tushmaydi (INNER JOIN sababli hatto "o'tkazib yuborildi"
  --     soniga ham kirmaydi).
  return query
  select 'no_contract', 'danger', count(*)::integer
    from public.students st
   where st.school_id = v_school
     and st.deleted_at is null
     and st.status = 'active'
     and (p_branch_id is null or st.branch_id = p_branch_id)
     and not exists (
       select 1 from public.contracts c
        where c.student_id = st.id and c.is_active)
  having count(*) > 0;

  --  4. Sinfga bog'lanmagan o'quvchi. Sinf hisoboti, sinf davomati
  --     va sinf rahbari ustamasi shu bog'lanishga tayanadi.
  return query
  select 'no_class', 'warn', count(*)::integer
    from public.students st
   where st.school_id = v_school
     and st.deleted_at is null
     and st.status = 'active'
     and (p_branch_id is null or st.branch_id = p_branch_id)
     and st.class_id is null
  having count(*) > 0;

  --  5. Filialga biriktirilmagan o'qituvchi — oyligi tasdiqlanganda
  --     xarajat taqsimlanmaydi va amal xato beradi.
  return query
  select 'teacher_no_branch', 'danger', count(*)::integer
    from public.teachers t
   where t.school_id = v_school
     and t.deleted_at is null
     and t.is_active
     and not exists (
       select 1 from public.teacher_branches tb where tb.teacher_id = t.id)
  having count(*) > 0;

  --  6. Tizimga kira olmaydigan o'qituvchi — davomat ololmaydi.
  return query
  select 'teacher_no_login', 'warn', count(*)::integer
    from public.teachers t
   where t.school_id = v_school
     and t.deleted_at is null
     and t.is_active
     and t.user_id is null
  having count(*) > 0;

  --  7. Rahbari yo'q sinf — davomat kim tomonidan olinishi noma'lum.
  return query
  select 'class_no_teacher', 'info', count(*)::integer
    from public.classes c
   where c.school_id = v_school
     and c.deleted_at is null
     and c.is_active
     and (p_branch_id is null or c.branch_id = p_branch_id)
     and c.teacher_id is null
  having count(*) > 0;
end;
$$;

comment on function public.school_setup_issues(uuid) is
  'Jim ishlamay turgan joylarni sanaydi: ota-onasi yo''q o''quvchi, '
  'botga ulanmagan ota-ona, shartnomasiz o''quvchi va hokazo. '
  'Tizimning eng yomon xatosi — xato bermaydigani.';

grant execute on function public.school_setup_issues(uuid) to authenticated;
