-- =====================================================================
--  O'QUVCHINI VA SINFNI O'CHIRISH
--
--  Ikkalasida ham xuddi o'qituvchidagi ajratma saqlanadi:
--
--    CHIQIB KETDI — haqiqiy voqea. O'quvchi o'qigan, to'lagan.
--    Yozuvi qoladi (`status = expelled`), moliyaviy tarixi
--    hisobotlarda ko'rinadi. Bu allaqachon bor edi.
--
--    O'CHIRISH — yozuvning o'zi xato. Sinov uchun kiritilgan yoki
--    ikki marta qo'shilgan. Bunday yozuv butunlay chiqib ketishi
--    kerak.
--
--  TASDIQLANGAN TO'LOV yagona qat'iy to'siq bo'lib qoladi: pul
--  kassaga kelgan va kunlik hisobotga tushgan. Uni izsiz yo'qotish
--  kassa qoldig'ida tushuntirib bo'lmaydigan farq qoldiradi. Avval
--  to'lovni bekor qilish kerak — u qarzni ham qaytaradi.
-- =====================================================================

create or replace function public.delete_student(
  p_student_id uuid,
  p_reason     text,
  p_force      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  st         public.students%rowtype;
  v_paid     int;
  v_invoices int;
  v_contract int;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sabab ko''rsatilishi shart' using errcode = '22023';
  end if;

  select * into st from public.students where id = p_student_id;
  if not found then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(st.branch_id);

  select count(*) into v_paid from public.payments
   where student_id = p_student_id and status = 'confirmed';

  if v_paid > 0 then
    raise exception
      'Bu o''quvchida % ta tasdiqlangan to''lov bor — pul kassaga kelgan. Avval o''sha to''lovlarni bekor qiling.',
      v_paid
      using errcode = '42501';
  end if;

  select count(*) into v_invoices from public.invoices
   where student_id = p_student_id;
  select count(*) into v_contract from public.contracts
   where student_id = p_student_id;

  if not p_force and (v_invoices > 0 or v_contract > 0) then
    raise exception
      'Bu o''quvchida % ta hisoblanma va % ta shartnoma bor. Ular bilan birga o''chirish uchun tasdiqlang.',
      v_invoices, v_contract
      using errcode = '42501';
  end if;

  --  RESTRICT bo'lganlar qo'lda; qolganlari CASCADE bilan ketadi
  --  (`absences`, `student_services`, `student_parents`,
  --  `payment_proofs`).
  delete from public.invoice_lines
   where invoice_id in (
     select id from public.invoices where student_id = p_student_id);
  delete from public.invoices where student_id = p_student_id;

  --  Bekor qilingan to'lovlar qolishi mumkin — ular pul emas.
  delete from public.cash_receipts
   where payment_id in (
     select id from public.payments where student_id = p_student_id);
  delete from public.payments where student_id = p_student_id;

  delete from public.contracts where student_id = p_student_id;
  delete from public.students where id = p_student_id;

  return jsonb_build_object(
    'student_id',        p_student_id,
    'deleted',           true,
    'invoices_removed',  v_invoices,
    'contracts_removed', v_contract);
end;
$$;

comment on function public.delete_student(uuid, text, boolean) is
  'O''quvchini butunlay o''chiradi. `p_force` bilan shartnomasi va '
  'hisoblanmalari ham. Tasdiqlangan to''lovi bo''lsa rad etadi — pul '
  'kassaga kelgan, avval to''lovni bekor qilish kerak.';

grant execute on function public.delete_student(uuid, text, boolean)
  to authenticated;

-- =====================================================================
--  SINFNI O'CHIRISH
--
--  O'quvchilar sinf bilan birga O'CHMAYDI: ular maktabda qoladi,
--  faqat sinfsiz bo'ladi. Aks holda bitta noto'g'ri bosish butun
--  sinfni yo'q qilardi.
-- =====================================================================

create or replace function public.delete_class(
  p_class_id uuid,
  p_reason   text,
  p_force    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c        public.classes%rowtype;
  v_stud   int;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sabab ko''rsatilishi shart' using errcode = '22023';
  end if;

  select * into c from public.classes
   where id = p_class_id and deleted_at is null;
  if not found then
    raise exception 'Sinf topilmadi' using errcode = '22023';
  end if;

  perform app.assert_may_write('students.manage');
  perform app.assert_branch(c.branch_id);

  select count(*) into v_stud from public.students
   where class_id = p_class_id and deleted_at is null;

  if v_stud > 0 and not p_force then
    raise exception
      'Bu sinfda % ta o''quvchi bor. Ular o''chmaydi, faqat sinfsiz qoladi — davom etish uchun tasdiqlang.',
      v_stud
      using errcode = '42501';
  end if;

  --  Bog'lanish uziladi. `class_name` matni o'quvchida qoladi:
  --  o'tgan davr hisoblanmalari va davomat yozuvlari o'sha nom
  --  bo'yicha izlanadi.
  update public.students
     set class_id = null
   where class_id = p_class_id;

  delete from public.classes where id = p_class_id;

  return jsonb_build_object(
    'class_id',         p_class_id,
    'deleted',          true,
    'students_unlinked', v_stud);
end;
$$;

comment on function public.delete_class(uuid, text, boolean) is
  'Sinfni o''chiradi. O''quvchilar o''chmaydi — sinfsiz qoladi.';

grant execute on function public.delete_class(uuid, text, boolean)
  to authenticated;
