-- =====================================================================
--  SHAXSIY HUQUQLAR
--
--  Huquqlar faqat ROL bo'yicha berilardi: buxgalterga nima ruxsat
--  bo'lsa, hamma buxgalterga o'sha. Amalda maktabda bunday emas —
--  bitta buxgalterga qarzdorlik bilan ishlash ishonib topshiriladi,
--  ikkinchisiga yo'q; navbatchiga vaqtincha o'quvchi qo'shish
--  ruxsati beriladi.
--
--  Ilgari bunday holatda yagona yo'l ROLNI o'zgartirish edi. U esa
--  keragidan ko'p ruxsat berardi: navbatchini buxgalter qilsangiz,
--  u oylikni ham ko'radi.
--
--  Endi rol ASOS bo'lib qoladi, ustiga esa shaxsiy o'zgartirish
--  qo'yiladi: qo'shimcha ruxsat yoki aksincha, olib qo'yish.
-- =====================================================================

create table if not exists public.user_permissions (
  user_id    uuid    not null references public.app_users(id) on delete cascade,
  permission text    not null,
  --  `true` — qo'shimcha berildi, `false` — roldagi ruxsat olindi.
  allowed    boolean not null,
  note       text,
  granted_by uuid    references public.app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);

comment on table public.user_permissions is
  'Roldan tashqari shaxsiy huquq. Rol asos bo''lib qoladi, bu jadval '
  'uning ustiga qo''yiladi: `true` — qo''shimcha, `false` — olib qo''yish.';

alter table public.user_permissions enable row level security;

--  Ko'rish: xodimlarni boshqara oladigan odam va odamning O'ZI.
create policy user_permissions_select on public.user_permissions
  for select using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.app_users u
       where u.id = user_permissions.user_id
         and u.school_id = (select app.school_id())
         and (select app.can('users.manage'))
    )
    or (select app.is_platform_admin())
  );

--  Yozish faqat RPC orqali: u o'zini o'zi huquqsiz qoldirishdan
--  ham himoya qiladi.

-- =====================================================================
--  `app.can` — shaxsiy o'zgartirish BIRINCHI o'rinda
-- =====================================================================

create or replace function app.can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    --  1. Shaxsiy o'zgartirish. `false` bo'lsa ham SHU javob
    --  qaytadi — ya'ni roldagi ruxsatni olib qo'yish ishlaydi.
    (select up.allowed
       from public.user_permissions up
       join public.app_users u
         on u.id = up.user_id and u.is_active and u.deleted_at is null
      where up.user_id = (select auth.uid())
        and up.permission = p_permission),

    --  2. Rol.
    (select rp.allowed
       from public.role_permissions rp
       join public.app_users u
         on u.id = (select auth.uid())
        and u.is_active
        and u.deleted_at is null
      where rp.role = u.role
        and rp.permission = p_permission
        and (rp.school_id is null or rp.school_id = u.school_id)
      -- Maktab moslamasi birinchi: school_id to'ldirilgani ustun.
      order by rp.school_id nulls last
      limit 1),

    false);
$$;

-- =====================================================================
--  BITTA XODIMNING HUQUQLARI — ro'yxat
--
--  Rol nima berayotgani va shaxsiy o'zgartirish alohida qaytariladi:
--  ekranda "roldan keladi" bilan "qo'lda qo'shilgan" ni ajratib
--  ko'rsatish kerak, aks holda kim nima berganini keyin bilib
--  bo'lmaydi.
-- =====================================================================

create or replace function public.user_permission_matrix(p_user_id uuid)
returns table (
  permission   text,
  from_role    boolean,
  override     boolean,   -- null bo'lsa o'zgartirilmagan
  effective    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select u.id, u.role, u.school_id
      from public.app_users u
     where u.id = p_user_id
       and u.school_id = (select app.school_id())
       and u.deleted_at is null
  ),
  base as (
    select distinct rp.permission
      from public.role_permissions rp
  ),
  role_allowed as (
    select b.permission,
           coalesce((
             select rp.allowed
               from public.role_permissions rp, target t
              where rp.role = t.role
                and rp.permission = b.permission
                and (rp.school_id is null or rp.school_id = t.school_id)
              order by rp.school_id nulls last
              limit 1
           ), false) as allowed
      from base b
  )
  select
    ra.permission,
    ra.allowed,
    up.allowed,
    coalesce(up.allowed, ra.allowed)
  from role_allowed ra
  left join public.user_permissions up
         on up.user_id = p_user_id and up.permission = ra.permission
  where exists (select 1 from target)
  order by ra.permission;
$$;

comment on function public.user_permission_matrix(uuid) is
  'Xodimning huquqlari: roldan nima kelayotgani, qo''lda nima '
  'o''zgartirilgani va yakuniy natija.';

grant execute on function public.user_permission_matrix(uuid) to authenticated;

-- =====================================================================
--  HUQUQNI O'ZGARTIRISH
--
--  `p_allowed = null` — shaxsiy o'zgartirish olib tashlanadi va
--  xodim rolining odatiy huquqiga qaytadi.
-- =====================================================================

create or replace function public.set_user_permission(
  p_user_id    uuid,
  p_permission text,
  p_allowed    boolean default null,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u public.app_users%rowtype;
begin
  perform app.assert_may_write('users.manage');

  select * into u from public.app_users
   where id = p_user_id
     and school_id = (select app.school_id())
     and deleted_at is null;
  if not found then
    raise exception 'Xodim topilmadi' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.role_permissions where permission = p_permission
  ) then
    raise exception 'Bunday huquq yo''q: %', p_permission using errcode = '22023';
  end if;

  --  O'ZINI huquqsiz qoldirib bo'lmaydi. Aks holda maktabda xodim
  --  qo'sha oladigan odam umuman qolmasligi va tizimga faqat
  --  platforma operatori orqali kirish mumkin bo'lib qolishi mumkin.
  if p_user_id = (select auth.uid())
     and p_permission = 'users.manage'
     and coalesce(p_allowed, true) = false then
    raise exception 'O''zingizdan xodim boshqarish huquqini olib bo''lmaydi'
      using errcode = '42501';
  end if;

  if p_allowed is null then
    delete from public.user_permissions
     where user_id = p_user_id and permission = p_permission;
    return jsonb_build_object('permission', p_permission, 'override', null);
  end if;

  insert into public.user_permissions
    (user_id, permission, allowed, note, granted_by)
  values
    (p_user_id, p_permission, p_allowed, nullif(btrim(p_note), ''),
     (select auth.uid()))
  on conflict (user_id, permission) do update
    set allowed    = excluded.allowed,
        note       = excluded.note,
        granted_by = excluded.granted_by,
        granted_at = now();

  return jsonb_build_object('permission', p_permission, 'override', p_allowed);
end;
$$;

comment on function public.set_user_permission(uuid, text, boolean, text) is
  'Xodimga roldan tashqari huquq beradi yoki roldagisini olib '
  'qo''yadi. `p_allowed = null` — odatiy holatga qaytaradi.';

grant execute on function public.set_user_permission(uuid, text, boolean, text)
  to authenticated;
