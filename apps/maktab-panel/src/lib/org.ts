// =====================================================================
//  Tashkilot turi — Uztomic Edu bitta tizimda uch xil muassasaga xizmat
//  qiladi:
//    school           — xususiy maktab: sinflar, o'quv yili, shartnoma
//    learning_center  — o'quv markazi: kurs, guruh, jadval, voronka
//    kindergarten     — bog'cha: yosh guruhlari, kunlik davomat, oylik
//
//  Bog'cha guruh dvigatelidan foydalanadi (guruh = yosh guruhi,
//  o'qituvchi = tarbiyachi, darslar = ish kunlari), shuning uchun
//  moliya, davomat va tarbiyachi haqi o'quv markazi bilan bir xil
//  ishonchli kod orqali o'tadi.
// =====================================================================

export type OrgType = 'school' | 'learning_center' | 'kindergarten';

export const ORG_TYPES: readonly OrgType[] = ['school', 'learning_center', 'kindergarten'] as const;

export function asOrgType(v: unknown): OrgType {
  return v === 'learning_center' || v === 'kindergarten' ? v : 'school';
}

/** Guruhlarga asoslangan tur (o'quv markazi yoki bog'cha). */
export function usesGroups(t: string | null | undefined): boolean {
  return t === 'learning_center' || t === 'kindergarten';
}
