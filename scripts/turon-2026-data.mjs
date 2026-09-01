// =====================================================================
//  TURON ILM XAZINASI — 2026/2027 o'quv yili
//
//  Farhodjon yuborgan ro'yxat AYNAN ko'chirilgan. Narxlar manbada
//  mingda yozilgan (1700 = 1 700 000 so'm), shuning uchun import
//  paytida 1000 ga ko'paytiriladi.
//
//  `null` narx — manbada `--------` turgan joy. Bunday o'quvchiga
//  shartnoma YARATILMAYDI: narxni o'zim to'qib qo'yish noto'g'ri
//  bo'lardi va u keyin sezilmay qolardi. Ular hisobotda alohida
//  ko'rsatiladi.
// =====================================================================

export const CLASSES = [
  {
    name: '1-A', grade: 1, lang: "O'zbek tili",
    students: [
      ['Azimhadjayev Ismoil', 1700],
      ["G'oziyeva Soliha", 1700],
      ['Qurbonjonov Muhammadyusuf', 1400],
      ['Ummataliyeva Zaynab', 1615],
      ['Rustamjonova Imona', 1700],
      ['Solihadjayeva Hadicha', 1700],
      ['Bahtiyorjonova Amiraxon', 1400],
      ['Ahrarova Mabruka', 1700],
      ['Islomjonov Muhammadrasul', 1700],
      ['Usmonbekov Muhammadsolih', 1700],
      ['Ilhomjonova Mohinur', 1500],
      ['SHuhratjonov Muhammadsolih', 1700],
      ['Umarov Muhammadmustafo', 1700],
      ['Adhamov Muhammadloiq', 1700],
    ],
  },
  {
    name: '1-B', grade: 1, lang: "O'zbek tili",
    students: [
      ['Ahrorov Muhammadali', 1700],
      ['Rahimova Oyishaxon', 1700],
      ['Bahromjonov Bilol', 1700],
      ['Toirov Abdulloh', 1700],
      ['Umaraliyeva Bibihojar', 1150],
      ['Abdunosirova Asmo', 1615],
      ['Kadirova Afruza', 1700],
      ['Masodiqov Muhammadyusuf', 1150],
      ['Turdaliyev Haled', 1600],
      ['Serobjonova Mumtozbegim', 1700],
      ['Solijonov Muhammadamin', 1700],
      ['Qahramonjonov Muhammadjon', 1700],
      ['Kamalova Oyishaxon', 1700],
    ],
  },
  {
    name: '1-V', grade: 1, lang: 'Rus tili',
    students: [
      ['Islomjonov Abdulloh', 1700],
      ['Nematullayeva Maryamxon', 1700],
      ['Mamajonov Mirakbar', 1700],
      ['Muhtorova Farzona', 1615],
      ["Sayidqosimova Dlafro'z", 1700],
      ["Ne'matov Nurmuhammad", 850],
      ['Rahmonjonova Soliha', 1700],
      ['Donyorjonova Soliha', 1550],
      ['Dilshodov Muhammadrizo', 1700],
      ['Muzaffarjonova Mumtozbegim', 1700],
      ['Rahimov Abdullajon', 1700],
      ['Xayrullayev M Mustafo', 1600],
      ['Kariyev Muhammadyusuf', 1600],
      ['Abdirimova Billura', 1700],
      ['Kadirova Samiyaxon', 1700],
      ['Abdurashidova Ominaxon', 1600],
      ['Aliyev Behruz', 850],
      ['Narimonjonova Soliha', 1700],
      ['Mahammedjanov Habibulloh', 1400],
      ['Halilov Muhammadyusuf', 1700],
      ['Saliyeva Zinnuraxon', 850],
      ['Karimov Muhammadyusuf', 1250],
      ['Bulbul Muhammadamir', 1615],
      ['Rayimberdiyev Muhammadali', 1700],
    ],
  },
  {
    name: '2-A', grade: 2, lang: null,
    students: [
      ['Turakulov Muhammadmustafo', 1700],
      ['Umarov Abubakr', 1700],
      ['Jalilova Zinnurabonu', 1700],
      ['Muxtorova Feruzaxon', 1600],
      ['Akramov Muhammadsolih', 1600],
      ['Xayrullayeva Imronaxon', 1700],
      ["G'ayratov Muhammadmustafo", 1700],
      ['Sharipova Hadichabonu', 1700],
      ['Ibragimov Murodbek', 1700],
      ["Nu'monjonova Yasina", 1600],
      ['Nabiyev Anasxon', 1700],
      ['Subxonova Yasminaxon', 1700],
      ['Komilova Marziyaxon', 1700],
      ['Odilbekov Sarvar', 1500],
      ['Abduraximova Asmoxon', 1700],
      ['Inomova SHukronaxon', 1700],
      ["G'aniyev Musab", null],
      ['Munavvarov Nurmuhammad', 1500],
      ["G'ayratov Muhammadrizo", 1500],
    ],
  },
  {
    name: '2-B', grade: 2, lang: null,
    students: [
      ['Nuriddinov Muhammadrizo', 1200],
      ['Ibragimova Imonaxon', 1000],
      ['Xotamqulov Zubayr', 1000],
      ['Adhamov Muhammadisxoq', 1200],
      ['Hadjayev Umarxon', 1000],
      ['Anvarov M Umarxon', null],
      ['Akbarov Abdulloh', 1000],
      ['SHokirov Muhammadamin', 1000],
      ['SHokirjonov Muhammad Yusuf', 500],
      ["G'ayratjonova Honzoda", null],
      ['Haydaraliyeva Nuriya', 1000],
      ['Karimnazarova Oyishaxon', 1000],
      ['Subxonov Muhammadali', 1000],
      ['Muhtorov Muhsinjon', 1000],
      ['Umitjonov Muhammadyusuf', 1000],
      //  Manbada faqat "Muhammad" — familiyasi yo'q.
      ['Muhammad', 1200],
    ],
  },
  {
    name: '3-A', grade: 3, lang: null,
    students: [
      ['Abdurashidova Hadichaxon', 1700],
      ['Karimnazarov Muhammadamin', 1600],
      ['Salixadjayev Salohiddin', 1700],
      ['Bahtiyorjonova Imonaxon', 1700],
      ['Karabayev Muhammadamirxon', 1700],
      ["Aliev Abdumo'min", 1700],
      ['Abdurahimov Muhammadsodiq', 1700],
      ["Mo'ydinov Nursultonxon", 1615],
      ['Bahodirova Asmo', null],
      ['Jengiz Emirxan', 1700],
      ["Numanova Mohizo'zaxon", null],
      ['Rustamov Abdulloh', 1700],
      ['Muhammadiyev Ali', 1700],
      ['Umarova Hadichaxon', 1600],
      ['Rustamova Mumtozbegim', 1400],
      ['Varisov Sultonmurod', 1700],
    ],
  },
  {
    name: '3-B', grade: 3, lang: null,
    students: [
      ['Akmaljonov Zubayr', 1700],
      ['Ahmedov Hojiakbar', 1500],
      ['Yakubov Mustafo', 1450],
      ['Usmonova Hadicha', 1700],
      ['Adilova Asalbibi', 1700],
      ['Bahromova Dilsorabegim', 1700],
      //  Manbada IKKI MARTA yozilgan — pastda tekshiriladi.
      ['Abdusattorov Abdulloh', 1700],
      ['Abdusattorov Abdulloh', 1700],
      ['Islomova Soliha', 1700],
      ['Maqsudjonov Mahmudjon', 1700],
      ['Nizomiddinov Muhammadsolih', 1600],
      ['Rashidxonov Raxmatxon', 1700],
      ['Mamarasulov Mustafo', 1700],
      ['Aydan Elif Bulbul', 1700],
    ],
  },
  {
    name: '3-V', grade: 3, lang: null,
    students: [
      ['Muzaffarjonov Zubayr', 1700],
      ['Kamalova Sadiya', 1700],
      ['Rustamov Islom', 1700],
      ['Aminova Hadichanur', 1600],
      ['Qahhorjonova Madinaxon', 1400],
      ['Bahtiyorov Muhammadyusuf', 1615],
      ['Ahmadaliyeva Sayyoraxon', 1700],
      ['Nuriyev Abdulboriy', 1700],
      ['Tojiyeva Mehrinso', 1700],
      ['Avazov Anasxon', 1000],
      ['Mamatkulov Mirmuhsin', 1600],
      ["Nuriddinova Ma'sudaxon", 1600],
      ['Abdunosirova Asmoxon', 1700],
      ['Ilyosov Muhammadyusufxon', 1600],
    ],
  },
  {
    name: '4-A', grade: 4, lang: null,
    students: [
      ['Aliev Abdulaziz', 1700],
      ['Alijonov Alijon', 1600],
      ['Marupov Mustafo', 1600],
      ['Sharipova Parizodabegim', 1700],
      ['Qoraboeva Muruvvatxon', 1300],
      ['Ahmedov Ahmadjon', 1700],
      ['Muhammadjonova Gulirano', 1615],
      ['Foziljonova Mohizodaxon', 1600],
      ['Aminova Solihanur', 1600],
      ['Izzatullaeva Muzifaxon', 1600],
      ['Karimnazarova Ominaxon', 1600],
      ['Mirzayunusova Samiraxon', 1700],
      ['Mirfayozov Ismoil', 1700],
      ['Xamidova Oishaxon', 1700],
      ['Sharipova Zinnura', null],
      ['Rustamova Solihabonu', 1400],
    ],
  },
  {
    name: '4-B', grade: 4, lang: null,
    students: [
      ['Karimova Bibisora', 1250],
      ['Mahkamov Ali', 1600],
      ['Muhammedjanov Otabek', 1350],
      ['Abdullayev Abdurashid', 1300],
      ["Ma'murov Muhammadumar", 1700],
      ['Mamatqulov Temur', 1600],
      ['Karimova SHukrona', 850],
      ['Kariev Muhammadmustafo', 1600],
      ['Muhammedjonova Mubina', 1400],
    ],
  },
  {
    name: '5-A', grade: 5, lang: null,
    students: [
      ['Valixonov SHukurxon', 1600],
      ['Bahtiyorov Abdurahmon', 1700],
      ['Rahmonov Ikromjon', 1700],
      ['Muhammadjonov Muhammadsodiq', 1615],
      ["Mo'ydinov To'lqinjon", 1615],
      ['Mamatqulov Diyor', 1650],
      ["Muhammadjonov Behro'zbek", 1700],
      ['Hasanov Imronbek', 1700],
      ['Adhamova Nasiba', 1615],
    ],
  },
  {
    name: '6-A', grade: 6, lang: null,
    students: [
      ['Qurbonjonov Imronbek', 1400],
      ['Usmonov Sayidumar', 1700],
      ['Ilyosova Munisa', 1600],
      ['Hakimov Islombek', 1600],
      ['Karimova Dinora', 850],
    ],
  },
  {
    name: '7-A', grade: 7, lang: null,
    students: [
      ['Abdullaeva Mubina', 1700],
      ['Turdaliev Omar', 1700],
      ['Abdurashidov Anasxon', 1600],
      ['Subxonova Hosiyatxon', 1600],
      ['Abdullayeva Olimaxon', 1615],
    ],
  },
  {
    name: '9-A', grade: 9, lang: null,
    students: [
      ['Abdullayeva Zulfiya', 1000],
      ['Abdullayev Abubakir', 1200],
      ['Ummataliev Muhammadali', 1700],
      ['Nosirov Muhtorjon', 1700],
      ['Subxonova Kumushbibi', 1600],
      ['Nazirov Nozimjon', 1700],
    ],
  },
  {
    name: "Bog'cha", grade: 0, lang: null,
    students: [
      ['Abdumuhtorov Mirzohidjon', 1200],
      ["A'zamova Sumayya", 1200],
      ['Muhammadzokirov Msolih', 1200],
      ['Farhodjonov Abubakir', 1200],
      ['Obidjonova Muslimaxon', 1200],
      ['Nuriddinov Ziyoviddin', 1200],
      ['Muhammadjonov Ibrohimjon', 1200],
      ["Do'smatova Fotimaxon", 1200],
      ["Ho'jamurodov Muhammadyusuf", 1200],
      ["G'ayratova Mohizoda", null],
      ["Ma'murov Muhammadziyo", 1200],
      ['Madaminova Marziyaxon', 1200],
      ["G'ayratjonova Soliha", 1200],
      ["Anvarjonov Xo'ja", 1200],
      ["G'aniyeva Muslimaxon", null],
      ['Bahodirova Muslima', null],
      ['Xaydarov Sayitazim', 1200],
      ['Xaydarova Zaynab', 1200],
      ['Sayidaxmedov Muhammadumar', 1200],
      ['Botirjonova Bibirobiya', 1200],
    ],
  },
];

// =====================================================================
//  O'QITUVCHILAR VA XODIMLAR
//
//  `salary` — oylik so'mda. `class` — sinf rahbarligi (bo'lsa).
//  `factor` — ustama koeffitsienti: "5 000 000 + 10%" → 1.10.
//  `note` — manbadagi noaniqlik. Bunday joyni o'zimcha hal
//  qilmadim: taxmin qilib yozib qo'ysam, u keyin haqiqat bo'lib
//  qolardi va tekshirilmasdi.
// =====================================================================

const HOUR = 45000;

export const TEACHERS = [
  { name: 'Aripova Akidaxon', salary: 10_000_000, subject: null,
    note: 'Manbada lavozimi ko\'rsatilmagan' },

  { name: 'Akbarova Mastura Yunusali qizi', salary: 4_000_000, class: '1-A' },
  { name: 'Ernazarova Namuna',              salary: 4_000_000, class: '1-B' },
  { name: 'Rustamova Gulnara Rinatovna',    salary: 5_000_000, class: '1-V' },
  { name: 'Zakirova Orasta',                salary: 4_000_000, class: '2-A' },

  { name: 'Pulatova Muxtasarxon', salary: 4_500_000, class: '2-B',
    note: 'Manbada "4 500 000 / 5 000 000?" — aniqlashtirish kerak' },

  { name: 'Nazirova Iroda',  salary: 5_000_000, class: '3-A', factor: 1.10 },
  { name: 'Yusupova Orasta', salary: 5_000_000, class: '3-B', factor: 1.10 },
  { name: 'Halilova Iroda',  salary: 4_500_000, class: '3-V', factor: 1.05 },

  { name: 'Xodjibaeva Gulnoza', salary: 6_500_000, class: '4-A',
    note: 'Manbada "6 500 000 + 7 000?" — qo\'shimchasi aniq emas' },

  { name: "Ro'ziboeva Mumtozbegim", salary: 5_000_000, class: '4-B' },
  { name: 'Vaxobova Iroda',         salary: 3_500_000, class: '5-A' },

  { name: 'Sodikova Nafisa', salary: 3_500_000, class: '6-A',
    subject: 'Administrator' },

  //  Manbada ikki qatorda: 7-A rus tili 4 500 000 + qo'shimcha soat,
  //  va alohida "Rus tili 40 soat". Bitta odam deb olindi.
  { name: 'Nurmatova Gulmira', salary: 4_500_000, class: '7-A',
    subject: 'Rus tili',
    note: `Manbada alohida 40 soat ham ko'rsatilgan (40 × ${HOUR} = ${40 * HOUR}). Qo'shilishi aniqlanmagan` },

  { name: 'Kodirov Muslimbek', salary: 55 * HOUR, class: '9-A',
    note: `55 soat × ${HOUR}` },

  { name: 'Kimsanova Nargiza', salary: 0, subject: 'Jismoniy tarbiya',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },

  { name: 'Sultonova Asya',       salary: 6_500_000, subject: 'Ingliz tili' },
  { name: 'Sherkuziyeva Maftuna', salary: 0, subject: 'Ingliz tili',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },
  { name: "Meliboeva Ma'rifat",   salary: 0, subject: 'Geografiya',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },

  { name: 'Sodikova Moxidil',     salary: 1_500_000, subject: "Bog'cha tarbiyachi" },

  { name: 'Buvonazarova Mufazzal', salary: 40 * HOUR, subject: 'Odobnoma',
    note: `40 soat × ${HOUR}` },
  { name: 'Xodjaev Ibrohim',   salary: 8_000_000, subject: 'Odobnoma' },
  { name: 'Arzamova Nafisa',   salary: 0, subject: 'Odobnoma',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },
  { name: 'Xamidova Charos',   salary: 0, subject: 'Odobnoma',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },

  { name: 'Abdurazzoqova Elmira', salary: 7_000_000, subject: "Bog'cha" },
  { name: 'Sobirova Dilnoza',     salary: 1_700_000, subject: 'Gimnastika' },
  { name: 'Ubaydullaev Jaloliddin', salary: 1_700_000, subject: 'DZYUDO' },
  { name: 'Babayan Gayana',       salary: 4_000_000, subject: "Bog'cha" },

  { name: 'Akbarova Muxayyo',  salary: 2_300_000, subject: 'Xodim' },
  { name: 'Bozorova Fotima',   salary: 3_000_000, subject: 'Xodim' },
  { name: 'Ortiqova Odina',    salary: 3_000_000, subject: 'Xodim' },
  { name: "Jo'rayeva Muattar", salary: 2_000_000, subject: 'Xodim' },
  { name: 'Abdullaeva Nazira', salary: 2_500_000, subject: 'Buxgalter' },

  { name: "Bo'ymatova Maftuna", salary: 0, subject: 'Musiqa',
    note: "Soatbay, soat soni manbada ko'rsatilmagan" },

  { name: 'Tadjibaev Vaxobxon', salary: 2_000_000, subject: null,
    note: "Manbada lavozimi ko'rsatilmagan" },
  { name: 'Valieva Sadoratxon', salary: 2_500_000, subject: 'Dast…',
    note: "Manbada fani to'liq o'qilmagan" },
];

/**
 *  Ismi ko'rsatilmagan uchta qator KIRITILMAYDI.
 *
 *  Manbada: "Ona 2 100 000?", "Fransuz 1 700 000", "1 700 000".
 *  Ismsiz xodim yozuvi foydasiz: unga oylik hisoblab bo'lmaydi,
 *  hisobga kirita ham olmaysiz. Ular ro'yxatda alohida aytiladi.
 */
export const UNNAMED = [
  { subject: 'Ona',       salary: 2_100_000, note: 'Manbada "?" bilan' },
  { subject: 'Fransuz',   salary: 1_700_000 },
  { subject: null,        salary: 1_700_000 },
];
