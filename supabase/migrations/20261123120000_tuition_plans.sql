-- =====================================================================
--  TARIFLAR (o'qish narxlari)
--
--  Ilgari har shartnomada oylik narx QO'LDA yozilardi. 230 o'quvchida
--  bu 230 marta bir xil raqamni terish va har safar xato qilish
--  imkoniyati edi — "1 700 000" o'rniga "1 750 000" yozilsa, hech kim
--  sezmasdi.
--
--  Endi maktab Sozlamalarda tariflar yaratadi: "Boshlang'ich sinflar
--  (1–4)", "Yuqori sinflar (5–11)", "Bog'cha" — o'quv yili bo'yicha.
--  O'quvchi qo'shilganda sinfiga mos tarif o'zi tanlanadi, chegirma
--  shu narxdan hisoblanadi.
--
--  Shartnomada narx BARIBIR nusxalanib saqlanadi (tuition_amount):
--  kelasi yili tarif o'zgarsa, eski shartnomalar va o'tgan oylar
--  hisoblanmasi o'zgarmasligi kerak. `tuition_plan_id` faqat "qaysi
--  tarifdan olingan" degan iz.
-- =====================================================================

create table if not exists public.tuition_plans (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id),
  branch_id      uuid references public.branches(id),
  name           text not null check (length(btrim(name)) > 0),
  academic_year  text,
  grade_from     smallint check (grade_from between 0 and 12),
  grade_to       smallint check (grade_to between 0 and 12),
  monthly_amount numeric(14,2) not null check (monthly_amount >= 0),
  is_active      boolean not null default true,
  sort_order     smallint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (grade_from is null or grade_to is null or grade_from <= grade_to)
);

comment on table public.tuition_plans is
  'O''qish tariflari: sinf oralig''i va o''quv yili bo''yicha oylik narx. '
  'Shartnoma yaratilganda narx shu yerdan nusxalanadi.';

create index if not exists tuition_plans_school_idx
  on public.tuition_plans (school_id, is_active);

alter table public.tuition_plans enable row level security;

create policy tuition_plans_select on public.tuition_plans
  for select to authenticated
  using ((school_id = (select app.school_id())) or (select app.is_platform_admin()));

create policy tuition_plans_insert on public.tuition_plans
  for insert to authenticated
  with check (((school_id = (select app.school_id()))
               and (select app.may_write('services.manage')))
              or (select app.is_platform_admin()));

create policy tuition_plans_update on public.tuition_plans
  for update to authenticated
  using (((school_id = (select app.school_id()))
          and (select app.may_write('services.manage')))
         or (select app.is_platform_admin()))
  with check (((school_id = (select app.school_id()))
               and (select app.may_write('services.manage')))
              or (select app.is_platform_admin()));

--  O'chirish yo'q (TZ 5.4.8) — tarif nofaol qilinadi.
grant select, insert, update on public.tuition_plans to authenticated;
grant all on public.tuition_plans to service_role;

create trigger trg_tuition_plans_audit
  after insert or delete or update on public.tuition_plans
  for each row execute function app.audit_trigger();

create trigger trg_tuition_plans_touch
  before update on public.tuition_plans
  for each row execute function app.touch_updated_at();

alter table public.contracts
  add column if not exists tuition_plan_id uuid references public.tuition_plans(id);

comment on column public.contracts.tuition_plan_id is
  'Narx qaysi tarifdan olingani (iz). Narxning o''zi tuition_amount da.';

-- ---------------------------------------------------------------------
--  Boshlang'ich tariflar — mavjud shartnomalardan.
--
--  Har maktab uchun sinf darajasi (grade_level) bo'yicha ENG KO'P
--  uchraydigan oylik narx olinadi. Direktor Sozlamalarda ko'radi va
--  nomini/oralig'ini to'g'rilaydi. Tarif bo'lmasa — bo'sh qoladi.
-- ---------------------------------------------------------------------
insert into public.tuition_plans
  (school_id, name, grade_from, grade_to, monthly_amount, sort_order)
select x.school_id,
       case when x.grade_level is null or x.grade_level = 0
            then 'Bog''cha'
            else x.grade_level || '-sinf' end,
       x.grade_level, x.grade_level, x.amount,
       coalesce(x.grade_level, 0)
  from (
    select distinct on (st.school_id, st.grade_level)
           st.school_id, st.grade_level, c.tuition_amount as amount
      from public.contracts c
      join public.students st on st.id = c.student_id
     where c.is_active and st.deleted_at is null and c.tuition_amount > 0
     group by st.school_id, st.grade_level, c.tuition_amount
     order by st.school_id, st.grade_level, count(*) desc
  ) x
 where not exists (select 1 from public.tuition_plans p where p.school_id = x.school_id);
