<div align="center">
  <img src="apps/maktab-panel/public/logo-full.svg" alt="MaktabFinance — Uztomic Solutions" width="420">
</div>

# MaktabFinance

Xususiy maktablar uchun moliya va boshqaruv tizimi.
Texnik topshiriq: `TZ-maktab-moliya-tizimi.md` (v2.0).

---

## Nima qurilgan

| Qatlam | Holat |
|---|---|
| **Ma'lumotlar bazasi** — 52 jadval, RLS, audit, davr qulfi | ✅ tayyor va sinovdan o'tgan |
| **Moliyaviy dvigatel** — hisoblanma, to'lov, kassa, vypiska | ✅ server tomonda, sinovdan o'tgan |
| **Oylik dvigateli** — 4 turdagi formula, parametrlari bazada | ✅ sinovdan o'tgan |
| **Oylik formulasi muharriri** — buxgalter o'zi sozlaydi | ✅ tayyor |
| **Hisobotlar** — 7 ta ekran, Excel eksporti bilan | ✅ tayyor |
| **Hisoblanma sikli** — shakllantirish → yakunlash → tasdiqlash | ✅ tayyor |
| **To'lovlar** — kassa, chek tasdiqlash, bank vypiskasi | ✅ tayyor |
| **Qarzdorlik, xarajatlar, murojaatlar** | ✅ tayyor |
| **Telegram bot** — `@farzandingizmaktabibot` | ✅ ishlayapti |
| **Xabar navbati** — cron bilan | ✅ ishlayapti |
| **Maktab paneli** — veb + o'qituvchi PWA | ✅ barcha modullar |
| **Hosting** — Vercel/Netlify uchun tayyor | ⏳ hisobingiz kerak |
| **Oyni yopish** — davr qulfi | ✅ tayyor |
| **Kalendar** — bayram va ta'til kunlari | ✅ tayyor |
| **O'qituvchi kartochkasi** — ustama va avans | ✅ tayyor |
| **Xabarlar jurnali** — yetkazilmaganlari bilan | ✅ tayyor |
| Super admin paneli | ⏳ keyingi bosqich (baza tayyor) |

---

## Hosting

**Supabase da sayt joylashtirib bo'lmaydi.** Bu sinab ko'rilgan va
tasdiqlangan: Supabase o'z domenida HTML sahifa ko'rsatishga ataylab
yo'l bermaydi. Storage ham, Edge Function ham javobga majburan
quyidagini qo'yadi:

```
Content-Type: text/plain
Content-Security-Policy: default-src 'none'; sandbox
```

Natijada brauzer HTML ni sahifa emas, **oddiy matn** sifatida
ko'rsatadi va hech qanday skript ishlamaydi. Bu fishing va XSS ni
oldini olish uchun qo'yilgan himoya — sarlavha bilan chetlab o'tib
bo'lmaydi.

Shuning uchun panel **Vercel** yoki **Netlify** ga joylashtiriladi
(TZ 5.2 da aynan shular ko'rsatilgan). Ikkalasi ham bepul. Baza, bot,
fayllar va cron Supabase'da qoladi.

### Vercel (tavsiya)

1. Loyihani GitHub'ga qo'ying
2. <https://vercel.com/new> da repozitoriyni ulang
3. Hech narsa sozlamang — `vercel.json` hammasini o'zi hal qiladi

Natija: `https://<nom>.vercel.app`. O'z domeningizni (masalan
`panel.maktab.uz`) ulash ham bepul.

### Netlify

<https://app.netlify.com/start> da repozitoriyni ulang —
`netlify.toml` tayyor.

### Nega qo'shimcha sozlash kerak emas

`apps/maktab-panel/.env.production` da Supabase manzili va
**publishable** kalit turadi. Ular brauzerga chiqadi va bu normal:
butun himoya bazadagi RLS da. `service_role` kaliti u yerda yo'q.

### Mahalliy tarmoqda (vaqtinchalik)

Maktab ichida bir nechta kompyuterdan ishlatish uchun:

```bash
npm run build
npm run preview        # tarmoqdagi boshqa kompyuterlar ham ko'radi
```

---

## Tez ishga tushirish

```bash
npm install          # bir marta
npm run dev          # http://localhost:5173
```

---

## Loyiha tuzilishi

```
├─ supabase/
│  ├─ migrations/        26 ta migratsiya — bazaning yagona manbasi
│  └─ functions/
│     ├─ _shared/        umumiy modullar (bot xavfsizligi shu yerda)
│     ├─ telegram-webhook/
│     ├─ queue-sender/
│     └─ school-user-ops/
├─ apps/
│  └─ maktab-panel/      Vite + React + TypeScript + Tailwind, PWA
└─ scripts/              baza, platforma va joylashtirish asboblari
```

**Kod bazalari soni: 2** (TZ 5.1). Super admin paneli alohida ilova
sifatida `apps/super-admin/` ga qo'shiladi — maktab bundle'iga super
admin kodi hech qachon kirmaydi.

---

## Buyruqlar

```bash
npm run dev            # ishlab chiqish serveri
npm run build          # ishlab chiqarish uchun yig'ish
npm run db:types       # TypeScript turlarini bazadan generatsiya qilish
npm run test:db        # barcha baza sinovlari
npm run icons          # logotip SVG dan PWA ikonkalari
npm run i18n:cyrl      # uz.json dan uz-cyrl.json
```

### Baza

```bash
node scripts/db.mjs status          # qaysi migratsiya qo'llangan
node scripts/db.mjs push            # kutayotganlarini qo'llash
node scripts/db.mjs sql "select 1"  # bitta so'rov
node scripts/db.mjs file x.sql      # fayl (tarixga yozilmaydi)
```

> `supabase db push` o'rniga shu skript ishlatiladi: u DB parolini
> talab qilmaydi, faqat access token bilan ishlaydi. Migratsiya tarixi
> `supabase_migrations.schema_migrations` da — ya'ni Supabase CLI
> ishlatadigan aynan o'sha jadvalda.

### Yangi maktab ulash (TZ 4.13.2)

```bash
npm run new-school -- "Maktab nomi" direktor@pochta.uz
npm run new-school -- "Maktab nomi" 998901234567 "Chilonzor filiali"
```

Maktab, standart filial, obuna, shablon sozlamalar va direktor hisobi
bir buyruq bilan yaratiladi. **Dasturchi aralashuvi kerak emas.**

### Platforma sozlamalari (bir marta)

```bash
node scripts/setup-platform.mjs   # Vault kalitlari + auth hook
node scripts/harden-auth.mjs      # parol siyosati, sessiya, manzillar
```

### Namuna ma'lumot — ikki o'quv yillik maktab

```bash
node scripts/seed-school.mjs              # nima qilishini aytadi
node scripts/seed-school.mjs --confirm    # quradi
```

**Diqqat: bu skript bazani butunlay tozalaydi.** `--confirm` bo'lmasa
hech narsaga tegmaydi.

Quriladigan ma'lumot — 152 o'quvchi (bog'cha 3 guruh + 1–9 sinf),
22 o'qituvchi, 8 xodim hisobi va **24 oylik to'liq tarix**:
2024-09 dan bugungacha har oy uchun yo'qlik, hisoblanma, yakunlash,
tasdiqlash, to'lov, xarajat va oylik hisob-kitobi.

Bu shunchaki "bazani to'ldirish" emas. Skript tizimning O'Z
funksiyalarini ishlatadi — `generate_invoices`, `finalize_invoices`,
`register_cash_payment`, `calc_payroll_batch`. Ya'ni 24 oylik sikl
haqiqatan ishlashini isbotlaydi. Aynan shu yo'l bilan RLS ning
tezlik muammosi va sinf hisobotidagi bo'sh qatorlar topilgan.

---

## Sinovlar (TZ 8-bo'limi)

```bash
npm run test:db                              # baza mantiqi + xavfsizlik
npm run audit:security                       # bo'sh natija = toza
npm run check:secrets                        # repo'da maxfiy kalit yo'q
node scripts/smoke-test.mjs <email> [parol]  # panelning HAR BIR so'rovi
```

`smoke-test` panel bajaradigan 86 ta so'rovni haqiqiy foydalanuvchi
tokeni bilan tekshiradi. Parol berilmasa u `service_role` kaliti bilan
bir martalik havola yaratadi — parolni saqlash yoki so'rash kerak emas. `npm run build` faqat TypeScript xatolarini
topadi; noto'g'ri ustun nomi yoki RLS to'sig'i esa faqat ishlash
paytida chiqadi — shu skript ularni oldindan topadi.

Skriptlar xato bo'lsa `raise exception` bilan to'xtaydi — ya'ni
"xatosiz tugadi" degani "hamma tekshiruv o'tdi" degani.

| Sinov | TZ bandi |
|---|---|
| Hisoblanma qatorlari va jami | 4.6.2 |
| Chegirma to'g'ri qo'llanishi | 4.3.3 |
| Takroriy shakllantirishda dublikat yo'qligi | 4.6.8 |
| Yo'qlik to'liq bo'lmasa qayta hisoblash to'xtashi | 4.6.1.2 |
| Kunlik xizmatni yo'qlik asosida qayta hisoblash | 8.4 |
| Kassa kvitansiyasi ketma-ketligi | 4.7.1.5 |
| Tasdiqlanmagan chek qarzni yopmasligi | 4.7.3 |
| Oylik: ustama + ushlanma + avans + yaxlitlash | 4.11 |
| Oylik tasdiqlanganda avtomatik xarajat | 4.11.9 |
| Avtomatik xarajatni qo'lda o'zgartirib bo'lmasligi | 4.10.2 |
| Yopilgan davrga yozib bo'lmasligi | 5.4.9 |
| **Ma'lumotlar ajratilishi** | **8.9** |
| Mijoz moliyaviy jadvalga yoza olmasligi | 5.4.6 |
| Audit jurnalini o'zgartirib bo'lmasligi | 5.4.13 |

---

## Oylik formulasi — buxgalter o'zi sozlaydi

TZ 4.11.10: *"Formula parametrlari kodga yozilmaydi."*

**Sozlamalar → Oylik formulasi** bo'limida quyidagilarning HAMMASI
oddiy maydonlar orqali o'zgartiriladi — JSON tahrirlash shart emas:

| Nima | Variantlar |
|---|---|
| Asosiy haq turi | qat'iy oylik · stavka · soatbay · aralash |
| Stavka va soat narxi | bir stavka necha soat, soat narxi |
| Toifa koeffitsiyentlari | oliy / birinchi / ... → koeffitsiyent |
| O'rniga kirilgan dars | necha foiz to'lanadi |
| O'tkazilmagan dars | sabab bo'yicha foiz (bayram, karantin, o'qituvchi kelmadi, standart) |
| Ustamalar | kod, nom, foiz yoki qat'iy summa — istalgancha qator |
| Ushlanmalar | kod, nom, foiz yoki qat'iy summa — istalgancha qator |
| Yaxlitlash | qadam (1 … 10 000) va yo'nalish |
| Hisob davri | qaysi sanadan qaysi sanagacha |

Joriy turda ishlatilmaydigan maydonlar xiralashtiriladi, lekin
yashirilmaydi — buxgalter formulaning to'liq tarkibini ko'rib turadi.

Har bir hisob `settings_snapshot` bilan saqlanadi: nizoli holatda
"o'sha paytda qanday hisoblangani" isbotlanadi.

---

## To'lov 9 oymi yoki 12 oy (TZ 12.2.1)

Ikkalasi ham bor va **har bir shartnoma uchun alohida** tanlanadi:

- **12 oy** — yozgi ta'til oylarida ham hisoblanma shakllanadi
- **9 oy** — faqat o'quv yili; yozda hisoblanma yo'q
- **Boshqa** — 1 dan 12 gacha istalgan son

O'quv yili boshlanadigan oy **Sozlamalar → Moliya** da (standart: sentyabr).

---

## Bank vypiskasi

Panel CSV faylni o'qiydi va to'lovlarni **to'lov kodi** bo'yicha
o'quvchilarga avtomatik biriktiradi (TZ 4.7.2).

Namuna fayl: `namunalar/bank-vypiskasi-namuna.csv`

Ustun nomlari moslashuvchan — parser ularni mazmuni bo'yicha topadi
(`sana` / `дата` / `date`, `summa` / `сумма` / `amount` va h.k.).
Sana va summa formatlari ham turlicha bo'lishi mumkin:
`22.08.2026` · `2026-08-22` · `1 450 000,00` · `1,450,000.00`.

To'lov kodi izohdan `[A-Z]{2,4}-[0-9]{3,8}` naqshi bo'yicha ajratiladi
(masalan `NM-0001`). Kod topilmagan qatorlar **qo'lda biriktirish**
ro'yxatiga tushadi (TZ 4.7.2.3).

Namuna faylda 5 ta qatordan 4 tasi avtomatik biriktirildi — 80%,
TZ 4.7.2.6 talabining aynan chegarasi. Amalda ota-onalar kodni
muntazam yozsa bu ko'rsatkich yuqoriroq bo'ladi (bot har bir xabarda
kodni eslatib turadi).

> Bankingiz boshqa formatda bersa — bitta haqiqiy fayl yuboring,
> parser unga sozlanadi.

---

## Arxitektura qarorlari

### Nega moliyaviy jadvallarga mijozdan yozib bo'lmaydi

TZ 5.4.6: *"Moliyaviy amallar faqat server tomonda bajariladi."*

`invoices`, `payments`, `payroll_runs` va shunga o'xshash jadvallarda
mijoz uchun `INSERT`/`UPDATE` **siyosati umuman yaratilmagan**. Yagona
yo'l — `SECURITY DEFINER` funksiyalar (`generate_invoices`,
`register_cash_payment`, `calc_payroll`...). Har biri ichida huquq,
filial va davr qulfi tekshiruvi bor.

```bash
curl -X POST "$URL/rest/v1/payments" -H "apikey: $PUBLISHABLE_KEY" \
     -H "Authorization: Bearer $USER_TOKEN" -d '{...}'
# → 42501 permission denied for table payments
```

### Nega jami summa saqlanmaydi

TZ 4.6.2 va 4.12.2. `invoices` jadvalida `total` ustuni **yo'q** —
jami har doim `invoice_lines` dan hisoblanadi (`v_invoice_totals`).
Shu tufayli jami va qatorlar bir-biridan uzilib qolishi texnik
jihatdan imkonsiz.

### Nega ko'rinishlarda `security_invoker`

PostgreSQL 15+ da ko'rinish standart holatda **egasi huquqi** bilan
ishlaydi va RLS ni chetlab o'tadi. Barcha ko'rinish
`with (security_invoker = true)` bilan yaratilgan, aks holda bir
maktab boshqasining balansini ko'rardi. `test-isolation.sql` buni
alohida tekshiradi.

### Nega bot xavfsizligi kodda

TZ 5.4.14: Edge Function `service_role` bilan ishlaydi va **RLS uni
to'xtatmaydi**. Shuning uchun ota-onaning doirasi
`supabase/functions/_shared/parent-scope.ts` da qo'lda tekshiriladi.
Bot hech qachon `students` jadvaliga to'g'ridan-to'g'ri so'rov
yubormaydi — har bir stsenariy `resolveParentScope()` dan boshlanadi.

---

## Kalitlar xavfsizligi

| Kalit | Qayerda |
|---|---|
| Publishable (ochiq) | `.env.local`, brauzerga chiqadi — **normal** |
| `service_role` | Faqat Edge Function muhitida va Vault da |
| Telegram bot tokeni | Faqat Edge Function maxfiy kaliti |
| Webhook secret | Faqat Edge Function maxfiy kaliti |
| Access token | `.env.local`, faqat CLI uchun |

```bash
npx supabase secrets set --project-ref <ref> KEY=value
```

`.env.local` va `.webhook-secret` `.gitignore` da.

> **Tavsiya:** loyiha ishga tushgach `service_role` kaliti va access
> tokenni Supabase panelidan yangilang (rotate) — ular chat tarixida
> qolgan.

---

## Kelishilishi kerak

1. **Oylik formulasining haqiqiy qiymatlari** (TZ 7.1). Dvigatel va
   muharrir tayyor; buxgalter raqamlarni Sozlamalar bo'limidan
   kiritadi. Hozir namuna qiymatlar turibdi.

2. **Bank vypiskasi namunasi** (TZ 7.4). `import_bank_rows` to'lov
   kodini `[A-Z]{2,4}-[0-9]{3,8}` naqshi bo'yicha ajratadi. Real
   fayl formati kelganda parser unga sozlanadi.

3. **Buzilgan parollar tekshiruvi** (HaveIBeenPwned) Supabase da
   faqat Pro tarifida. Minimal parol uzunligi 8 ga qo'yilgan.

---

## Keyingi bosqich

- Super admin paneli (`apps/super-admin/`)
- Impersonation Edge Function (baza va JWT hook tayyor)

---

<div align="center">
  <sub>Uztomic Solutions</sub>
</div>
