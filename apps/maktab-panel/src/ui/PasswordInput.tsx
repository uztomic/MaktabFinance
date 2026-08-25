// =====================================================================
//  Parol maydoni — ko'rsatish/yashirish tugmasi bilan.
//
//  NEGA KERAK: parollar 12 belgidan uzun va tasodifiy (harf + raqam
//  aralash). Telefonda ularni ko'r-ko'rona terish xatoga olib keladi
//  va foydalanuvchi "parol noto'g'ri" degan xabarni oladi, aslida
//  bitta harfni adashtirgan bo'ladi.
//
//  Standart holat — YASHIRIN. Ko'rsatish ataylab qilinadigan amal:
//  yonida odam turgan bo'lishi mumkin.
// =====================================================================

import { type InputHTMLAttributes, useState } from 'react';
import { useT } from '@/i18n';
import { Input } from './index';

export function PasswordInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>,
) {
  const t = useT();
  const [shown, setShown] = useState(false);

  return (
    <span className="relative block">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        className={`pr-11 ${props.className ?? ''}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        // Tugma tab tartibiga tushmasin: Enter bosilganda forma
        // yuborilishi kerak, parol ko'rinishi emas.
        tabIndex={-1}
        aria-label={shown ? t('auth.hidePassword') : t('auth.showPassword')}
        title={shown ? t('auth.hidePassword') : t('auth.showPassword')}
        className="absolute right-0 top-0 flex h-9 w-10 items-center
          justify-center text-[var(--text-faint)] hover:text-[var(--text)]"
      >
        {shown
          ? (
            // Ko'z — chizilgan (yashirish)
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.75"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
              <path d="M16.7 16.7A9.5 9.5 0 0 1 12 18c-5 0-9-6-9-6a17 17 0 0 1 4.1-4.8" />
              <path d="M9.9 5.2A9.5 9.5 0 0 1 12 5c5 0 9 6 9 6a17 17 0 0 1-2.3 3" />
              <path d="M3 3l18 18" />
            </svg>
          )
          : (
            // Ko'z — ochiq (ko'rsatish)
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.75"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
          )}
      </button>
    </span>
  );
}
