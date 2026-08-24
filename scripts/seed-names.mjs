// =====================================================================
//  seed-names.mjs — ism-familiya havzalari va tasodifiy tanlash.
//
//  Nega alohida fayl: ro'yxatlar uzun va ular `seed-school.mjs` ning
//  mantiqini ko'mib yuborardi. Bu yerda faqat ma'lumot.
//
//  Nega URUG'LANGAN (seeded) tasodif: skript qayta ishga tushirilsa
//  AYNAN o'sha ma'lumot chiqishi kerak. Aks holda "kecha 3-sinfda
//  necha bola bor edi" degan savolga javob har safar o'zgaradi va
//  xatoni takrorlab bo'lmaydi.
// =====================================================================

// --- Urug'langan tasodif (mulberry32) --------------------------------
let state = 20260825;

export function reseed(n = 20260825) {
  state = n >>> 0;
}

/** [0, 1) oralig'ida tasodifiy son. */
export function rnd() {
  state |= 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [min, max] oralig'idagi butun son. */
export function rint(min, max) {
  return min + Math.floor(rnd() * (max - min + 1));
}

/** Ro'yxatdan bittasi. */
export function pick(arr) {
  return arr[Math.floor(rnd() * arr.length)];
}

/** `p` ehtimollik bilan rost. */
export function chance(p) {
  return rnd() < p;
}

/** Ro'yxatni aralashtiradi (nusxasini qaytaradi). */
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Ismlar -----------------------------------------------------------

export const SURNAMES = [
  'Abdullayev', 'Abdurahmonov', 'Aliyev', 'Akbarov', 'Alimov', 'Artikov',
  'Ashurov', 'Azizov', 'Bekmurodov', 'Boboyev', 'Bozorov', 'Burhonov',
  'Davronov', 'Dehqonov', 'Ergashev', 'Eshonqulov', 'Fayziyev', 'G‘aniyev',
  'G‘ulomov', 'Habibov', 'Hakimov', 'Hamroyev', 'Hasanov', 'Holmatov',
  'Ibrohimov', 'Inoyatov', 'Ismoilov', 'Jabborov', 'Jalilov', 'Jo‘rayev',
  'Kamolov', 'Karimov', 'Kholmirzayev', 'Qodirov', 'Qosimov', 'Qurbonov',
  'Latipov', 'Mahmudov', 'Mamatqulov', 'Mansurov', 'Matkarimov', 'Mirzayev',
  'Muhammadiyev', 'Muminov', 'Murodov', 'Mustafoyev', 'Nazarov', 'Niyozov',
  'Normatov', 'Nurmatov', 'Olimov', 'Orifov', 'Ochilov', 'Pardayev',
  'Rahimov', 'Rahmonov', 'Rasulov', 'Ravshanov', 'Rustamov', 'Sadikov',
  'Safarov', 'Saidov', 'Salimov', 'Samadov', 'Sattorov', 'Sharipov',
  'Shermatov', 'Shokirov', 'Sobirov', 'Sultonov', 'Tashkentov', 'Tillayev',
  'Tojiyev', 'Toshmatov', 'Turg‘unov', 'Umarov', 'Usmonov', 'Vohidov',
  'Xolmatov', 'Xudoyberdiyev', 'Yo‘ldoshev', 'Yusupov', 'Zaripov', 'Ziyodullayev',
];

export const MALE_NAMES = [
  'Abbos', 'Abdulaziz', 'Aziz', 'Akbar', 'Alisher', 'Amir', 'Anvar',
  'Asadbek', 'Aslon', 'Avaz', 'Baxtiyor', 'Behruz', 'Bekzod', 'Bilol',
  'Botir', 'Davron', 'Diyor', 'Dilshod', 'Doston', 'Elyor', 'Eldor',
  'Farrux', 'Farhod', 'Firdavs', 'G‘ayrat', 'Hasan', 'Husan', 'Ibrohim',
  'Islom', 'Ismoil', 'Jahongir', 'Jasur', 'Javohir', 'Kamron', 'Komil',
  'Lazizbek', 'Mansur', 'Muhammad', 'Muhammadali', 'Murod', 'Nodirbek',
  'Nurbek', 'Ogabek', 'Olimjon', 'Otabek', 'Ozodbek', 'Rustam', 'Ruslan',
  'Sardor', 'Sanjar', 'Shahzod', 'Shohrux', 'Sherzod', 'Sirojiddin',
  'Temur', 'Ulug‘bek', 'Umar', 'Xurshid', 'Yusuf', 'Zafar', 'Ziyodbek',
];

export const FEMALE_NAMES = [
  'Aziza', 'Aygul', 'Barno', 'Charos', 'Dilbar', 'Dildora', 'Dilnoza',
  'Durdona', 'Feruza', 'Gulbahor', 'Gulnora', 'Gulnoza', 'Guzal',
  'Hilola', 'Iroda', 'Jasmina', 'Kamola', 'Komila', 'Lola', 'Madina',
  'Maftuna', 'Mahliyo', 'Malika', 'Marjona', 'Mohira', 'Muhayyo',
  'Munisa', 'Nafisa', 'Nargiza', 'Nasiba', 'Nigora', 'Nilufar', 'Nodira',
  'Odina', 'Ozoda', 'Rayhona', 'Robiya', 'Sabina', 'Sadoqat', 
  'Sevara', 'Sevinch', 'Shahnoza', 'Shahzoda', 'Sitora', 'Umida',
  'Xurshida', 'Yulduz', 'Zarina', 'Zilola', 'Zuhra', 'Zulfiya',
];

/** Ayol familiyasi — `-ov/-ev` ga `-a` qo'shiladi. */
export function feminize(surname) {
  if (/(ov|ev|yev)$/.test(surname)) return surname + 'a';
  return surname;
}

/** Telefon raqami — O'zbekiston formati, takrorlanmaydi. */
const usedPhones = new Set();
const OPERATORS = ['90', '91', '93', '94', '97', '98', '99', '88', '77', '33'];

export function phone() {
  for (let i = 0; i < 500; i++) {
    const p = `998${pick(OPERATORS)}${String(rint(1000000, 9999999))}`;
    if (!usedPhones.has(p)) { usedPhones.add(p); return p; }
  }
  throw new Error('Telefon raqami tugadi');
}

export function resetPhones() {
  usedPhones.clear();
}
