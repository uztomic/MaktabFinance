# O'quv markazi rejimi

MaktabFinance endi ikki turdagi tashkilotga xizmat qiladi. Tur
**Sozlamalar → Tashkilot turi** da (faqat direktor) yoki yangi tashkilot
ochishda tanlanadi:

```
node scripts/new-school.mjs "Smart Academy" 998901234567 --oquv-markaz
```

Tur almashtirilganda ma'lumot o'chmaydi — faqat menyu, atamalar va bosh
sahifa moslashadi.

## Nima bor

| Bo'lim | Imkoniyat |
|---|---|
| **Guruhlar** | kurs, o'qituvchi, xona, hafta kunlari, vaqt, sig'im, narx; kartochka/jadval ko'rinishi; to'lganlik va oylik tushum |
| **Guruh kartochkasi** | o'quvchi qo'shish (mavjud yoki yangi), sinov darsi, o'qishga o'tkazish, muzlatish, boshqa guruhga o'tkazish, chiqarish (sabab bilan), qarz belgisi |
| **Darslar** | jadvaldan avtomatik (bayram/ta'til o'tkazib yuboriladi), qo'shimcha dars, bekor qilish, o'rinbosar |
| **Davomat** | o'qituvchi telefonda: standart "keldi", faqat kelmaganini bosadi; baho, izoh, mavzu, uyga vazifa |
| **Jurnal** | o'quvchi × dars jadvali, davomat foizi, o'rtacha baho |
| **Dars jadvali** | haftalik to'r (xona/o'qituvchi filtri), to'qnashuvlar qizil |
| **Sotuv voronkasi** | Kanban: Yangi → Bog'lanildi → Sinov darsi → Yozildi / Rad etdi; sudrab o'tkazish; rad etish sababi; konversiya |
| **Kurslar va xonalar** | odatiy narx, dars davomiyligi, rang; xona sig'imi |
| **O'qituvchi haqi** | guruh bo'yicha: tushumdan foiz / darsbay / o'quvchibay — oylik hisobiga alohida qator |
| **Bosh sahifa** | faol guruhlar, o'quvchilar, to'lganlik, oy o'sishi, bugungi darslar, voronka |

## Moliya qanday ishlaydi

Guruh = oylik xizmat (`services`, `monthly_fixed`). O'quvchini guruhga
yozish = shu xizmatni ulash. Shuning uchun hisoblanma, oy o'rtasidan
proporsional hisob, chegirma, to'lov, qarzdorlik, davr qulfi, Telegram
bot va 7 ta hisobot o'zgarishsiz ishlaydi.

- Sinov darsi — bepul, hisob boshlanmaydi.
- Muzlatish — o'sha kunlar hisoblanmaydi, muddat tugagach avtomatik qaytadi.
- O'tkazish — oldingi kungacha eski guruh, shu kundan yangi guruh narxi.
- Narx o'zgarsa — joriy oy boshidan; o'tgan oylar o'zgarmaydi.

## Jonli bazaga qo'llash

```
node scripts/db.mjs push          # 20261103100000_learning_center.sql
npm run test:db                   # 8 ta sinov to'plami
```

Migratsiya maktablarga ta'sir qilmaydi: hamma mavjud tashkilot `school`
turida qoladi, yangi jadvallar bo'sh boshlanadi.
