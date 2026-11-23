// =====================================================================
//  i18n — TZ 5.4.19:
//  "Interfeysda matn qatorlari kodga yozilmaydi. Barcha matnlar i18n
//   mexanizmi orqali kalit bo'yicha chaqiriladi. Bu qoida BIRINCHI
//   KOMPONENTDAN amal qiladi."
//
//  Yengil mexanizm — tashqi kutubxonasiz. Sabab: bizga faqat kalit →
//  matn va o'rin egallar kerak; ko'plik shakllari va murakkab
//  formatlash uchun `Intl` yetarli (lib/format.ts).
//
//  TZ 5.6.5 — yangi til qo'shish uchun kodga o'zgartirish kerak emas:
//  yangi JSON fayl qo'shiladi va LANGS ro'yxatiga yoziladi.
//
//  Dev rejimida topilmagan kalit konsolga ogohlantirish beradi —
//  shunda tarjimasiz matn ishga tushirishgacha yetib bormaydi (TZ 8.11).
// =====================================================================

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Lang } from '@/lib/format';
import uz from './uz.json';
import uzCyrl from './uz-cyrl.json';
import ru from './ru.json';

type Dict = Record<string, string>;

const BUNDLES: Record<Lang, Dict> = {
  'uz': uz as Dict,
  'uz-cyrl': uzCyrl as Dict,
  'ru': ru as Dict,
};

export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'uz', label: "O'zbekcha" },
  { code: 'uz-cyrl', label: 'Ўзбекча' },
  { code: 'ru', label: 'Русский' },
];

const STORAGE_KEY = 'maktab-lang';

// ---------------------------------------------------------------------
//  ATAMALAR VARIANTI — Uztomic Edu bitta panelda bog'cha, maktab va
//  o'quv markaziga xizmat qiladi. Bog'chada "o'quvchi" emas "bola",
//  "o'qituvchi" emas "tarbiyachi" deyiladi. 1600+ kalitni uch marta
//  takrorlamaslik uchun atamalar ko'rsatishdan oldin almashtiriladi.
//  Ruschada kelishiklar bor, shuning uchun so'z shakllari to'liq
//  sanab chiqilgan (uzunlari avval).
// ---------------------------------------------------------------------

export type TermVariant = 'default' | 'kindergarten';

const A = "['ʻ‘’`]";
const KG_RULES: Record<Lang, Array<[RegExp, string]>> = {
  'uz': [
    [new RegExp(`O${A}qituvchi`, 'g'), 'Tarbiyachi'],
    [new RegExp(`o${A}qituvchi`, 'g'), 'tarbiyachi'],
    [new RegExp(`O${A}quvchi`, 'g'), 'Bola'],
    [new RegExp(`o${A}quvchi`, 'g'), 'bola'],
  ],
  'uz-cyrl': [
    [/Ўқитувчи/g, 'Тарбиячи'], [/ўқитувчи/g, 'тарбиячи'],
    [/Ўқувчи/g, 'Бола'], [/ўқувчи/g, 'бола'],
  ],
  'ru': [
    [/Преподавател/g, 'Воспитател'], [/преподавател/g, 'воспитател'],
    [/Учител/g, 'Воспитател'], [/учител/g, 'воспитател'],
    [/Учеников/g, 'Детей'], [/учеников/g, 'детей'],
    [/Ученикам/g, 'Детям'], [/ученикам/g, 'детям'],
    [/Учениками/g, 'Детьми'], [/учениками/g, 'детьми'],
    [/Учениках/g, 'Детях'], [/учениках/g, 'детях'],
    [/Ученики/g, 'Дети'], [/ученики/g, 'дети'],
    [/Ученика/g, 'Ребёнка'], [/ученика/g, 'ребёнка'],
    [/Ученику/g, 'Ребёнку'], [/ученику/g, 'ребёнку'],
    [/Учеником/g, 'Ребёнком'], [/учеником/g, 'ребёнком'],
    [/Ученике/g, 'Ребёнке'], [/ученике/g, 'ребёнке'],
    [/Ученик/g, 'Ребёнок'], [/ученик/g, 'ребёнок'],
  ],
};

function applyVariant(lang: Lang, variant: TermVariant, text: string): string {
  if (variant !== 'kindergarten') return text;
  let out = text;
  for (const [re, to] of KG_RULES[lang] ?? []) out = out.replace(re, to);
  return out;
}

/** Kalitni matnga aylantiradi va {o'rin} egallarni to'ldiradi. */
function lookup(lang: Lang, key: string, params?: Record<string, unknown>): string {
  let text = BUNDLES[lang]?.[key];

  if (text === undefined) {
    // Standart tilga qaytamiz — matn yo'qolib ketmasin.
    text = BUNDLES.uz?.[key];
    if (import.meta.env.DEV && text === undefined) {
      console.warn(`[i18n] tarjima yo'q: "${key}" (${lang})`);
    }
  }

  if (text === undefined) return key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  variant: TermVariant;
  setVariant: (v: TermVariant) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readStoredLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in BUNDLES) return saved as Lang;
  } catch {
    // Maxfiy oynada localStorage yopiq bo'lishi mumkin — muhim emas.
  }
  return 'uz';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStoredLang);
  const [variant, setVariant] = useState<TermVariant>('default');

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch { /* muhim emas */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'ru' ? 'ru' : 'uz';
  }, [lang]);

  const value = useMemo<I18nValue>(() => ({
    lang,
    setLang,
    variant,
    setVariant,
    t: (key, params) => applyVariant(lang, variant, lookup(lang, key, params)),
  }), [lang, setLang, variant]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n faqat I18nProvider ichida ishlaydi');
  return ctx;
}

/** Qisqa yozuv: const t = useT(); t('nav.students') */
export function useT() {
  return useI18n().t;
}
