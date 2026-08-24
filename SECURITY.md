# Xavfsizlik

Bu repozitoriy **ochiq**. Bu ataylab: tizim xavfsizligi kodni
yashirishga tayanmaydi. Butun himoya bazadagi qoidalarda —
ularni o'qish mumkin, lekin chetlab o'tib bo'lmaydi.

Quyida nima nimadan himoya qilishi, nimalar tekshirilishi va
zaiflik topilsa nima qilish yozilgan.

---

## 1. Himoya qanday qurilgan

Sayt — statik fayllar. Serveri, bazasi, admin paneli yo'q. Butun
huquq Supabase'da va u ikki qatlamdan iborat:

| Qatlam | Nima qiladi |
|---|---|
| **JWT** | Foydalanuvchi kimligini isbotlaydi |
| **RLS** | O'sha foydalanuvchi qaysi QATORLARNI ko'rishini baza darajasida cheklaydi |

RLS jadval darajasida ishlaydi, ya'ni so'rov qayerdan kelishidan
qat'i nazar — panel, `curl`, yoki to'g'ridan-to'g'ri PostgREST —
bir xil qo'llanadi.

### Brauzerdagi kalit — sir emas

`apps/maktab-panel/.env.production` dagi **publishable** kalit
ataylab ochiq. U brauzerga baribir chiqadi va faqat "qaysi loyihaga
murojaat qilinyapti" degan savolga javob beradi. Foydalanuvchi
tokenisiz u bilan **bitta qator ham** olib bo'lmaydi.

`service_role` kaliti esa RLS ni butunlay chetlab o'tadi. U hech
qachon repo'da, hech qachon brauzerda bo'lmaydi — faqat Edge
Function sirlarida.

---

## 2. O'nta invariant

`app.security_invariants()` — bazaning o'zida yashaydigan
tekshiruv. Har bir qoida buzilsa **xato tashlaydi**, ya'ni
kelajakdagi migratsiya himoyani jimgina buzib qo'yolmaydi.

| # | Qoida | Nimadan himoya qiladi |
|---|---|---|
| 1 | Har bir jadvalda RLS yoqilgan | Yangi jadval himoyasiz qolishi |
| 2 | `anon` roliga hech qanday huquq yo'q | Kirmagan odam ma'lumot ko'rishi |
| 3 | Hech qayerda DELETE huquqi yo'q | Yozuvni izsiz o'chirish (TZ 5.4.8) |
| 4 | Moliyaviy jadvallar faqat o'qish uchun | Brauzerdan soxta to'lov yozish (TZ 5.4.6) |
| 5 | `SECURITY DEFINER` da `search_path` o'rnatilgan | Sxema almashtirish hujumi |
| 6 | Barcha view `security_invoker` bilan | View orqali RLS ni chetlab o'tish |
| 7 | Pul ustunlari `numeric` | Yaxlitlash xatosi (float) |
| 8 | Storage bucket lari yopiq | Chek rasmiga ochiq havola |
| 9 | `role_permissions` ga yozib bo'lmaydi | Direktor o'ziga huquq qo'shishi |
| 10 | Har bir siyosatda ijarachi filtri | Boshqa maktab ma'lumotini ko'rish |

Ishga tushirish:

```bash
npm run test:db          # zanjirning oxirgi bo'g'ini shu
npm run audit:security   # topilgan muammolar ro'yxati (bo'sh = toza)
```

---

## 3. Auth sozlamalari

```bash
npm run harden:auth              # ko'rsatadi
node scripts/harden-auth.mjs --apply
```

Bu sozlamalar **bazada emas**, loyiha darajasida saqlanadi va
migratsiyaga tushmaydi. Loyiha ko'chirilsa jimgina standart
holatga qaytadi — shuning uchun skript qilingan.

### Qo'llangan

| Sozlama | Qiymat | Nega |
|---|---|---|
| Parol uzunligi | **12** | 8 ta belgi 2026-yilda kam |
| Talab qilinadigan belgilar | kichik + katta harf + raqam | Maxsus belgi talab qilinmaydi — u "Parol1!" naqshiga majburlaydi |
| Xatdagi havola umri | **15 daqiqa** | 1 soat — pochtaga kirgan odam uchun uzoq |
| Ro'yxatdan o'tish | **yopiq** | Hisobni faqat administrator yaratadi |
| Refresh token almashinuvi | **yoqilgan** | O'g'irlangani ma'lum bo'lsa zanjir bekor qilinadi |
| Ruxsat etilgan manzillar | faqat sayt va localhost | Ochiq yo'naltirish hujumi |
| Parolni o'zgartirishda qayta tasdiqlash | **yoqilgan** | Ochiq qolgan sessiyadan parol almashtirish |

### Bepul tarifda MUMKIN EMAS

| Sozlama | Nima berardi |
|---|---|
| `password_hibp_enabled` | Sizib chiqqan parollarni rad etish |
| `sessions_inactivity_timeout` | Harakatsizlikdan keyin chiqarish |
| `sessions_timebox` | Sessiyaning eng uzun umri |

Ikkinchi va uchinchisining o'rni **ilova darajasida** bosilgan:
[IdleGuard.tsx](apps/maktab-panel/src/auth/IdleGuard.tsx) — 45
daqiqa harakat bo'lmasa sessiya yopiladi, 2 daqiqa oldin
ogohlantiradi. Bir nechta oyna ochiq bo'lsa ham to'g'ri ishlaydi.

Birinchisining o'rnini 12 belgi + harf/raqam talabi qisman bosadi.
Pro tarifga o'tilganda `harden-auth.mjs` ni qayta ishga tushiring —
qolgani o'zi qo'llanadi.

---

## 4. Sinovlar bilan isbotlangan

| Nima tekshiriladi | Fayl |
|---|---|
| Boshqa maktab ma'lumoti ko'rinmaydi | `scripts/test-isolation.sql` |
| Brauzerdan to'lov INSERT rad etiladi (`42501`) | `scripts/test-isolation.sql` |
| Yopilgan davrda tahrirlash rad etiladi | `scripts/test-classes.sql` |
| Tahrirlash audit jurnaliga eski→yangi qiymatni yozadi | `scripts/test-classes.sql` |
| O'nta xavfsizlik invarianti | `scripts/test-security.sql` |
| Panelning har bir so'rovi haqiqiy token bilan | `scripts/smoke-test.mjs` |

---

## 5. Repo'da nima bor va nima yo'q

| Fayl | Repo'da | Nega |
|---|---|---|
| `.env.local` | **Yo'q** | `service_role` kaliti va access token |
| `.webhook-secret` | **Yo'q** | Bot nomidan so'rov yuborish mumkin |
| `apps/maktab-panel/.env.production` | **Ha** | Faqat publishable kalit |

Har bir push'da tekshiriladi:

```bash
npm run check:secrets
```

Skript `git` ning o'zidan "nimani qo'shasan" deb so'raydi va
kuzatilayotgan fayllarni ham tekshiradi — `.gitignore` ga ishonib
qolmaydi.

---

## 6. Eng zaif nuqta — texnik emas

1. **Parollar.** Direktorning paroli "Maktab2026" bo'lsa, RLS ham
   yordam bermaydi. 12 belgi talabi bor, lekin uzun va
   takrorlanmaydigan parol tanlash — odamning ishi.
2. **`service_role` kaliti.** U hamma narsani ochadi. Faqat Edge
   Function sirlarida turishi kerak.
3. **GitHub va Supabase hisoblari.** Ikkalasiga ham **2FA yoqing.**
   Hisobni qo'lga kiritgan odam kodni ham, bazani ham o'zgartira
   oladi — bunda hech qanday RLS to'sib turolmaydi.

---

## 7. Zaiflik topsangiz

Muammoni **ochiq issue qilib yozmang**. To'g'ridan-to'g'ri
yozing: **uztomic@gmail.com**

Iltimos quyidagilarni qo'shing:

- muammo qanday takrorlanadi;
- qanday ma'lumotga tegishli;
- ta'sir doirasi (bitta maktabmi yoki hammasi).

Javob 72 soat ichida beriladi.
