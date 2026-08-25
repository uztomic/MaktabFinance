# Super admin tizimi — texnik topshiriq va prompt

> Bu hujjat **ikki vazifani** bajaradi:
> 1. MaktabFinance ning bugungi holatini aniq tasvirlaydi;
> 2. Super admin panelini qurish uchun to'liq topshiriq beradi.
>
> Uni to'liq holicha AI ga yoki dasturchiga berish mumkin — qo'shimcha
> savol bermasdan ishni boshlash uchun yetarli ma'lumot bor.

---

# 1-QISM. MAVJUD TIZIM

## 1.1. Nima qurilgan

**MaktabFinance** — xususiy maktablar uchun moliya va boshqaruv tizimi.
Ko'p ijarachili (multi-tenant): bitta baza, ko'p maktab, ular
bir-birini **umuman ko'rmaydi**.

| | |
|---|---|
| Baza | Supabase PostgreSQL 17 |
| Jadval | 53 ta, hammasida RLS |
| Ko'rinish | 3 ta, hammasi `security_invoker` |
| Funksiya | 44 ta `public`, 50 ta `app` |
| RLS siyosati | 106 ta |
| Migratsiya | 37 ta |
| Edge Function | 3 ta (Deno) |
| Cron | 3 ta |
| Panel | React 19 + TypeScript + Vite 7 + Tailwind 4, PWA |
| Til | uz / uz-cyrl / ru — 882 ta kalit |
| Joylashuv | GitHub Pages, `maktab.uztomic.uz` |

Kod: `github.com/uztomic/MaktabFinance` (ochiq).

## 1.2. Xavfsizlik modeli — buni buzmaslik SHART

Butun himoya ikki qatlamda:

| Qatlam | Vazifasi |
|---|---|
| **JWT** | foydalanuvchi kimligi |
| **RLS** | qaysi QATORLARNI ko'rishi — baza darajasida |

RLS jadval darajasida ishlaydi. So'rov qayerdan kelishidan qat'i
nazar — panel, `curl`, to'g'ridan-to'g'ri PostgREST — bir xil
cheklanadi.

**O'nta invariant** bazaning o'zida tekshiriladi
(`app.security_invariants()`), sinov zanjirida chaqiriladi va biror
biri buzilsa **xato tashlaydi**:

1. Har bir jadvalda RLS
2. `anon` roliga hech qanday huquq yo'q
3. Hech qayerda `DELETE` huquqi yo'q (TZ 5.4.8)
4. Moliyaviy jadvallar mijoz uchun faqat o'qish (TZ 5.4.6)
5. `SECURITY DEFINER` da `search_path` o'rnatilgan
6. Barcha view `security_invoker` bilan
7. Pul ustunlari `numeric`
8. Storage bucket lari yopiq
9. `role_permissions` ga mijozdan yozib bo'lmaydi
10. Har bir siyosatda ijarachi filtri

> **Super admin bu invariantlarning birontasini buzmasligi kerak.**
> Yangi jadval qo'shsangiz — RLS yoqing. Yangi funksiya —
> `search_path = ''` qo'ying.

### RLS tezligi haqida — muhim naqsh

Siyosat ifodasidagi funksiya chaqiruvi `(select ...)` ichiga
olinishi SHART:

```sql
-- NOTO'G'RI — har bir qator uchun chaqiriladi
school_id = app.school_id()

-- TO'G'RI — butun so'rov uchun bir marta (InitPlan)
school_id = (select app.school_id())
```

Farq o'lchangan: `658 ms → 9 ms`. Busiz hisobotlar vaqt chegarasiga
uriladi. Migratsiya 36 buni barcha siyosatga qo'llagan.

## 1.3. Platforma qatlami — ALLAQACHON BOR

Super admin uchun **baza tayyor**. Quyidagilar mavjud va ishlaydi:

### Jadvallar

```
platform_admins
  id (= auth.users.id), full_name, email, phone, is_active, created_at

platform_log                          — faqat qo'shish, o'zgarmas
  id, admin_id, action, entity, entity_id, school_id, before, after, at

plans
  id, code, name, monthly_price, max_students, max_branches,
  features (jsonb), is_active, sort_order

school_subscriptions
  id, school_id, plan_id, status, monthly_amount,
  trial_ends_at, next_payment_date, last_paid_at, note

impersonation_sessions
  id, admin_id, school_id, target_user_id, mode, reason,
  started_at, expires_at, ended_at

impersonation_log                     — faqat qo'shish
  id, session_id, admin_id, school_id, target_user_id,
  mode, action, detail, at

schools
  id, name, legal_name, tax_id, address, phone, email,
  status, timezone, default_lang, closing_day, deleted_at
```

### Holatlar

| Enum | Qiymatlar |
|---|---|
| `school_status` | `trial`, `active`, `restricted`, `archived` |
| `subscription_status` | `trial`, `active`, `grace`, `restricted`, `cancelled` |
| `impersonation_mode` | `read`, `write` |

### Funksiyalar

| Funksiya | Nima qiladi |
|---|---|
| `public.provision_school(name, branch, plan_code, trial_days, address, phone)` | maktab + filial + obuna + barcha shablon sozlama |
| `public.seed_school_defaults(school_id)` | xarajat kategoriyalari, chegirma turlari, yo'qlik sabablari, kalendar, oylik parametrlari |
| `app.is_platform_admin()` | chaqiruvchi super adminmi |
| `app.school_is_writable()` | maktab `trial`/`active` holatidami |
| `app.is_readonly_session()` | texnik yordam sessiyasi o'qish rejimidami |
| `app.is_impersonating()` | sessiya texnik yordam sessiyasimi |
| `app.jwt_claim(key)` | JWT dan claim o'qish |
| `public.custom_access_token_hook(event)` | Auth hook — JWT ga `imp_*` claim'larini qo'yadi |

### Texnik yordam (impersonation) mexanizmi

**Ishlash tartibi allaqachon qurilgan:**

1. `impersonation_sessions` ga yozuv qo'yiladi (`mode`, `expires_at`);
2. Maktab foydalanuvchisi token olganda Supabase Auth
   `custom_access_token_hook` ni chaqiradi;
3. Hook faol sessiyani topsa, JWT ga `imp_mode`, `imp_admin`,
   `imp_session`, `imp_exp` claim'larini qo'yadi;
4. Claim'lar **token ichida imzolangan** — mijoz ularni o'zgartira
   olmaydi;
5. `app.is_readonly_session()` har bir yozuv siyosatida tekshiriladi:
   `read` rejimida yoki muddati o'tgan bo'lsa — yozib bo'lmaydi;
6. Panelda sariq banner chiqadi (`AppShell.tsx`).

### Himoya qoidalari

- **Super admin faqat O'QIY oladi.** `platform_admins_select`
  siyosati `app.is_platform_admin()` ga bog'langan, yozish
  siyosatlari yo'q.
- **Yozish faqat impersonation orqali**, u esa **ikkita jurnalga**
  tushadi: `impersonation_log` va `audit_log` (`impersonated_by`
  ustuni bilan).
- **Maktab holatini faqat platforma o'zgartiradi** —
  `app.guard_school_status()` triggeri buni majburlaydi.
  Direktor o'zining `restricted` holatini `active` ga qaytara
  olmaydi.

## 1.4. Nima YO'Q — super admin qilishi kerak bo'lgan ish

| Yo'q narsa | Izoh |
|---|---|
| `apps/super-admin/` ilovasi | **butunlay yo'q** |
| `start_impersonation(...)` RPC | sessiya jadvali bor, ochish funksiyasi yo'q |
| `end_impersonation(...)` RPC | yo'q |
| Maktab holatini o'zgartirish RPC | `guard_school_status` platformaga ruxsat beradi, lekin funksiya yozilmagan |
| Obunani boshqarish RPC | `school_subscriptions` bor, boshqaruv yo'q |
| Platforma miqyosidagi hisobot | yo'q |
| Super admin hisobini yaratish skripti | `platform_admins` ga qo'lda insert qilinadi |

## 1.5. Ma'lumot hozir qanday

Bazada **"Zamon maktabi"** — ikki o'quv yilidan beri ishlab kelayotgan
namuna maktab (`scripts/seed-school.mjs` quradi):

```
152 o'quvchi (bog'cha 3 guruh + 1–9 sinf)   22 o'qituvchi   8 xodim hisobi
2 603 hisoblanma   2 496 to'lov   528 oylik hisobi   54 968 audit yozuvi
24 oylik uzluksiz tarix: 2024-09 … 2026-08
```

Super admin panelini shu ma'lumotda sinash mumkin.

## 1.6. Ishlab chiqish asboblari

```bash
node scripts/db.mjs push          # migratsiya (DB paroli kerak emas)
node scripts/db.mjs sql "..."     # bitta so'rov
npm run db:types                  # bazadan TypeScript turlari
npm run audit                     # kod + xavfsizlik + ma'lumot + sirlar
npm run test:db                   # 5 ta sinov fayli
node scripts/smoke-test.mjs <email>   # har bir so'rov jonli token bilan
```

`db.mjs` Management API orqali ishlaydi — DB parolini talab qilmaydi,
migratsiya tarixini Supabase CLI ishlatadigan **aynan o'sha** jadvalda
yuritadi.

---

# 2-QISM. SUPER ADMIN — TOPSHIRIQ

## 2.1. Maqsad va kim uchun

**Kim ishlatadi:** Uztomic Solutions xodimlari (2–5 kishi).

**Nima uchun:** maktablarni ulash, obunani yuritish, to'lovni
kuzatish, texnik yordam ko'rsatish.

**Asosiy tamoyil:** super admin **mijoz ma'lumotini ko'rmaydi**.
U maktablarning **ro'yxatini**, **holatini** va **o'lchamini**
ko'radi. O'quvchi ismi, to'lov summasi, qarzdorlik — faqat
impersonation orqali va **ikkita jurnalga yozilgan holda**.

> Bu qat'iy talab. Maktab moliyasi — maxfiy ma'lumot. "Bir qarab
> qo'yaman" degan imkoniyat bo'lmasligi kerak.

## 2.2. Alohida ilova — SHART

```
apps/
├── maktab-panel/     mavjud — maktab xodimlari uchun
└── super-admin/      yangi   — platforma uchun
```

**Nega alohida:** maktab paneliga super admin kodi **hech qachon**
tushmasligi kerak. Bitta ilovada rol bo'yicha yashirish yetarli
emas — kod baribir brauzerga yuklanadi va uni o'qish mumkin.

Umumiy narsalar (`ui/`, `i18n/`, `lib/format`) **nusxa ko'chiriladi**
yoki `packages/shared/` ga chiqariladi. Ikkinchisi toza, lekin build
sozlamasini murakkablashtiradi — loyiha hajmiga qarab tanlang.

**Joylashuv:** alohida subdomen, masalan `admin.uztomic.uz`.
Alohida GitHub Actions ishi.

## 2.3. Ekranlar

### E1. Maktablar ro'yxati — asosiy ekran

Har bir qatorda:

| Ustun | Manba |
|---|---|
| Nomi | `schools.name` |
| Holati | `schools.status` — nishon bilan |
| Tarif | `plans.name` |
| O'quvchi | `count(students)` / `plans.max_students` |
| Filial | `count(branches)` / `plans.max_branches` |
| Oylik to'lov | `school_subscriptions.monthly_amount` |
| Keyingi to'lov | `next_payment_date` — muddati o'tgani **qizil** |
| Oxirgi faollik | `max(audit_log.at)` |

Filtrlar: holat, tarif, "muddati o'tgan", "sinov tugayapti".
Qidiruv: nom, INN, telefon.

**Chegara oshgani ko'rinsin.** O'quvchi soni tarif chegarasidan
oshgan maktab qatori ajralib tursin — bu sotuv imkoniyati.

### E2. Maktab kartochkasi

**Faqat o'lcham va holat, mazmun emas:**

- asosiy ma'lumot (nom, INN, manzil, telefon, direktor);
- obuna: tarif, holat, summa, sanalar, to'lov tarixi;
- o'lcham: o'quvchi, filial, xodim, o'qituvchi soni;
- faollik: oxirgi kirish, oxirgi hisoblanma, oxirgi to'lov —
  **sanalar, summalar emas**;
- amallar: tarifni o'zgartirish, holatni o'zgartirish, texnik
  yordam sessiyasi ochish;
- shu maktab bo'yicha platforma jurnali.

### E3. Yangi maktab ulash

Bitta forma → `provision_school(...)` → direktor hisobi
(Admin API orqali) → **login va parol bir marta ko'rsatiladi**.

Namuna: `scripts/new-school.mjs` — aynan shu ishni buyruq satridan
qiladi. Parol `scripts/password.mjs` orqali yaratilishi shart
(12+ belgi, harf turlari kafolatlangan) — aks holda Supabase parol
siyosati rad etadi.

### E4. Obuna va to'lovlar

- tarifni o'zgartirish (`plans` katalogidan);
- to'lovni belgilash → `last_paid_at`, `next_payment_date` yangilanadi;
- holat o'zgarishi: `trial → active → grace → restricted`;
- muddati o'tganlar ro'yxati;
- oylik daromad: nechta maktab, qancha summa.

**Muhim:** `restricted` holatidagi maktab **yozib bo'lmaydi**, lekin
**o'qiy oladi**. Ma'lumot yo'qolmaydi — `app.school_is_writable()`
aynan shunday yozilgan. To'lovdan keyin `active` ga qaytariladi va
hamma narsa joyida bo'ladi.

### E5. Texnik yordam (impersonation)

Sessiya ochish oynasi:

| Maydon | Talab |
|---|---|
| Maktab | ro'yxatdan |
| Foydalanuvchi | shu maktabning `app_users` idan |
| Rejim | `read` (standart) yoki `write` |
| Sabab | **majburiy**, kamida 10 belgi |
| Muddat | 15 / 30 / 60 daqiqa, standart 30 |

Sessiya ochilgach super admin maktab paneliga o'tadi va sariq
banner ko'rinadi.

**`write` rejimi qo'shimcha tasdiqlash talab qilsin.** U mijoz
ma'lumotini o'zgartiradi.

### E6. Platforma jurnali

`platform_log` + `impersonation_log` birlashgan vaqt chizig'i.
Filtr: admin, maktab, amal turi, sana.

**O'chirib bo'lmaydi.** Jadvallarda `DELETE` siyosati yo'q va
bo'lmasligi kerak.

### E7. Platforma ko'rsatkichlari

- maktablar: jami, faol, sinovda, cheklangan;
- oylik daromad va uning dinamikasi;
- yangi maktablar (oylar bo'yicha);
- chiqib ketganlar;
- tizim yuki: jami o'quvchi, jami to'lov, baza hajmi;
- yuborilmagan xabarlar, xatolik bergan cron ishlari.

## 2.4. Bazada nima qo'shish kerak

### M1. Impersonation RPC lari

```sql
public.start_impersonation(
  p_school_id      uuid,
  p_target_user_id uuid,
  p_mode           impersonation_mode default 'read',
  p_reason         text,
  p_minutes        int default 30
) returns jsonb
```

Talablar:

- `app.is_platform_admin()` tekshiruvi — aks holda `42501`;
- `p_reason` bo'sh yoki 10 belgidan qisqa bo'lsa rad etish;
- `p_minutes` 5 dan 120 gacha;
- maqsadli foydalanuvchi **aynan shu maktabda** ekanini tekshirish;
- shu admin uchun **bitta vaqtda bitta faol sessiya** —
  aks holda qaysi sessiya amalda ishlayotgani chalkashadi;
- `impersonation_sessions` va `impersonation_log` ga yozish;
- `platform_log` ga ham yozish.

```sql
public.end_impersonation(p_session_id uuid) returns jsonb
```

- `ended_at = now()`;
- faqat sessiyani ochgan admin yoki boshqa super admin yopa oladi;
- jurnalga yozish.

> **Diqqat:** JWT dagi claim'lar sessiya yopilgandan keyin ham
> token muddati tugaguncha amal qiladi. Shuning uchun
> `app.is_readonly_session()` **`imp_exp` ni ham tekshiradi**.
> Sessiya muddati tokendan qisqa bo'lishi shart.

### M2. Maktab holatini boshqarish

```sql
public.set_school_status(
  p_school_id uuid,
  p_status    school_status,
  p_reason    text
) returns jsonb
```

- faqat platforma admini;
- sabab majburiy;
- `platform_log` ga `before`/`after` bilan;
- `archived` ga o'tkazish **qo'shimcha tasdiqlash** talab qilsin.

### M3. Obunani boshqarish

```sql
public.set_school_plan(p_school_id uuid, p_plan_code text, p_reason text)
public.record_subscription_payment(p_school_id uuid, p_amount numeric,
                                   p_paid_on date, p_months int default 1)
```

- `next_payment_date` avtomatik siljitiladi;
- holat `grace` da bo'lsa `active` ga qaytariladi;
- hammasi `platform_log` ga.

### M4. Platforma hisoboti

```sql
public.platform_overview() returns table (...)
public.platform_schools()  returns table (...)
```

`security definer`, `app.is_platform_admin()` tekshiruvi bilan.
**Faqat jamlangan raqamlar** — o'quvchi ismi, to'lov summasi kabi
mazmun qaytmasin.

### M5. Super admin hisobini yaratish

`scripts/new-platform-admin.mjs`:

Admin API orqali `auth.users` → `platform_admins` ga yozuv →
login/parol chiqarish. Parol `scripts/password.mjs` dan.

## 2.5. Qat'iy talablar

| # | Talab |
|---|---|
| 1 | Super admin **hech qachon** mijoz ma'lumotini to'g'ridan-to'g'ri ko'rmaydi |
| 2 | Har bir yozuv amali **ikkita jurnalga** tushadi |
| 3 | `write` rejimi sabab va qo'shimcha tasdiqlashsiz ochilmaydi |
| 4 | Sessiya muddati **qat'iy** — muddati o'tgan sessiya yoza olmaydi |
| 5 | Jurnalni o'chirib bo'lmaydi (`DELETE` siyosati yo'q) |
| 6 | O'nta xavfsizlik invarianti buzilmaydi |
| 7 | Kod maktab paneliga tushmaydi — alohida ilova, alohida build |
| 8 | Barcha matn i18n orqali (`npm run audit:code` tekshiradi) |
| 9 | Yangi RPC da `search_path = ''` va `revoke ... from anon` |
| 10 | Siyosatlarda funksiya chaqiruvi `(select ...)` ichida |

## 2.6. Tekshirish

```bash
npm run audit                          # to'rtala audit
npm run test:db                        # baza mantiqi
node scripts/db.mjs sql "select * from app.security_invariants()"
```

Qo'shimcha sinovlar yozilsin (`scripts/test-platform.sql`):

| Nima tekshiriladi | Kutilgan natija |
|---|---|
| Oddiy direktor `start_impersonation` chaqirsa | `42501` |
| Sababsiz sessiya ochish | rad etiladi |
| Muddati o'tgan sessiyada yozish | rad etiladi |
| `read` rejimida yozish | rad etiladi |
| Direktor o'z maktabi holatini o'zgartirsa | `42501` (trigger) |
| `restricted` maktabda o'qish | ishlaydi |
| `restricted` maktabda yozish | rad etiladi |
| Super admin boshqa maktab jurnalini ko'rsa | ko'rinadi (bu normal) |
| Impersonation yozuvi `audit_log` da `impersonated_by` bilan | bor |

## 2.7. Tavsiya etilgan tartib

1. **M1–M3 migratsiyalari** — RPC lar va sinovlar. Baza tayyor
   bo'lmaguncha interfeys yozmang.
2. **`scripts/new-platform-admin.mjs`** — birinchi hisobsiz
   sinab bo'lmaydi.
3. **`apps/super-admin/` skeleti** — kirish, qobiq, marshrutlar.
4. **E1 va E2** — maktablar ro'yxati va kartochka.
5. **E5** — impersonation. Eng nozik qism, alohida sinang.
6. **E3, E4** — ulash va obuna.
7. **E6, E7** — jurnal va ko'rsatkichlar.

---

# 3-QISM. USLUB

Mavjud kod bilan bir xil bo'lsin:

- **Izohlar o'zbekcha, kod ingliz tilida.** Izoh "nima" emas,
  **"nega"** deb yozilsin — qaror sababi.
- **Interfeys matni faqat i18n orqali.** `hint="..."` yozilmaydi.
- **Yozuv o'chirilmaydi** — `deleted_at` yoki holat.
- **Moliyaviy amal faqat RPC orqali**, RLS ochilmaydi.
- **Har bir migratsiya sarlavhasida** muammo va yechim tushuntiriladi.
- **Minimalistik, zich interfeys** — buxgalter kuniga yuzlab qator
  ko'radi.

Namuna sifatida qarang:

| Fayl | Nima ko'rsatadi |
|---|---|
| `supabase/migrations/20260822120010_rls.sql` | siyosatlar sikl bilan generatsiya |
| `supabase/migrations/20260825120000_security_hardening.sql` | invariantlar |
| `apps/maktab-panel/src/features/Classes.tsx` | ro'yxat + tahrirlash oynalari |
| `apps/maktab-panel/src/ui/index.tsx` | UI primitivlari |
| `scripts/seed-school.mjs` | uzun skript qanday tuzilishi |
