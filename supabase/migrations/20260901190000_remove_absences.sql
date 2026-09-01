-- =====================================================================
--  YO'QLIK BELGISINI OLIB TASHLASH
--
--  "Yo'qlik" sahifasida bola belgisini olib tashlab saqlansa, u
--  o'chmasdi — xato ham chiqmasdi. Sabab o'sha: brauzerdan
--  to'g'ridan-to'g'ri `delete` qilinardi, `authenticated` roliga esa
--  DELETE huquqi hech qayerda berilmagan (TZ 5.4.8).
--
--  Koddagi izohda "bu moliyaviy yozuv emas, o'chirish mumkin" deb
--  yozilgan edi — fikr to'g'ri, lekin amal ishlamasdi.
--
--  Oqibati jimgina va jiddiy: sinf rahbari xato belgilangan bolani
--  "keldi" qilib qo'yaman deb o'ylaydi, tizimda esa u kelmagan
--  bo'lib qoladi. Ota-onaga xabar ketadi va kunlik ovqat hisobdan
--  chiqariladi.
-- =====================================================================

create or replace function public.remove_absences(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_n      int := 0;
begin
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;
  perform app.assert_may_write('absences.mark');

  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return jsonb_build_object('removed', 0);
  end if;

  --  Faqat SHU maktabning yozuvlari. Ro'yxat brauzerdan keladi,
  --  shuning uchun unga ishonilmaydi.
  delete from public.absences a
   where a.id = any(p_ids)
     and a.school_id = v_school;
  get diagnostics v_n = row_count;

  return jsonb_build_object('removed', v_n);
end;
$$;

comment on function public.remove_absences(uuid[]) is
  'Xato qo''yilgan yo''qlik belgisini olib tashlaydi. Bu moliyaviy '
  'yozuv emas — kunlik xizmat qayta hisoblanadi va o''zgarish audit '
  'jurnalida qoladi.';

grant execute on function public.remove_absences(uuid[]) to authenticated;
