-- =====================================================================
--  21 — BOT UCHUN YORDAMCHI RPC
--
--  Edge Function `app` sxemasiga to'g'ridan-to'g'ri murojaat qila
--  olmaydi (PostgREST faqat `public` ni ochadi). Shuning uchun
--  tarjima funksiyasiga yupqa o'ram beriladi.
-- =====================================================================

create or replace function public.bot_text(
  p_key       text,
  p_lang      text default 'uz',
  p_school_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app.t('bot', p_key, coalesce(p_lang, 'uz'), p_school_id);
$$;

comment on function public.bot_text(text, text, uuid) is
  'Bot matnlarini bazadan oladi (TZ 5.6.5). Maktab o''z matnini '
  'qo''ysa u standartdan ustun.';

revoke all on function public.bot_text(text, text, uuid) from public, anon;
grant execute on function public.bot_text(text, text, uuid) to service_role, authenticated;

-- =====================================================================
--  Chekni qabul qilish (TZ 4.7.3.1, 4.7.3.2)
--
--  Bot service_role bilan ishlaydi, lekin o'quvchi doirasi allaqachon
--  `parent-scope.ts` da tekshirilgan. Bu funksiya yozuvni yagona
--  joydan yaratadi va `pending` holatini kafolatlaydi — chek
--  qarzdorlikni YOPMAYDI (TZ 4.7.3).
-- =====================================================================

create or replace function public.submit_payment_proof(
  p_student_id       uuid,
  p_parent_id        uuid,
  p_file_path        text,
  p_telegram_file_id text default null,
  p_amount           numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid;
  v_branch uuid;
  v_id     uuid;
begin
  if not app.is_service_context() then
    raise exception 'Bu funksiya faqat bot uchun' using errcode = '42501';
  end if;

  select school_id, branch_id into v_school, v_branch
    from public.students where id = p_student_id and deleted_at is null;

  if v_school is null then
    raise exception 'O''quvchi topilmadi' using errcode = '22023';
  end if;

  -- Ota-ona haqiqatan shu o'quvchiga biriktirilganmi — ikkinchi
  -- himoya qatlami (parent-scope.ts dagi tekshiruvdan tashqari).
  if p_parent_id is not null and not exists (
    select 1 from public.student_parents
     where student_id = p_student_id and parent_id = p_parent_id
  ) then
    raise exception 'Ota-ona bu o''quvchiga biriktirilmagan' using errcode = '42501';
  end if;

  insert into public.payment_proofs
    (school_id, branch_id, student_id, parent_id, file_path,
     telegram_file_id, amount_claimed, status)
  values
    (v_school, v_branch, p_student_id, p_parent_id, p_file_path,
     p_telegram_file_id, p_amount, 'pending')
  returning id into v_id;

  return jsonb_build_object('proof_id', v_id, 'status', 'pending');
end;
$$;

comment on function public.submit_payment_proof(uuid, uuid, text, text, numeric) is
  'TZ 4.7.3.2 — chek `Kutilmoqda` holatida yoziladi. Qarzdorlikka '
  'ta''sir qilmaydi (TZ 4.7.3 muhim qoidasi).';

revoke all on function public.submit_payment_proof(uuid, uuid, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.submit_payment_proof(uuid, uuid, text, text, numeric)
  to service_role;
