//  "Tez to'lov" oynasini istalgan joydan ochish — bitta hodisa orqali.
//  `preset` berilsa qidiruv o'tkazib yuboriladi va o'quvchi tayyor tanlanadi.
export interface QuickPayPreset {
  student_id: string;
  full_name: string;
  class_name: string | null;
  payment_code: string | null;
  balance: number;
}
const EVENT = 'maktab:quickpay';
export function openQuickPay(preset?: QuickPayPreset): void {
  window.dispatchEvent(new CustomEvent<QuickPayPreset | undefined>(EVENT, { detail: preset }));
}
export function onQuickPay(fn: (preset?: QuickPayPreset) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<QuickPayPreset | undefined>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
