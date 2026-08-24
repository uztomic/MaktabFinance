-- =====================================================================
--  15 — FAYL SAQLASH (TZ 4.7.4, 5.5.8)
--
--  TZ 5.5.8 — "Fayllarga kirish VAQTINCHALIK HAVOLALAR orqali, ochiq
--  URL bilan emas". Shuning uchun uchala bucket ham `public = false`.
--  Ilova faylni faqat `createSignedUrl` orqali ko'rsatadi.
--
--  YO'L NAQSHI:  {school_id}/{branch_id}/{yil}/{oy}/{fayl}
--  Siyosat yo'lning BIRINCHI segmentini `app.school_id()` bilan
--  solishtiradi — shu tufayli bir maktab boshqasining faylini
--  ko'ra olmaydi (TZ 5.5.7).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- Telegram orqali kelgan cheklar. Siqilgandan keyin ~200 KB.
  ('receipts', 'receipts', false, 5242880,
   array['image/webp', 'image/jpeg', 'image/png']),
  -- Bank vypiskasi fayllari. TZ 4.7.2.5 — ASL HOLIDA saqlanadi.
  ('statements', 'statements', false, 20971520,
   array['text/csv', 'application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/plain', 'application/pdf']),
  -- Xarajat hujjatlari (TZ 4.10 — hujjat ilovasi).
  ('expense-docs', 'expense-docs', false, 10485760,
   array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------
-- SIYOSATLAR
--
--  O'qish — o'z maktabining fayllari.
--  Yozish — huquq bor foydalanuvchi (chek Edge Function orqali,
--  service_role bilan tushadi va RLS unga taalluqli emas).
--  O'chirish — MIJOZGA UMUMAN BERILMAYDI (TZ 5.4.8): fayl faqat
--  `cleanup` cron orqali, saqlash siyosatiga muvofiq o'chiriladi.
-- ---------------------------------------------------------------------

do $do$
declare
  b record;
begin
  for b in
    select * from (values
      ('receipts',     'payments.create'),
      ('statements',   'payments.create'),
      ('expense-docs', 'expenses.create')
    ) as v(bucket, perm)
  loop
    execute format('drop policy if exists %I on storage.objects',
                   b.bucket || '_read');
    execute format($f$
      create policy %I on storage.objects
        for select to authenticated
        using (
          bucket_id = %L
          and (storage.foldername(name))[1] = app.school_id()::text
        )
    $f$, b.bucket || '_read', b.bucket);

    execute format('drop policy if exists %I on storage.objects',
                   b.bucket || '_write');
    execute format($f$
      create policy %I on storage.objects
        for insert to authenticated
        with check (
          bucket_id = %L
          and (storage.foldername(name))[1] = app.school_id()::text
          and app.may_write(%L)
        )
    $f$, b.bucket || '_write', b.bucket, b.perm);
  end loop;
end $do$;

-- =====================================================================
--  FAYL SAQLASH SIYOSATI (TZ 4.7.4)
--
--  | Fayl turi                          | Muddat                      |
--  |------------------------------------|-----------------------------|
--  | Tasdiqlanmagan chek (harakatsiz)   | 90 kundan keyin o'chiriladi |
--  | Rad etilgan chek                   | 90 kundan keyin             |
--  | TASDIQLANGAN chek                  | HECH QACHON avtomatik emas  |
--  | Bank vypiskasi fayli               | HECH QACHON avtomatik emas  |
--
--  TZ 4.7.4.5 — "Tasdiqlangan chek hech qanday avtomatik jarayon
--  tomonidan o'chirilmaydi." Bu funksiyada shu shart QAT'IY.
--
--  TZ 4.7.4.4 — fayl o'chirilganda YOZUV SAQLANADI: kim, qachon
--  yuborgan, qachon o'chirilgan.
-- =====================================================================

create or replace function public.cleanup_expired_files()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_days     int;
  v_marked   int := 0;
  v_updates  int := 0;
  v_stale    int := 0;
begin
  if not app.is_service_context() then
    raise exception 'Bu funksiya faqat rejalashtirilgan vazifa uchun'
      using errcode = '42501';
  end if;

  -- --- 1. Muddati o'tgan cheklarni belgilash -----------------------
  for r in
    select p.id, p.school_id, p.file_path, p.status, p.submitted_at
      from public.payment_proofs p
     where p.file_path is not null
       and p.file_deleted_at is null
       -- TZ 4.7.4.5 — TASDIQLANGAN chek hech qachon o'chirilmaydi.
       and p.status in ('pending', 'rejected')
  loop
    v_days := coalesce(
      (app.school_setting(r.school_id, 'files.proof_retention_days',
                          '90'::jsonb) #>> '{}')::int, 90);

    if r.submitted_at < now() - make_interval(days => v_days) then
      -- Yozuv saqlanadi, faqat fayl yo'li bo'shatiladi (TZ 4.7.4.4).
      update public.payment_proofs
         set file_deleted_at = now()
       where id = r.id;

      delete from storage.objects
       where bucket_id = 'receipts' and name = r.file_path;

      v_marked := v_marked + 1;
    end if;
  end loop;

  -- --- 2. 60 kun kutayotgan cheklar uchun ogohlantirish (TZ 4.7.3.6)
  for r in
    select p.id, p.school_id, p.submitted_at
      from public.payment_proofs p
     where p.status = 'pending'
       and p.stale_notified_at is null
  loop
    v_days := coalesce(
      (app.school_setting(r.school_id, 'files.stale_proof_days',
                          '60'::jsonb) #>> '{}')::int, 60);

    if r.submitted_at < now() - make_interval(days => v_days) then
      update public.payment_proofs set stale_notified_at = now() where id = r.id;
      v_stale := v_stale + 1;
    end if;
  end loop;

  -- --- 3. Eski telegram update yozuvlarini tozalash ----------------
  delete from public.telegram_updates where received_at < now() - interval '7 days';
  get diagnostics v_updates = row_count;

  return jsonb_build_object(
    'files_removed', v_marked,
    'stale_proofs',  v_stale,
    'updates_purged', v_updates);
end;
$$;

comment on function public.cleanup_expired_files() is
  'TZ 4.7.4 — fayl saqlash siyosati. TASDIQLANGAN chek va vypiska '
  'fayli hech qachon avtomatik o''chirilmaydi (TZ 4.7.4.5).';

revoke all on function public.cleanup_expired_files() from public, anon, authenticated;
grant execute on function public.cleanup_expired_files() to service_role;
