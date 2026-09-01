-- =====================================================================
--  FILIAL BOG'LANISHINI O'CHIRISH — "permission denied"
--
--  Xodimni tahrirlab saqlaganda xato chiqardi:
--
--      permission denied for table user_branches
--
--  Sabab: `authenticated` roliga INSERT, SELECT va UPDATE berilgan,
--  DELETE esa berilmagan. Panel filial ro'yxatini almashtirganda
--  avval eskisini o'chiradi — o'sha yerda to'siladi.
--
--  Bu RLS emas, jadval darajasidagi GRANT. Farqi muhim: RLS
--  to'sganda "row-level security policy" deb aytiladi va qator
--  jimgina o'tkazib yuboriladi, GRANT to'sganda esa butun amal
--  xato bilan tugaydi. Shuning uchun bu safar xato KO'RINDI —
--  kalendardagi kabi jim qolmadi.
--
--  `teacher_branches` da ham xuddi shu bo'shliq bor edi. U hozircha
--  sezilmagan, chunki panel o'qituvchining filialini almashtirmaydi
--  — lekin bu vaqt masalasi edi.
--
--  Bu bog'lanish jadvallari MOLIYAVIY yozuv emas: ular shunchaki
--  "kim qaysi filialda ishlaydi" degan ro'yxat. Uni arxivlashning
--  ma'nosi yo'q.
-- =====================================================================

grant delete on public.user_branches    to authenticated;
grant delete on public.teacher_branches to authenticated;

drop policy if exists user_branches_delete on public.user_branches;

create policy user_branches_delete on public.user_branches
  for delete using (
    ((select app.may_write('users.manage'))
     and exists (
       select 1 from public.app_users u
        where u.id = user_branches.user_id
          and u.school_id = (select app.school_id())))
    or (select app.is_platform_admin())
  );

drop policy if exists teacher_branches_delete on public.teacher_branches;

create policy teacher_branches_delete on public.teacher_branches
  for delete using (
    ((select app.may_write('teachers.manage'))
     and exists (
       select 1 from public.teachers t
        where t.id = teacher_branches.teacher_id
          and t.school_id = (select app.school_id())))
    or (select app.is_platform_admin())
  );
