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

import { type InputHTMLAttributes } from 'react';
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

/** Bazaga yoziladigan to'liq shakl. Raqam to'liq bo'lmasa bo'sh. */
export function toStored(local: string): string {
  return local.length === 9 ? `998${local}` : '';
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
  const local = toLocal(value);

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
        value={pretty(local)}
        onChange={(e) => onChange(toStored(toLocal(e.target.value)))}
        inputMode="numeric"
        autoComplete="tel"
        placeholder="90 123 45 67"
        //  Raqam to'liq bo'lmasa `toStored` bo'sh qaytaradi, ya'ni
        //  yarim raqam bazaga tushmaydi. Lekin `required` shundagina
        //  ishlashi uchun ko'rinadigan qiymat bo'yicha tekshiramiz.
        required={required}
        disabled={disabled}
        pattern={required ? '.{12,}' : undefined}
        title={required ? "To'qqizta raqam kiriting" : undefined}
        className={`pl-[3.4rem] ${rest.className ?? ''}`}
      />
    </span>
  );
}
