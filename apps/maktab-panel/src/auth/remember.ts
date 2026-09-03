// =====================================================================
//  "MENI ESLAB QOL"
//
//  Sessiya brauzerda allaqachon saqlanardi va oyna yopilib qayta
//  ochilsa odam kirib turardi. Lekin `IdleGuard` 45 daqiqa harakat
//  bo'lmasa chiqarib yuborardi — parol har kuni bir necha marta
//  so'ralardi.
//
//  U qo'riqchi bejiz emas: kanselyariyadagi UMUMIY kompyuterda panel
//  ochiq qolsa, xohlagan odam kelib to'lov yozadi yoki qarzdorlik
//  ro'yxatini ko'radi. Shuning uchun uni butunlay olib tashlamadim.
//
//  Endi bu TANLOV: o'z telefonida yoki shaxsiy noutbukida ishlaydigan
//  odam belgini qo'yadi va qayta so'ralmaydi. Umumiy kompyuterda esa
//  belgi qo'yilmaydi va qo'riqchi avvalgidek ishlaydi.
//
//  Belgi shu QURILMADA saqlanadi — bazaga tegishli emas.
// =====================================================================

const KEY = 'maktab-remember';

export function isRemembered(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    //  Maxfiy oynada saqlash yopiq — bunday joyda "eslab qolish"
    //  baribir ishlamaydi, shuning uchun qo'riqchi yoqiq qoladi.
    return false;
  }
}

export function setRemembered(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* maxfiy oyna */ }
}

/**
 *  Brauzerdan saqlangan sessiyani O'CHIRMASLIKNI so'raydi.
 *
 *  Telefonda muammo aynan shu edi: Android Chrome joy yetmasa yoki
 *  sayt uzoq ochilmasa `localStorage` ni jimgina tozalab yuboradi.
 *  Kompyuterda bu deyarli bo'lmaydi — shuning uchun panel
 *  kompyuterda odamni eslab qolardi, telefonda esa yo'q.
 *
 *  `persist()` shu saytni "tozalanmaydigan" ro'yxatga qo'yishni
 *  so'raydi. Brauzer rad qilishi mumkin va bu xato emas: u holda
 *  avvalgidek ishlaydi, shunchaki kafolat bo'lmaydi.
 *
 *  Faqat "eslab qol" belgilanganda so'raladi — bu odamning
 *  ongli tanlovi, ruxsat so'rash uchun asos aynan o'sha.
 */
export async function keepStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist();
  } catch { /* qo'llab-quvvatlanmasa — muhim emas */ }
}
