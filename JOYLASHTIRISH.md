# Joylashtirish: GitHub → Vercel → maktab.uztomic.uz

Bu hujjat uchta savolga javob beradi:

1. Kodni GitHub'ga qo'yish xavfsizmi?
2. Saytni "buzib kirish" mumkinmi?
3. `uztomic.uz` band bo'lsa, subdomen qanday ulanadi?

---

## 1. GitHub — repozitoriy YOPIQ (private) bo'lsin

Kod sir emas: himoya kodni yashirishda emas, bazadagi RLS da. Lekin
bu tijorat mahsuloti, shuning uchun standart holat — **private**.

```bash
# Yuborishdan OLDIN — majburiy odat
npm run check:secrets
```

Skript `git` ning o'zidan "nimani qo'shasan" deb so'raydi va aynan
o'sha fayllarni tekshiradi: Supabase service_role kaliti, access
token, Telegram bot tokeni. `.gitignore` bor deb ishonib qolish
yetarli emas — bitta `git add -f` yoki nusxa ko'chirilgan fayl
yetarli.

Keyin:

```bash
git init                       # bir marta
git add .
git commit -m "MaktabFinance"
git branch -M main
git remote add origin https://github.com/uztomic/MaktabFinance.git
git push -u origin main
```

GitHub'da repozitoriy yaratayotganda **Private** ni tanlang.

### Repo'ga TUSHMAYDIGAN fayllar

`.gitignore` shularni to'sadi:

| Fayl | Nima bor | Nega |
|---|---|---|
| `.env.local` | service_role kaliti, access token | to'liq huquq beradi |
| `.webhook-secret` | Telegram webhook siri | bot nomidan so'rov yuborish mumkin |
| `node_modules/`, `dist/` | — | keraksiz |

### Repo'ga ATAYLAB tushadigan fayl

`apps/maktab-panel/.env.production` da **publishable** kalit bor.
Bu **sir emas**: u brauzerga baribir chiqadi va aynan shuning uchun
mo'ljallangan. Uni bilgan odam hech narsa qila olmaydi — har bir
so'rov RLS dan o'tadi va foydalanuvchi tokenini talab qiladi.

> Shu sababli Vercel'da hech qanday muhit o'zgaruvchisi sozlash
> kerak emas: repozitoriyni ulash kifoya.

### Kalitlarni ALMASHTIRING

Loyiha kalitlari (service_role, access token, bot tokeni) ishlab
chiqish jarayonida yozishmada ko'rinib ketgan. Ular repo'da yo'q,
lekin baribir **almashtirilishi kerak**:

- Supabase → Settings → API → `service_role` → **Reset**
- Supabase → Account → Access Tokens → eskisini **Revoke**
- Telegram `@BotFather` → `/revoke` → yangi token

Yangi qiymatlarni faqat ikki joyga yozing:

```bash
# 1) mahalliy fayl (repo'ga tushmaydi)
.env.local

# 2) Edge Function sirlari
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=... TELEGRAM_BOT_TOKEN=...
```

---

## 2. Saytni buzib kirish mumkinmi?

**Sayt — oddiy statik fayllar to'plami.** Serveri yo'q, ma'lumotlar
bazasi yo'q, admin paneli yo'q. Buzib kirish uchun "server" ham yo'q.
Vercel faqat HTML/CSS/JS beradi.

Butun huquq bazada. Har bir so'rov ikki bosqichdan o'tadi:

1. **JWT** — foydalanuvchi kim ekanini isbotlaydi;
2. **RLS** — o'sha foydalanuvchi aynan qaysi qatorlarni ko'rishini
   baza darajasida cheklaydi.

Shuning uchun:

| Xavf | Nima bo'ladi |
|---|---|
| Publishable kalitni o'g'irlash | **Hech narsa.** Token'siz bitta qator ham ko'rinmaydi |
| Boshqa maktab ma'lumotini so'rash | **Bo'sh javob.** `scripts/test-isolation.sql` shuni tekshiradi |
| Brauzerdan to'g'ridan-to'g'ri to'lov yozish | **Rad etiladi** (`42501`) — moliyaviy jadvallarga INSERT siyosati yo'q |
| Yozuvni jimgina o'chirish | **Imkonsiz** — DELETE siyosati yo'q, hamma o'zgarish audit jurnalida |
| Sayt kodini o'zgartirish | Vercel'ga kirish kerak — GitHub va Vercel hisobingizni himoyalang |

### Haqiqiy xavflar — ular texnik emas, tashkiliy

1. **Zaif parollar.** Direktorning paroli "12345678" bo'lsa, RLS ham
   yordam bermaydi. Har bir hisob uchun uzun, takrorlanmaydigan parol.
2. **service_role kaliti tarqalishi.** U RLS ni butunlay chetlab
   o'tadi. Faqat Edge Function sirlarida turishi kerak — hech qachon
   brauzerda, hech qachon repo'da.
3. **GitHub / Vercel / Supabase hisoblari.** Uchalasiga ham
   **ikki bosqichli tasdiqlash (2FA)** yoqing. Bu eng zaif nuqta.

---

## 3. Subdomen: `maktab.uztomic.uz`

`uztomic.uz` band bo'lsa ham subdomen mustaqil ishlaydi — asosiy
saytga tegilmaydi.

### 3.1. Vercel'ga ulash

1. [vercel.com](https://vercel.com) → **Add New → Project**
2. GitHub repozitoriyni tanlang (private bo'lsa ham ko'rinadi)
3. Sozlash **shart emas** — `vercel.json` da hammasi yozilgan:
   - build buyrug'i
   - chiqish papkasi
   - SPA yo'naltirishlari
   - xavfsizlik sarlavhalari
4. **Deploy**

Bir necha daqiqada `...vercel.app` manzili tayyor bo'ladi.

### 3.2. Domenni biriktirish

Vercel'da: **Project → Settings → Domains → Add** →
`maktab.uztomic.uz`

Vercel bitta DNS yozuvini so'raydi. `uztomic.uz` boshqariladigan
joyda (domen registratori yoki hosting paneli) shuni qo'shing:

```
Turi:    CNAME
Nomi:    maktab
Qiymati: cname.vercel-dns.com
TTL:     3600 (yoki avtomatik)
```

> `maktab` — subdomen nomi. `crm`, `moliya`, `panel` — xohlagan
> nom bo'lishi mumkin.

DNS 5 daqiqadan bir necha soatgacha tarqaladi. Undan keyin
HTTPS sertifikati **avtomatik** olinadi (Let's Encrypt) —
qo'lda hech narsa qilinmaydi.

### 3.3. Supabase'da manzilni ro'yxatga qo'shish — MAJBURIY

Parolni tiklash xati havolasi shu manzilga qaytadi. Yangi domen
ro'yxatda bo'lmasa, havola **ishlamaydi**.

Supabase → **Authentication → URL Configuration**:

| Maydon | Qiymat |
|---|---|
| Site URL | `https://maktab.uztomic.uz` |
| Redirect URLs | `https://maktab.uztomic.uz/**` |

Ishlab chiqish uchun `http://localhost:5173/**` ni ham qoldiring.

### 3.4. Telegram bot webhook'i

Bot Supabase Edge Function'da ishlaydi va domenga bog'liq emas —
sayt manzili o'zgarsa ham bot ishlashda davom etadi. Hech narsa
qilish kerak emas.

---

## 4. Yuborishdan oldingi ro'yxat

```bash
npm run check:secrets      # maxfiy kalit yo'qligi
npm run build              # TypeScript va build
npm run test:db            # baza mantiqi
node scripts/smoke-test.mjs direktor@namuna.uz   # har bir so'rov
```

To'rtalasi ham o'tsa — yuborish mumkin.

---

## 5. Keyin nima o'zgaradi

`main` shoxiga har bir `git push` — Vercel avtomatik yangi versiyani
quradi va chiqaradi. Xato chiqsa **Deployments** ro'yxatidan eski
versiyaga bir bosishda qaytish mumkin (*Promote to Production*).

Baza migratsiyalari avtomatik emas — ular alohida yuboriladi:

```bash
node scripts/db.mjs push
```
