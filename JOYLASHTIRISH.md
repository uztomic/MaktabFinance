# Joylashtirish: GitHub Pages → maktab.uztomic.uz

`uztomic.uz` allaqachon GitHub Pages'da turadi (DNS'dagi
`185.199.108–111.153` — aynan GitHub Pages manzillari). Shuning uchun
panel ham shu yerga qo'yiladi: bitta hisob, bitta panel, qo'shimcha
xizmat kerak emas.

Butun jarayon avtomatlashtirilgan — `main` shoxiga har bir `git push`
saytni qayta quradi va chiqaradi ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)).

---

## 1. Bir marta bajariladigan sozlash

### 1.1. GitHub'da Pages'ni yoqish

Repozitoriy → **Settings → Pages**

| Maydon | Qiymat |
|---|---|
| Source | **GitHub Actions** |

> "Deploy from a branch" EMAS. Bizda build kerak (TypeScript → JS),
> shuning uchun Actions orqali chiqariladi.

### 1.2. DNS yozuvini qo'shish

Domen panelingizda (skrinshotdagi jadval) **Add Record**:

| Maydon | Qiymat |
|---|---|
| Name | `maktab` |
| Type | `CNAME` |
| TTL | `14400` |
| RDATA | `uztomic.github.io` |

Mavjud yozuvlarga **tegilmaydi**. `@` (A yozuvlari), `www`, `mail`,
`ftp`, `MX`, `TXT` — hammasi joyida qoladi. Pochta ham, asosiy sayt
ham buzilmaydi.

> `www` allaqachon `uztomic.github.io` ga ishora qiladi — yangi yozuv
> aynan shu naqshda, faqat nomi boshqa.

### 1.3. GitHub'da domenni tasdiqlash

Birinchi chiqarish tugagandan keyin: **Settings → Pages → Custom domain**

`maktab.uztomic.uz` yozilgan bo'lishi kerak — uni repozitoriydagi
[apps/maktab-panel/public/CNAME](apps/maktab-panel/public/CNAME) fayli
avtomatik qo'yadi. Bo'sh bo'lsa qo'lda yozing va **Save**.

DNS tarqalgandan keyin (5 daqiqadan bir necha soatgacha) quyidagi
katakcha faollashadi:

- [x] **Enforce HTTPS**

Sertifikat avtomatik olinadi (Let's Encrypt), qo'lda hech narsa
qilinmaydi.

### 1.4. Supabase'ga yangi manzilni aytish — MAJBURIY

Parolni tiklash xatidagi havola shu manzilga qaytadi. Ro'yxatda
bo'lmasa havola **ishlamaydi**.

Supabase → **Authentication → URL Configuration**:

| Maydon | Qiymat |
|---|---|
| Site URL | `https://maktab.uztomic.uz` |
| Redirect URLs | `https://maktab.uztomic.uz/**` va `http://localhost:5173/**` |

---

## 2. Nima o'z-o'zidan ishlaydi

| Vazifa | Qayerda hal qilingan |
|---|---|
| Build (TypeScript → JS) | `deploy.yml` |
| SPA yo'llari (`/oquvchilar` sahifasini yangilash) | `404.html` = `index.html` nusxasi |
| Maxfiy kalit tekshiruvi | build'dan oldin `check-secrets.mjs` |
| Tarjima kalitlari to'liqligi | build'dan oldin `i18n-check.mjs` |
| Custom domen | `public/CNAME` |
| HTTPS | GitHub avtomatik |

**404.html haqida.** GitHub Pages'da server yo'naltirishlari yo'q.
`maktab.uztomic.uz/oquvchilar` — haqiqiy fayl emas, shuning uchun
Pages `404.html` ni beradi. Biz uni `index.html` nusxasi qilamiz:
ilova yuklanadi va React Router yo'lni o'zi hal qiladi. Foydalanuvchi
farqni sezmaydi.

---

## 3. Xavfsizlik

To'liq tavsif — [SECURITY.md](SECURITY.md). Qisqacha:

### Repozitoriy ochiq — bu ataylab

Kod ko'rinadi, lekin himoya kodni yashirishga tayanmaydi. Butun
huquq bazadagi RLS da: so'rov qayerdan kelishidan qat'i nazar —
panel, `curl`, yoki to'g'ridan-to'g'ri API — bir xil cheklanadi.

| Xavf | Nima bo'ladi |
|---|---|
| Publishable kalitni o'g'irlash | **Hech narsa** — token'siz bitta qator ham ko'rinmaydi |
| Boshqa maktab ma'lumotini so'rash | **Bo'sh javob** |
| Brauzerdan to'lov yozish | **Rad etiladi** (`42501`) |
| Yozuvni jimgina o'chirish | **Imkonsiz** — DELETE huquqi hech qayerda yo'q |
| Direktor o'ziga huquq qo'shishi | **Imkonsiz** — huquqlar jadvali o'zgarmas |

O'nta invariant bazaning o'zida tekshiriladi va sinov zanjiriga
kiritilgan — kelajakdagi migratsiya himoyani jimgina buzib
qo'yolmaydi:

```bash
npm run audit:security    # bo'sh natija = toza
```

### Auth qattiqlashtirilgan

```bash
npm run harden:auth       # holatni ko'rsatadi
```

Parol 12 belgi + harf/raqam, xatdagi havola 15 daqiqa, ro'yxatdan
o'tish yopiq, ruxsat etilgan manzillar cheklangan.

Sessiya cheklovlari Supabase'ning bepul tarifida yo'q, shuning
uchun ilova darajasida qo'yilgan: **45 daqiqa harakat bo'lmasa
sessiya yopiladi** ([IdleGuard.tsx](apps/maktab-panel/src/auth/IdleGuard.tsx)).
Bu kanselyariyadagi ochiq qolgan kompyuterdan himoya qiladi.

### GitHub Pages'ning cheklovi

Pages HTTP sarlavhalarini sozlashga ruxsat bermaydi, ya'ni
`vercel.json` dagi `X-Frame-Options` bu yerda qo'llanmaydi.
O'rnini `index.html` dagi ramkadan chiqaruvchi skript bosadi.

### Kalitlarni almashtiring

Ishlab chiqish jarayonida service_role, access token va bot tokeni
yozishmada ko'ringan. Repo'da ular yo'q, lekin baribir yangilanishi
kerak:

- Supabase → Settings → API → `service_role` → **Reset**
- Supabase → Account → Access Tokens → eskisini **Revoke**
- Telegram `@BotFather` → `/revoke`

```bash
.env.local                                    # repo'ga tushmaydi
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... TELEGRAM_BOT_TOKEN=...
```

### Eng zaif nuqta — hisoblar

GitHub va Supabase hisoblariga **2FA yoqing**. Hisobni qo'lga
kiritgan odamni hech qanday RLS to'sib turolmaydi.

---

## 4. Har safar chiqarishdan oldin

```bash
npm run check:secrets                             # maxfiy kalit yo'q
npm run audit:security                            # xavfsizlik invariantlari
npm run build                                     # TypeScript va build
npm run test:db                                   # baza mantiqi + xavfsizlik
node scripts/smoke-test.mjs direktor@namuna.uz    # har bir so'rov
git push
```

Push'dan keyin: **Actions** bo'limida jarayonni kuzatish mumkin.
2–3 daqiqada yangi versiya saytda bo'ladi.

Xato chiqsa — **Actions** dagi jurnal aniq qaysi qadamda yiqilganini
ko'rsatadi. Sayt eski versiyada ishlashda davom etadi: yiqilgan build
chiqarilmaydi.

---

## 5. Baza migratsiyalari

Ular avtomatik EMAS — ataylab. Baza o'zgarishi qaytarilmaydi,
shuning uchun qo'lda yuboriladi:

```bash
node scripts/db.mjs status    # nima qo'llanmagan
node scripts/db.mjs push      # qo'llash
```
