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

### E7. To'lovlarni tasdiqlash — kundalik ish

Super adminning eng ko'p ochadigan ekrani.

Ro'yxat: **kutayotgan cheklar** — maktab, summa, sana, chek rasmi.
Bir bosishda rasm ochiladi, yonida ikkita tugma: **Tasdiqlash** va
**Rad etish** (sabab bilan).

Tasdiqlangan zahoti maktab ochiladi — qo'lda "bloklashni yechish"
tugmasi **yo'q** va bo'lmasligi kerak. Unutilib qolish ehtimolini
kod darajasida yo'q qilamiz.

Yon ustunda: bu oy tasdiqlangan summa, kutayotganlar soni, muddati
o'tgan maktablar.

### E8. Muloqot

Mavzular ro'yxati: maktab, mavzu, oxirgi xabar, javob kutayotganlar
**tepada**. Ichida oddiy yozishma, fayl biriktirish bilan.

**Bloklangan maktab ham yoza oladi** — mijoz bog'lana olmasa to'lay
ham olmaydi.

### E9. Platforma ko'rsatkichlari

- maktablar: jami, faol, sinovda, cheklangan, bloklangan;
- **oylik daromad** (MRR) va uning dinamikasi;
- **yig'ilmagan** summa va uning yoshi;
- yangi maktablar (oylar bo'yicha);
- chiqib ketganlar;
- tizim yuki: jami o'quvchi, jami to'lov, baza hajmi;
- yuborilmagan xabarlar, xatolik bergan cron ishlari.

## 2.4. Tariflash va to'lov — mijoz shartlari

### Narxlar

| Nima | Summa |
|---|---|
| **Ulanish to'lovi** (bir marta) | **600 000 so'm** |
| **Asosiy oylik** | **500 000 so'm** |
| Har **qo'shimcha filial** | **+450 000 so'm/oy** |
| O'quvchi chegarasidan oshgani | har **50 o'quvchi** uchun **+50 000 so'm/oy** |

**Bitta filialga 250 o'quvchi kiradi.** Ya'ni o'quvchi chegarasi =
`filiallar soni × 250`.

### Hisoblash formulasi

```
oylik = 500 000
      + (filiallar − 1) × 450 000
      + ceil(max(0, o'quvchilar − filiallar × 250) / 50) × 50 000
```

**Namunalar:**

| Maktab | Filial | O'quvchi | Hisob | Oylik |
|---|---:|---:|---|---:|
| Kichik | 1 | 180 | 500 000 | **500 000** |
| Chegarada | 1 | 250 | 500 000 | **500 000** |
| Oshgan | 1 | 340 | 500 000 + ⌈90/50⌉×50 000 | **600 000** |
| Ikki bino | 2 | 400 | 500 000 + 450 000 | **950 000** |
| Ikki bino, ko'p bola | 2 | 610 | 500 000 + 450 000 + ⌈110/50⌉×50 000 | **1 100 000** |

> **Yaxlitlash yuqoriga.** 51 ta ortiqcha o'quvchi ham, 100 tasi ham
> ikkita "50 lik" hisoblanadi. Buni mijozga oldindan aytish kerak,
> aks holda bahs chiqadi.

### O'quvchi soni qaysi paytda o'lchanadi

**Oy boshida, faqat `active` o'quvchilar.** Akademik ta'tildagilar
va chiqib ketganlar sanalmaydi.

Sabab: oy o'rtasida bola qo'shilib, keyin chiqib ketsa, summa ikki
marta o'zgarardi va mijoz nima uchun to'layotganini tushunmasdi.
Bir marta o'lchanadi va oy davomida o'zgarmaydi.

Har oyning 1-sanasida cron o'lchaydi va `subscription_invoices` ga
yozadi — shunda "o'sha oyda 340 ta bola bor edi" degani hujjatda
qoladi va keyinchalik bahslashib bo'lmaydi.

### To'lov muddati va bloklash

```
1-kun          hisob-kitob yaratiladi, to'lov muddati qo'yiladi
+15 kun        eslatma (birinchi)
+30 kun        eslatma (ikkinchi), holat: grace
+45 kun        AVTOMATIK BLOKLASH — holat: restricted
```

**45 kun = bir yarim oy.** Shundan keyin maktab tizimga **kira
olmaydi**.

> **MUHIM — bloklash MA'LUMOTNI O'CHIRMAYDI.**
>
> `restricted` holatida `app.school_is_writable()` `false`
> qaytaradi — bu allaqachon qurilgan. To'lovdan keyin holat
> `active` ga qaytariladi va hamma narsa **joyida** bo'ladi:
> o'quvchilar, hisoblanmalar, to'lovlar, tarix.
>
> Ma'lumotni o'chirish faqat mijoz **yozma** so'rovi bilan.

**Kirish darajasi.** Hozirgi `school_is_writable()` faqat yozishni
to'sadi, o'qish ochiq qoladi. Mijoz "umuman kira olmasin" dedi —
demak kirishning o'zini to'sish kerak. Buni **AuthProvider**
darajasida qilish tavsiya etiladi: maktab `restricted` bo'lsa
panel o'rniga **to'lov ekrani** ko'rsatiladi.

Nega bazada emas: RLS ni yopib qo'yish direktorni ham, to'lovni
yuborish imkoniyatidan ham mahrum qiladi. To'lov ekrani ochiq
qolishi SHART — aks holda mijoz to'lay olmaydi va tugab qoladi.

Ko'rinadigan yagona narsa: qarzdorlik summasi, to'lov rekvizitlari,
chek yuborish tugmasi va super admin bilan muloqot.

### To'lov oqimi — chek orqali

1. Direktor **to'lov ekranida** hisob-kitobni ko'radi;
2. Bankdan to'laydi va **chek rasmini yuklaydi** (Supabase Storage);
3. Chek `subscription_payments` ga `pending` holatida tushadi;
4. Super adminga bildirishnoma boradi;
5. Super admin chekni ochib ko'radi va **tasdiqlaydi** yoki **rad
   etadi** (sabab bilan);
6. Tasdiqlanganda: `last_paid_at`, `next_payment_date` yangilanadi,
   holat `active` ga qaytadi, maktab darhol ochiladi;
7. Rad etilganda: direktor sababni ko'radi va qayta yuboradi.

**Chek rasmi yopiq bucket'da** — `subscription-receipts`. Faqat
o'sha maktab va super admin ko'radi (mavjud `receipts` bucket'i
bilan bir xil naqsh).

### Muloqot — super admin bilan yozishma

Maktab ↔ super admin o'rtasida oddiy xabar almashinuvi:

- **Mavzu** (thread) — bitta savol yoki muammo;
- direktor yozadi, super admin javob beradi;
- fayl biriktirish (chek, skrinshot);
- **o'qilmagan** belgisi ikkala tomonda ham;
- maktab bloklangan bo'lsa ham **ishlaydi** — aks holda mijoz
  bog'lana olmaydi.

Bu Telegram bot emas, panel ichidagi yozishma. Sabab: to'lov bahsi
yozma va **izlanadigan** bo'lishi kerak.

---

## 2.5. Maktab panelida nima o'zgaradi

Super admin alohida ilova, lekin **mavjud panelga ham** ikkita
qo'shimcha kerak — to'lovni maktab tomonidan yuborish uchun.

### P1. To'lov ekrani

Yangi sahifa `/obuna` — faqat **direktor** ko'radi:

- joriy tarif va uning tafsiloti (`school_price` natijasi);
- hisob-kitoblar tarixi va ularning holati;
- **chek yuklash** — rasm tanlash va yuborish;
- yuborilgan cheklar holati (kutilmoqda / tasdiqlangan / rad etilgan
  sabab bilan).

### P2. Bloklangan holat ekrani

Maktab `restricted` bo'lsa `AppShell` o'rniga shu ekran
ko'rsatiladi:

- qarzdorlik summasi va necha kundan beri;
- to'lov rekvizitlari;
- chek yuklash tugmasi;
- super admin bilan muloqot.

**Boshqa hech narsa ochilmaydi.** Menyu, hisobotlar, o'quvchilar —
hammasi yopiq. Lekin **ma'lumot joyida turadi** va to'lovdan keyin
darhol qaytadi.

> Buni `AuthProvider` da qilish kerak, RLS da emas. RLS ni yopib
> qo'ysangiz direktor to'lov ekranini ham ko'ra olmaydi va tizim
> boshi berk ko'chaga kiradi.

### P3. Bildirishnoma

Muddat yaqinlashganda direktorga panel ichida ogohlantirish:
15 kun qolganda — kulrang, 5 kun qolganda — sariq, muddat
o'tganda — qizil va **har sahifada**.

---

## 2.6. Bazada nima qo'shish kerak

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

### M5. Tariflash dvigateli

**Raqamlar KODDA emas, BAZADA.** Bu tizimda allaqachon shunday
naqsh bor: oylik formulasi `payroll_settings` da yashaydi
(TZ 4.11.10). Narx o'zgarganda migratsiya yozish kerak emas.

```sql
create table public.platform_settings (
  key        text primary key,
  value      jsonb not null,
  note       text,
  is_public  boolean not null default false,   -- true → maktab ham ko'radi
  updated_at timestamptz not null default now()
);

-- Boshlang'ich qiymatlar
--   setup_fee            600000
--   monthly_base         500000
--   branch_price         450000
--   students_per_branch  250
--   student_block_size   50
--   student_block_price  50000
--   grace_days           30
--   block_days           45
--   first_reminder_days  15
--   requisites           (to'lov rekvizitlari, matn)
```

```sql
public.school_price(p_school_id uuid) returns jsonb
```

Qaytaradi: `branches_count`, `students_count`, `students_included`,
`students_extra_steps`, `base_amount`, `branches_amount`,
`students_amount`, `monthly_total`, `setup_fee`. **Tafsilot bilan** —
mijoz "nega shuncha" deb so'raganda javob tayyor bo'lsin.

Hisobning o'zi `app.school_monthly_fee()` da; `school_price()` unga
huquq tekshiruvi qo'shadi. Kunlik tariflash `monthly_amount` ni
shu manbadan yangilab turadi.

```sql
public.issue_subscription_invoice(p_school_id uuid, p_period date)
  returns jsonb
```

Kunlik `run_billing_cycle()` chaqiradi: joriy kalendar oyga
hisob-faktura yo'q bo'lsa chiqaradi — ya'ni amalda oyning
1-sanasida. **Idempotent** — `subscription_invoices_period_idx`
unikal indeksi dublikatni yaratmaydi.

### M6. To'lov va chek

```sql
create table public.subscription_invoices (
  id, school_id, period, amount, breakdown jsonb,
  due_date, status, created_at
);

create table public.subscription_payments (
  id, school_id, invoice_id, amount, paid_on,
  file_path,                       -- chek rasmi
  status,                          -- pending / confirmed / rejected
  submitted_by, submitted_at,
  reviewed_by, reviewed_at, reject_reason
);
```

```sql
public.submit_subscription_payment(p_amount, p_paid_on, p_months,
                                   p_method, p_file_path, p_note)
public.review_subscription_payment(p_payment_id, p_approve, p_reason)
```

Birinchisini **direktor** chaqiradi, ikkinchisini **faqat super
admin**. Tasdiqlash va rad etish bitta funksiyada: ikkalasi ham
ayni bir yozuvni yopadi va ularni ajratish ikki joyda bir xil
tekshiruvni takrorlashga olib kelardi. Hammasi `platform_log` ga.

### M7. Avtomatik bloklash

```sql
public.run_billing_cycle() returns jsonb
```

Kuniga bir marta cron:

- muddati **30 kundan** oshgan → `grace`;
- muddati **45 kundan** oshgan → `restricted`;
- to'lovi tasdiqlangan → `active`.

Har bir o'zgarish `platform_log` ga **sababi bilan** yoziladi.

> **Bloklash avtomatik, ochish ham avtomatik.** Super admin chekni
> tasdiqlashi bilan maktab ochiladi — qo'lda "ochish" tugmasini
> bosish kerak emas. Unutilib qolish ehtimoli yo'q.

### M8. Muloqot

```sql
create table public.support_threads (
  id, school_id, subject, status,        -- open / answered / closed
  created_by, created_at, last_message_at
);

create table public.support_messages (
  id, thread_id, school_id,
  author_user_id,        -- maktab xodimi
  author_admin_id,       -- yoki super admin
  body, file_path, created_at, read_at
);
```

RLS: maktab o'z mavzularini ko'radi, super admin hammasini.
**Bloklangan maktab ham yoza oladi** — bu qoidadan istisno.

### M9. Super admin hisobini yaratish

`scripts/new-platform-admin.mjs`:

Admin API orqali `auth.users` → `platform_admins` ga yozuv →
login/parol chiqarish. Parol `scripts/password.mjs` dan.

## 2.7. Qat'iy talablar

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
| 11 | **Bloklash ma'lumotni o'chirmaydi** — faqat kirishni to'sadi |
| 12 | **Bloklangan maktab to'lov ekrani va muloqotni ko'radi** |
| 13 | Narxlar **bazada**, kodda emas (`platform_settings`) |
| 14 | Chek tasdiqlangach maktab **avtomatik** ochiladi |
| 15 | Har bir hisob-kitobda **tafsilot** saqlanadi (nega shuncha) |

## 2.8. Tekshirish

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
| 1 filial, 250 o'quvchi | 500 000 |
| 1 filial, 251 o'quvchi | 550 000 |
| 1 filial, 340 o'quvchi | 600 000 |
| 2 filial, 610 o'quvchi | 1 100 000 |
| Muddatdan 46 kun o'tgan maktab | `restricted` |
| Bloklangan maktabda o'quvchi qo'shish | rad etiladi |
| Bloklangan maktabda chek yuborish | **ishlaydi** |
| Bloklangan maktabda xabar yozish | **ishlaydi** |
| Chek tasdiqlangandan keyin holat | `active` |
| To'lovdan keyin ma'lumot | **joyida** |
| Direktor `review_subscription_payment` chaqirsa | `42501` |

## 2.9. Tavsiya etilgan tartib

1. **M1–M3 migratsiyalari** — RPC lar va sinovlar. Baza tayyor
   bo'lmaguncha interfeys yozmang.
2. **`scripts/new-platform-admin.mjs`** — birinchi hisobsiz
   sinab bo'lmaydi.
3. **`apps/super-admin/` skeleti** — kirish, qobiq, marshrutlar.
4. **E1 va E2** — maktablar ro'yxati va kartochka.
5. **E5** — impersonation. Eng nozik qism, alohida sinang.
6. **E3, E4** — ulash va obuna.
7. **M5–M7** — tariflash, to'lov, avtomatik bloklash. Sinovlarni
   AVVAL yozing: pul bilan bog'liq mantiqni keyin tekshirish qimmat.
8. **P1, P2** — maktab panelidagi to'lov ekranlari.
9. **E7** — cheklarni tasdiqlash.
10. **M8 va E8** — muloqot.
11. **E6, E9** — jurnal va ko'rsatkichlar.

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
