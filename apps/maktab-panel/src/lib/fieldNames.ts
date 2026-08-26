// =====================================================================
//  Bazadagi nomlarni odam o'qiydigan matnga aylantirish.
//
//  MUAMMO. Bazada hamma narsa inglizcha kod: ustun nomi
//  `base_salary`, ustama kodi `class_teacher`, tur `percent`,
//  yaxlitlash yo'nalishi `nearest`. Bu kodlar bir necha ekranda
//  TO'G'RIDAN-TO'G'RI chiqib qolgan edi:
//
//    · oylik kartochkasida — "Formula: base_salary * rate_factor",
//      "Kod: class_teacher", "Turi: percent";
//    · tizim jurnalida — "base_salary: 5000000 → 5500000".
//
//  Direktor va buxgalter uchun bu shunchaki tushunarsiz. Bundan ham
//  yomoni: yorliqlar kodda o'zbekcha qattiq yozilgan edi, ya'ni
//  ruscha interfeysda ham o'zbekcha chiqardi.
//
//  YECHIM. Bitta joyda nom beriladi va uchala tilda ishlaydi.
//  Noma'lum kalit uchun ham xom `snake_case` ko'rsatilmaydi —
//  hech bo'lmasa bo'sh joy bilan ajratilgan holda chiqadi.
// =====================================================================

type T = (key: string) => string;

/** Tarjima bormi? `t()` topolmasa kalitning o'zini qaytaradi. */
function tryT(t: T, key: string): string | null {
  const v = t(key);
  return v === key ? null : v;
}

/** `base_salary` → "Asosiy oylik". Topilmasa "base salary". */
export function fieldLabel(t: T, key: string): string {
  return tryT(t, `field.${key}`)
    ?? tryT(t, `pl.${key}`)
    ?? key.replace(/_id$/, '').replace(/_/g, ' ');
}

/** Oylik qatori tafsiloti uchun nom. */
export function payrollLabel(t: T, key: string): string {
  return tryT(t, `pl.${key}`)
    ?? tryT(t, `field.${key}`)
    ?? key.replace(/_/g, ' ');
}

//  Qaysi maydonning QIYMATI ham kod ekani va uni qayerdan
//  tarjima qilish kerakligi.
const VALUE_PREFIX: Record<string, string> = {
  type: 'pf.row.',            // percent | fixed
  mode: 'pf.rounding.',       // nearest | up | down
  base_type: 'payroll.baseType.',
  channel: 'pay.channel.',
  payment_method: 'exp.method.',
  reason: 'unheld.',          // holiday | quarantine | teacher_absent
  kind: 'inv.kind.',
  action: 'audit.action.',
  relation: 'parents.relation.',
};

/**
 *  Qiymatning o'zi kod bo'lsa — tarjima qiladi.
 *  Tarjima topilmasa xom qiymat qaytadi: noto'g'ri tarjimadan ko'ra
 *  xom qiymat yaxshi, chunki u hech bo'lmasa haqiqatni ko'rsatadi.
 */
export function valueLabel(t: T, key: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const prefix = VALUE_PREFIX[key];
  if (!prefix) return null;
  return tryT(t, prefix + value);
}
