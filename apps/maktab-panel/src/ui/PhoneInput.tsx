// =====================================================================
//  O'zbekiston telefon raqami maydoni.
//
//  MUAMMO: raqam oddiy matn maydoniga kiritilardi va har kim o'zicha
//  yozardi — "998901234567", "+998 90 123 45 67", "901234567",
//  "90-123-45-67". Bazada esa format BITTA bo'lishi shart
//  (`998XXXXXXXXX`), chunki:
//
//    · Telegram bot ota-onani AYNAN shu raqam bo'yicha topadi
//      (`linkParentByPhone`) — bitta bo'sh joy bo'lsa topilmaydi;
//    · navbatchi va o'qituvchi telefon bilan tizimga kiradi, raqam
//      sintetik pochtaga aylanadi (`phoneToEmail`).
//
//  YECHIM: `+998` maydonning O'ZIDA turadi va yozilmaydi. Odam faqat
//  9 ta raqam kiritadi, ular o'qish uchun ajratib ko'rsatiladi:
//  `90 123 45 67`. Bazaga esa har doim `998901234567` ketadi.
//
//  Nusxa ko'chirib qo'yilgan raqam ham tushunilaadi: `+998`, `998`,
//  `8` yoki bo'sh joylar bo'lsa ular olib tashlanadi.
// =====================================================================

import {
  type ChangeEvent, type InputHTMLAttributes, useLayoutEffect, useRef,
} from 'react';
import { useT } from '@/i18n';
import { Input } from './index';

/** Faqat raqamlar, `998` prefiksisiz — ya'ni 9 ta belgi. */
function toLocal(raw: string): string {
  let d = (raw ?? '').replace(/\D/g, '');

  //  Mamlakat kodi turli ko'rinishda kelishi mumkin.
  if (d.startsWith('998')) d = d.slice(3);
  //  Ichki format: "8 90 ..." — eski odat.
  else if (d.length === 10 && d.startsWith('8')) d = d.slice(1);

  return d.slice(0, 9);
}

/** `901234567` → `90 123 45 67` */
function pretty(local: string): string {
  const p = [
    local.slice(0, 2),
    local.slice(2, 5),
    local.slice(5, 7),
    local.slice(7, 9),
  ].filter(Boolean);
  return p.join(' ');
}

/**
 *  Bazaga yoziladigan shakl.
 *
 *  DIQQAT: bu yerda "to'liq bo'lmasa bo'sh qaytar" degan mantiq
 *  BO'LMASLIGI kerak. Avval shunday yozilgan edi va maydonga umuman
 *  yozib bo'lmasdi: birinchi raqam kiritilishi bilan qiymat bo'shga
 *  aylanardi, maydon tozalanardi va keyingi raqam ham xuddi shunday
 *  yo'qolardi. Faqat to'liq raqamni NUSXA qilib qo'yish ishlardi.
 *
 *  Yarim raqam ham qaytadi; to'liqligini `isCompletePhone` va
 *  maydonning `pattern` i tekshiradi.
 */
export function toStored(local: string): string {
  return local ? `998${local}` : '';
}

/** Raqam to'liq kiritilganmi (998 + 9 ta raqam). */
export function isCompletePhone(stored: string | null | undefined): boolean {
  return toLocal(stored ?? '').length === 9;
}

/** Ko'rsatish uchun: `998901234567` → `+998 90 123 45 67` */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const local = toLocal(raw);
  return local ? `+998 ${pretty(local)}` : String(raw);
}

export function PhoneInput({
  value, onChange, required, disabled, ...rest
}: {
  /** Saqlangan shakl: `998901234567` yoki bo'sh. */
  value: string;
  onChange: (stored: string) => void;
  required?: boolean;
  disabled?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'required' | 'disabled'>) {
  const t = useT();
  const local = toLocal(value);

  //  Kursorni joyida ushlab turish.
  //
  //  Maydon har bosishda qayta formatlanadi ("90 123" → "90 123 4"),
  //  ya'ni React qiymatni almashtiradi va brauzer kursorni oxiriga
  //  tashlaydi. Oxiriga yozayotgan odam buni sezmaydi, lekin o'rtadagi
  //  raqamni tuzatmoqchi bo'lgan odam har bosishda oxiriga uchib
  //  ketadi. `MoneyInput` da bu allaqachon shunday yechilgan.
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    const pos = el.selectionStart ?? el.value.length;
    //  Kursordan oldingi RAQAMLAR soni — ajratgichlar siljiganda ham
    //  shu son o'zgarmaydi.
    const digitsBefore = (el.value.slice(0, pos).match(/d/g) ?? []).length;

    const next = toLocal(el.value);
    const shown = pretty(next);

    let i = 0;
    let seen = 0;
    while (i < shown.length && seen < digitsBefore) {
      if (/d/.test(shown[i])) seen++;
      i++;
    }
    caret.current = i;

    onChange(toStored(next));
  }

  return (
    <span className="relative block">
      <span
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2
          text-[13px] text-[var(--text-muted)]"
        aria-hidden="true"
      >
        +998
      </span>
      <Input
        {...rest}
        ref={ref}
        value={pretty(local)}
        onChange={handleChange}
        inputMode="numeric"
        autoComplete="tel"
        placeholder="90 123 45 67"
        //  Yarim raqam bilan formani yuborib bo'lmaydi: naqsh aynan
        //  "90 123 45 67" shaklini talab qiladi. Bo'sh maydon esa
        //  `required` bilan to'siladi.
        required={required}
        disabled={disabled}
        pattern="\d{2} \d{3} \d{2} \d{2}"
        title={t('phone.hint')}
        className={`pl-[3.4rem] ${rest.className ?? ''}`}
      />
    </span>
  );
}
