-- =====================================================================
--  TURON — soatbay o'qituvchilar
--
--  Ro'yxatda bir necha xodim "soat × 45 000" bo'yicha ishlaydi. Import
--  paytida ularning oyligi QAT'IY summa qilib yozilgan edi (55 × 45 000
--  = 2 475 000). Bu ishlaydi, lekin xato: keyingi oyda soat boshqacha
--  bo'lsa ham o'sha summa qolib ketardi va buni hech kim sezmasdi.
--
--  To'g'ri yo'l — turini `hourly` qilish. Shunda "Darslar" bo'limiga
--  kiritilgan HAQIQIY soat oylikni o'zi hisoblaydi:
--
--      o'tilgan soat × soat narxi × toifa koeffitsienti
--
--  Soat narxi 40 000 turgan edi, ro'yxatda esa 45 000 — tuzatiladi.
-- =====================================================================

do $$
declare
  v_school uuid;
  v_hourly text[] := array[
    'Kodirov Muslimbek',
    'Buvonazarova Mufazzal',
    'Kimsanova Nargiza',
    'Sherkuziyeva Maftuna',
    'Meliboeva Ma''rifat',
    'Arzamova Nafisa',
    'Xamidova Charos',
    'Bo''ymatova Maftuna'
  ];
begin
  select id into v_school from public.schools where name = 'Turon Ilm Xazinasi';
  if v_school is null then
    raise exception 'Maktab topilmadi';
  end if;

  --  Soat narxi.
  update public.payroll_settings
     set value = '45000'::jsonb
   where school_id = v_school and key = 'hour_price';

  --  Sof soatbaylar: qat'iy qismi yo'q.
  update public.teachers
     set base_type   = 'hourly',
         base_salary = 0,
         note = concat_ws(' | ', nullif(note, ''),
                'Soatbay: "Darslar" bo''limiga kiritilgan soat bo''yicha hisoblanadi')
   where school_id = v_school
     and full_name = any(v_hourly)
     and deleted_at is null;

  --  Aralash: qat'iy oylik + soat.
  update public.teachers
     set base_type = 'mixed',
         note = concat_ws(' | ', nullif(note, ''),
                'Aralash: qat''iy oylik + "Darslar" dagi soat')
   where school_id = v_school
     and full_name = 'Nurmatova Gulmira'
     and deleted_at is null;
end $$;

--  Turi o'zgargan xodimlarning oyligi qayta hisoblanadi: eskisi
--  qat'iy summa bilan tuzilgan va endi noto'g'ri.
select public.calc_payroll(t.id, date_trunc('month', current_date)::date)
  from public.teachers t
  join public.schools s on s.id = t.school_id
 where s.name = 'Turon Ilm Xazinasi'
   and t.base_type in ('hourly', 'mixed')
   and t.deleted_at is null;

select t.full_name, t.base_type, t.base_salary::bigint,
       coalesce(v.net_total, 0)::bigint as oylik
  from public.teachers t
  join public.schools s on s.id = t.school_id
  left join public.v_payroll_totals v
         on v.teacher_id = t.id
        and v.period = date_trunc('month', current_date)::date
        and v.status <> 'cancelled'
 where s.name = 'Turon Ilm Xazinasi'
   and t.base_type is not null
   and t.deleted_at is null
 order by t.full_name;
