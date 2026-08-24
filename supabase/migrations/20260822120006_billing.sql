-- =====================================================================
--  06 — HISOBLANMA, TO'LOVLAR, KASSA, VYPISKA, CHEKLAR (TZ 4.6–4.8)
--
--  IKKITA ASOSIY QOIDA:
--
--  1) TZ 4.6.2 — hisoblanma QATORLARDAN iborat, bitta umumiy summa
--     sifatida saqlanmaydi. Shuning uchun `invoices` jadvalida `total`
--     ustuni YO'Q: jami har doim qatorlardan hisoblanadi (TZ 4.12.2).
--     Bu jami va qatorlar bir-biridan uzilib qolishini texnik jihatdan
--     imkonsiz qiladi.
--
--  2) TZ 4.7.3 — chek rasmi HECH QANDAY HOLATDA qarzdorlikni yopmaydi.
--     Qarzdorlik faqat `status = confirmed` to'lovlar bilan yopiladi.
--
--  KO'RINISHLAR (VIEW) HAQIDA: barchasi `security_invoker = true` bilan
--  yaratiladi. Aks holda PostgreSQL 15+ da ko'rinish EGASI huquqi bilan
--  ishlaydi va RLS ni CHETLAB O'TADI — bu ijarachilar ajratilishini
--  buzadi (TZ 5.5.7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HISOBLANMALAR (TZ 4.6)
-- ---------------------------------------------------------------------

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)   on delete restrict,
  branch_id     uuid not null references public.branches(id)  on delete restrict,
  student_id    uuid not null references public.students(id)  on delete restrict,
  contract_id   uuid references public.contracts(id) on delete set null,
  -- Hisob davri: har doim oyning 1-sanasi (app.period_start).
  period        date not null,
  status        public.invoice_status not null default 'preliminary',
  -- TZ 12.2.2 — to'lov muddati. Shartnomadagi due_day dan hisoblanadi.
  due_date      date not null,
  generated_at  timestamptz not null default now(),
  finalized_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.app_users(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint invoices_period_is_month check (period = date_trunc('month', period)::date)
);

comment on table public.invoices is
  'Oylik hisoblanma sarlavhasi. JAMI SUMMA BU YERDA SAQLANMAYDI — '
  'u har doim invoice_lines dan hisoblanadi (TZ 4.6.2, 4.12.2).';
comment on column public.invoices.status is
  'preliminary = kunlik xizmatlar taxminiy; final = yo''qlik asosida qayta '
  'hisoblangan; approved = QULFLANGAN, o''zgartirish faqat tuzatuvchi '
  'qator orqali (TZ 4.6.7).';

-- TZ 4.6.8 — takroriy shakllantirishda DUBLIKAT YARATILMAYDI.
create unique index if not exists invoices_student_period_idx
  on public.invoices(student_id, period)
  where status <> 'cancelled';

create index if not exists invoices_period_idx on public.invoices(branch_id, period, status);
create index if not exists invoices_due_idx    on public.invoices(due_date)
  where status in ('preliminary', 'final', 'approved');

select app.attach_touch_trigger('invoices');

-- ---------------------------------------------------------------------
-- 2. HISOBLANMA QATORLARI (TZ 4.6.2, 4.6.3, 4.6.4)
-- ---------------------------------------------------------------------

create table if not exists public.invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id)  on delete restrict,
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  kind           public.invoice_line_kind not null,
  -- TZ 4.6.3 — har bir qator tegishli xizmatga bog'langan bo'ladi.
  service_id     uuid references public.services(id) on delete set null,
  description    text not null,
  -- TZ 4.6.4 — kunlik xizmat qatorida miqdor (kunlar soni) va birlik narxi.
  quantity       numeric(10,2) not null default 1,
  unit_price     numeric(14,2) not null default 0,
  -- Chegirma qatorida MANFIY bo'ladi. Shuning uchun check yo'q.
  amount         numeric(14,2) not null,
  -- TZ 4.6.1 — dastlabki (taxminiy) qatormi yoki yakuniymi.
  is_preliminary boolean not null default false,
  -- Qator qayerdan kelgani: kunlar soni, yo'qliklar, chegirma turi...
  -- Hisobotdan boshlang'ich yozuvga o'tish uchun (TZ 4.12.6).
  source         jsonb,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.invoice_lines is
  'TZ 4.6.2 — hisoblanmaning har bir qatori alohida yozuv. Chegirma '
  'qatori MANFIY summa bilan yoziladi.';
comment on column public.invoice_lines.source is
  'TZ 4.12.6 — raqam qayerdan kelgani: ish kunlari, yo''qliklar soni, '
  'qo''llanilgan narx va uning amal qilish sanasi.';

create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index if not exists invoice_lines_service_idx on public.invoice_lines(service_id);

-- ---------------------------------------------------------------------
-- 3. TO'LOVLAR (TZ 4.7)
-- ---------------------------------------------------------------------

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)   on delete restrict,
  branch_id     uuid not null references public.branches(id)  on delete restrict,
  student_id    uuid not null references public.students(id)  on delete restrict,
  amount        numeric(14,2) not null check (amount > 0),
  channel       public.payment_channel not null,
  status        public.payment_status  not null default 'pending',
  paid_on       date not null default current_date,
  note          text,
  created_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  confirmed_by  uuid references public.app_users(id) on delete set null,
  confirmed_at  timestamptz,
  cancelled_reason text,
  updated_at    timestamptz not null default now()
);

comment on table public.payments is
  'Barcha kanaldagi to''lovlar. QARZDORLIKNI FAQAT status = confirmed '
  'yopadi — chek rasmi (channel = proof, status = pending) yopmaydi (TZ 4.7.3).';

create index if not exists payments_student_idx on public.payments(student_id, paid_on desc);
create index if not exists payments_branch_idx  on public.payments(branch_id, paid_on desc);
create index if not exists payments_status_idx  on public.payments(status)
  where status = 'pending';

select app.attach_touch_trigger('payments');

-- ---------------------------------------------------------------------
-- 4. KASSA KVITANSIYASI (TZ 4.7.1)
-- ---------------------------------------------------------------------

create table if not exists public.cash_receipts (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools(id)  on delete restrict,
  branch_id    uuid not null references public.branches(id) on delete restrict,
  payment_id   uuid not null references public.payments(id) on delete restrict,
  -- TZ 4.7.1.5 — raqamlar FILIAL BO'YICHA uzluksiz ketma-ketlikda.
  receipt_no   bigint not null,
  receipt_code text   not null,
  issued_by    uuid references public.app_users(id) on delete set null,
  issued_at    timestamptz not null default now(),
  cancelled_at timestamptz
);

comment on table public.cash_receipts is
  'TZ 4.7.1.2 — raqamlangan kvitansiya. Raqam app.next_counter orqali '
  'atomar olinadi, shuning uchun ketma-ketlik uzilmaydi va takrorlanmaydi.';

create unique index if not exists cash_receipts_no_idx
  on public.cash_receipts(branch_id, receipt_no);
create unique index if not exists cash_receipts_payment_idx
  on public.cash_receipts(payment_id);

-- ---------------------------------------------------------------------
-- 5. BANK VYPISKASI (TZ 4.7.2)
-- ---------------------------------------------------------------------

create table if not exists public.bank_statements (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id)  on delete restrict,
  branch_id     uuid not null references public.branches(id) on delete restrict,
  -- TZ 4.7.2.5 — yuklangan fayl ASL HOLIDA saqlanadi.
  file_path     text not null,
  file_name     text not null,
  file_hash     text,        -- takroriy yuklashni aniqlash uchun
  period_from   date,
  period_to     date,
  rows_total    integer not null default 0,
  rows_matched  integer not null default 0,
  uploaded_by   uuid references public.app_users(id) on delete set null,
  uploaded_at   timestamptz not null default now(),
  processed_at  timestamptz,
  error         text
);

comment on table public.bank_statements is
  'TZ 4.7.2.5 — yuklangan vypiska fayli asl holida saqlanadi. '
  'rows_matched / rows_total nisbati TZ 4.7.2.6 dagi 80% mezonini o''lchaydi.';

create index if not exists bank_statements_branch_idx
  on public.bank_statements(branch_id, uploaded_at desc);

create table if not exists public.bank_statement_rows (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools(id) on delete restrict,
  statement_id  uuid not null references public.bank_statements(id) on delete cascade,
  row_no        integer not null,
  doc_no        text,
  paid_on       date not null,
  amount        numeric(14,2) not null check (amount > 0),
  payer_name    text,
  purpose       text,
  -- To'lov maqsadidan ajratib olingan kod (TZ 4.7.2.2).
  payment_code  text,
  student_id    uuid references public.students(id) on delete set null,
  payment_id    uuid references public.payments(id) on delete set null,
  -- 'auto' = kod bo'yicha topildi, 'manual' = buxgalter qo'lda biriktirdi
  match_kind    text check (match_kind in ('auto', 'manual')),
  matched_at    timestamptz,
  matched_by    uuid references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.bank_statement_rows is
  'Vypiska qatorlari. Biriktirilmaganlari (student_id is null) alohida '
  'ro''yxatga tushadi va qo''lda biriktiriladi (TZ 4.7.2.3).';

-- TZ 4.7.2.4 — TAKRORIY YUKLASHDA DUBLIKAT YARATILMAYDI.
-- Bir maktabda bir xil sana + summa + hujjat raqami ikki marta kirmaydi.
create unique index if not exists bank_statement_rows_dedupe_idx
  on public.bank_statement_rows(school_id, paid_on, amount, coalesce(doc_no, ''), coalesce(payment_code, ''));

create index if not exists bank_statement_rows_statement_idx
  on public.bank_statement_rows(statement_id, row_no);
create index if not exists bank_statement_rows_unmatched_idx
  on public.bank_statement_rows(school_id) where student_id is null;

-- ---------------------------------------------------------------------
-- 6. CHEK TASDIQLASH (TZ 4.7.3, 4.7.4)
-- ---------------------------------------------------------------------

create table if not exists public.payment_proofs (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id)   on delete restrict,
  branch_id        uuid not null references public.branches(id)  on delete restrict,
  student_id       uuid not null references public.students(id)  on delete cascade,
  parent_id        uuid references public.parents(id) on delete set null,
  -- Tasdiqlangandan keyin yaratilgan haqiqiy to'lov.
  payment_id       uuid references public.payments(id) on delete set null,
  -- Siqilgan nusxa yo'li (TZ 4.7.4.2 — asl fayl o'rniga saqlanadi).
  file_path        text,
  telegram_file_id text,
  amount_claimed   numeric(14,2) check (amount_claimed is null or amount_claimed > 0),
  status           public.payment_status not null default 'pending',
  submitted_at     timestamptz not null default now(),
  reviewed_by      uuid references public.app_users(id) on delete set null,
  reviewed_at      timestamptz,
  reject_reason    text,
  -- TZ 4.7.4.4 — fayl o'chirilganda YOZUV SAQLANADI: kim, qachon
  -- yuborgan, qachon o'chirilgan.
  file_deleted_at  timestamptz,
  -- Buxgalterga 60 kunlik ogohlantirish yuborilganmi (TZ 4.7.3.6).
  stale_notified_at timestamptz
);

comment on table public.payment_proofs is
  'Telegram orqali kelgan chek rasmlari. TZ 4.7.3 — chek qarzdorlikni '
  'YOPMAYDI. Buxgalter tasdiqlagandan keyingina payments yozuvi yaratiladi.';
comment on column public.payment_proofs.file_deleted_at is
  'TZ 4.7.4.4 — fayl o''chirilsa ham yozuvning o''zi saqlanadi.';

create index if not exists payment_proofs_pending_idx
  on public.payment_proofs(school_id, submitted_at)
  where status = 'pending';
create index if not exists payment_proofs_student_idx
  on public.payment_proofs(student_id, submitted_at desc);

-- =====================================================================
--  7. KO'RINISHLAR — JAMI VA QARZDORLIK (TZ 4.8.1, 4.12.2)
--
--  `security_invoker = true` MAJBURIY: aks holda ko'rinish RLS ni
--  chetlab o'tadi va bir maktab boshqasining ma'lumotini ko'rardi.
-- =====================================================================

-- Hisoblanma jamisi — har doim qatorlardan.
create or replace view public.v_invoice_totals
with (security_invoker = true) as
select
  i.id            as invoice_id,
  i.school_id,
  i.branch_id,
  i.student_id,
  i.period,
  i.status,
  i.due_date,
  coalesce(sum(l.amount), 0)::numeric(14,2) as total,
  coalesce(sum(l.amount) filter (where l.is_preliminary), 0)::numeric(14,2) as preliminary_total,
  count(l.id) filter (where l.is_preliminary) > 0 as has_preliminary
from public.invoices i
left join public.invoice_lines l on l.invoice_id = i.id
group by i.id;

comment on view public.v_invoice_totals is
  'TZ 4.6.2/4.12.2 — hisoblanma jamisi saqlanmaydi, qatorlardan hisoblanadi.';

-- O'quvchi balansi (TZ 4.8.1, 4.8.5).
--   balance > 0  → qarzdorlik
--   balance < 0  → ortiqcha to'lov (avans), keyingi hisoblanmaga o'tadi
create or replace view public.v_student_balances
with (security_invoker = true) as
select
  s.id          as student_id,
  s.school_id,
  s.branch_id,
  s.full_name,
  s.class_name,
  s.payment_code,
  s.status,
  coalesce(inv.charged, 0)::numeric(14,2)  as charged,
  coalesce(pay.paid, 0)::numeric(14,2)     as paid,
  (coalesce(inv.charged, 0) - coalesce(pay.paid, 0))::numeric(14,2) as balance,
  coalesce(overdue.amount, 0)::numeric(14,2) as overdue_charged,
  inv.oldest_unpaid_due
from public.students s
left join lateral (
  select sum(t.total) as charged,
         min(t.due_date) filter (where t.due_date < current_date) as oldest_unpaid_due
    from public.v_invoice_totals t
   where t.student_id = s.id
     and t.status <> 'cancelled'
) inv on true
left join lateral (
  -- FAQAT tasdiqlangan to'lov qarzni yopadi (TZ 4.7.3).
  select sum(p.amount) as paid
    from public.payments p
   where p.student_id = s.id
     and p.status = 'confirmed'
) pay on true
left join lateral (
  -- TZ 4.8.3 — muddati o'tgan qarzdorlik alohida ajratiladi.
  select sum(t.total) as amount
    from public.v_invoice_totals t
   where t.student_id = s.id
     and t.status <> 'cancelled'
     and t.due_date < current_date
) overdue on true
where s.deleted_at is null;

comment on view public.v_student_balances is
  'TZ 4.8.1 — qarzdorlik real vaqtda: hisoblanma − TASDIQLANGAN to''lovlar. '
  'Manfiy balans = avans (TZ 4.8.5).';
