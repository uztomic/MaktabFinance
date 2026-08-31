// =====================================================================
//  Sahifani yuklash — eskirgan bo'lakdan himoya bilan.
//
//  MUAMMO. Sahifalar `lazy(() => import(...))` bilan alohida
//  bo'laklarga bo'lingan va ular fayl nomida XESH bilan yoziladi:
//  `Settings-C9xK2p.js`. Yangi versiya chiqarilganda xesh o'zgaradi va
//  eski fayl serverdan yo'qoladi.
//
//  Brauzerda esa ochiq turgan sahifa va xizmat ishchisi (PWA) hali
//  ESKI ro'yxatni biladi. Odam menyudan boshqa sahifaga o'tsa, brauzer
//  endi mavjud bo'lmagan bo'lakni so'raydi, `import()` rad etiladi va
//  ilova qulaydi — ekran oppoq bo'lib qoladi.
//
//  Bu deyarli har bir yangilanishdan keyin, ochiq qolgan oynada
//  takrorlanadi. Foydalanuvchi uchun esa bu shunchaki "tizim buzildi".
//
//  YECHIM. Yuklash rad etilsa BIR MARTA sahifa qayta yuklanadi —
//  shunda brauzer yangi ro'yxatni oladi va bo'lak topiladi.
//
//  Takroriy yuklanishning oldini olish uchun belgi qo'yiladi: agar
//  qayta yuklashdan keyin ham xato bo'lsa, sabab boshqa (masalan
//  tarmoq yo'q) va xato yuqoriga uzatiladi — u yerda xato chegarasi
//  o'qiladigan xabar ko'rsatadi. Aks holda sahifa cheksiz yangilanib
//  turardi.
// =====================================================================

import { lazy, type ComponentType } from 'react';

const FLAG = 'maktab-chunk-reloaded';

export function lazyPage<T extends ComponentType<unknown>>(
  load: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await load();
      //  Muvaffaqiyat — belgi tozalanadi, keyingi safar yana bir
      //  urinishga imkon qolsin.
      try { sessionStorage.removeItem(FLAG); } catch { /* maxfiy oyna */ }
      return mod;
    } catch (err) {
      let alreadyTried = false;
      try {
        alreadyTried = sessionStorage.getItem(FLAG) === '1';
        if (!alreadyTried) sessionStorage.setItem(FLAG, '1');
      } catch {
        //  `sessionStorage` yopiq bo'lsa qayta yuklashni takrorlamaymiz:
        //  belgini saqlash imkoni yo'q, ya'ni tsiklga tushish xavfi bor.
        alreadyTried = true;
      }

      if (!alreadyTried) {
        globalThis.location.reload();
        //  Qayta yuklash boshlangunga qadar React nimadir kutadi.
        await new Promise(() => {});
      }

      throw err;
    }
  });
}
