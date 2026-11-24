-- =====================================================================
--  ESKI OYLARNI HISOBDAN CHIQARISH ("hisob shu oydan boshlanadi")
--
--  Maktab tizimga o'quv yili o'rtasida o'tsa, eski oylar hisoblanmasi
--  qog'ozda allaqachon yopilgan bo'ladi, panelda esa qarz bo'lib
--  turadi. Direktor bitta amal bilan: "hisob noyabrdan boshlanadi"
--  deydi — undan oldingi hisoblanmalar BEKOR qilinadi (o'chirilmaydi:
--  sabab va kim qilgani audit jurnalida) va qayta tuzilmaydi.
--
--  Mavjud to'lovlar o'chmaydi — ular FIFO bo'yicha birinchi qolgan
--  oyga (boshlanish oyiga) tushadi.
-- =====================================================================

create or replace function public.write_off_before(
  p_start  date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_school uuid := app.school_id();
  v_start  date := date_trunc('month', p_start)::date;
  v_closed date;
  v_n      int;
  v_sum    numeric(14,2);
begin
  if v_school is null then
    raise exception 'Maktab aniqlanmadi' using errcode = '22023';
  end if;
  if app.role() is distinct from 'director' then
    raise exception 'Eski oylarni faqat direktor hisobdan chiqaradi' using errcode = '42501';
  end if;
  if app.is_readonly_session() then
    raise exception 'Texnik yordam sessiyasi faqat o''qish rejimida' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Sababni yozing' using errcode = '22023';
  end if;
  if v_start > date_trunc('month', current_date)::date then
    raise exception 'Kelajakdagi oyni tanlab bo''lmaydi' using errcode = '22023';
  end if;

  select min(period) into v_closed
    from public.closed_periods
   where school_id = v_school and period < v_start;
  if v_closed is not null then
    raise exception 'Yopilgan oy bor (%): avval uni qayta oching',
      to_char(v_closed, 'MM.YYYY') using errcode = '23514';
  end if;

  select count(*), coalesce(sum(t.total), 0) into v_n, v_sum
    from public.v_invoice_totals t
   where t.school_id = v_school and t.period < v_start and t.status <> 'cancelled';

  update public.invoices
     set status = 'cancelled',
         note = coalesce(note || ' | ', '') || 'Hisobdan chiqarildi: ' || btrim(p_reason)
   where school_id = v_school and period < v_start and status <> 'cancelled';

  insert into public.school_settings (school_id, key, value, note)
  values (v_school, 'billing.starts_on', to_jsonb(v_start::text), btrim(p_reason))
  on conflict (school_id, key) do update
    set value = excluded.value, note = excluded.note;

  return jsonb_build_object('starts_on', v_start, 'cancelled', v_n, 'amount', v_sum);
end;
$$;

revoke all on function public.write_off_before(date, text) from public, anon;
grant execute on function public.write_off_before(date, text) to authenticated;

comment on function public.write_off_before(date, text) is
  'Direktor: tanlangan oydan oldingi barcha hisoblanmalarni bekor qiladi, '
  'hisob shu oydan boshlanadi (billing.starts_on).';

-- ---------------------------------------------------------------------
--  Hisob boshlanishidan oldingi oyga hisoblanma QAYTA tuzilmasin —
--  qo'lda ham, avtomatika ham.
-- ---------------------------------------------------------------------
create or replace function app.guard_billing_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date;
begin
  v_start := (app.school_setting(new.school_id, 'billing.starts_on') #>> '{}')::date;
  if v_start is not null and new.period < v_start and new.status <> 'cancelled' then
    raise exception 'Hisob % dan boshlanadi — undan oldingi oyga hisoblanma tuzilmaydi',
      to_char(v_start, 'MM.YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_billing_start on public.invoices;
create trigger trg_invoices_billing_start
  before insert or update of status on public.invoices
  for each row execute function app.guard_billing_start();
