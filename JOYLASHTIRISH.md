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

## 3. Xavfsizlik: nimani bilish kerak

### 3.1. Repozitoriy hozir OCHIQ

`github.com/uztomic/MaktabFinance` hozir **public** — kodni istalgan
odam o'qiy oladi.

Bu tizimni **buzilishga olib kelmaydi**: himoya kodni yashirishda
emas, bazadagi RLS da. Lekin siz repozitoriy yopiq bo'lishini
so'ragan edingiz, shuning uchun tanlov aniq bo'lsin:

| Variant | Kod ko'rinadimi | Narxi |
|---|---|---|
| **Hozirgi** — public repo + GitHub Pages | Ha | Bepul |
| Private repo + GitHub Pages | Yo'q | GitHub Pro (~$4/oy) |
| Private repo + Vercel | Yo'q | Bepul |
| Private manba + alohida public `dist` repo | Yo'q | Bepul, ikkita repo |

Vercel varianti uchun [vercel.json](vercel.json) tayyor turibdi —
repozitoriyni ulash kifoya.

### 3.2. Saytni "buzib kirish" mumkin emas

Sayt — statik fayllar to'plami. Serveri, bazasi, admin paneli yo'q.
Butun huquq Supabase'da: JWT + RLS.

| Xavf | Nima bo'ladi |
|---|---|
| Publishable kalitni o'g'irlash | **Hech narsa** — token'siz bitta qator ham ko'rinmaydi |
| Boshqa maktab ma'lumotini so'rash | **Bo'sh javob** — `test-isolation.sql` shuni tekshiradi |
| Brauzerdan to'lov yozish | **Rad etiladi** (`42501`) — moliyaviy jadvallarga INSERT siyosati yo'q |
| Yozuvni jimgina o'chirish | **Imkonsiz** — DELETE siyosati yo'q, hamma o'zgarish audit jurnalida |

### 3.3. GitHub Pages'ning cheklovi

Pages HTTP sarlavhalarini sozlashga ruxsat bermaydi. Ya'ni
`vercel.json` dagi `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy` bu yerda **qo'llanmaydi**.

O'rnini qisman bosadigan narsa `index.html` ga qo'shilgan:

- `<meta name="referrer">` — sarlavhaning to'liq o'rnini bosadi;
- ramkadan chiqaruvchi kichik skript — `X-Frame-Options` o'rniga.

To'liq sarlavha nazorati kerak bo'lsa — Vercel yoki Cloudflare.

### 3.4. Haqiqiy xavflar texnik emas

1. **Zaif parollar.** Direktorning paroli "12345678" bo'lsa RLS ham
   yordam bermaydi.
2. **service_role kaliti.** U RLS ni butunlay chetlab o'tadi. Faqat
   Edge Function sirlarida turishi kerak.
3. **GitHub va Supabase hisoblari.** Ikkalasiga ham **2FA yoqing** —
   bu eng zaif nuqta.

### 3.5. Kalitlarni almashtiring

Ishlab chiqish jarayonida service_role, access token va bot tokeni
yozishmada ko'ringan. Repo'da ular yo'q, lekin baribir yangilanishi
kerak:

- Supabase → Settings → API → `service_role` → **Reset**
- Supabase → Account → Access Tokens → eskisini **Revoke**
- Telegram `@BotFather` → `/revoke`

Yangi qiymatlar faqat ikki joyga yoziladi:

```bash
.env.local                                    # repo'ga tushmaydi
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... TELEGRAM_BOT_TOKEN=...
```

### 3.6. Repo'da nima bor va nima yo'q

| Fayl | Repo'da | Nega |
|---|---|---|
| `.env.local` | **Yo'q** | service_role kaliti — to'liq huquq beradi |
| `.webhook-secret` | **Yo'q** | bot nomidan so'rov yuborish mumkin |
| `apps/maktab-panel/.env.production` | **Ha** | faqat publishable kalit — u brauzerga baribir chiqadi |

Tekshirish:

```bash
npm run check:secrets
```

Skript `git` ning o'zidan "nimani qo'shasan" deb so'raydi va o'sha
fayllarni tekshiradi. Har bir build'da CI ham shuni ishlatadi.

---

## 4. Har safar chiqarishdan oldin

```bash
npm run check:secrets                             # maxfiy kalit yo'q
npm run build                                     # TypeScript va build
npm run test:db                                   # baza mantiqi
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
