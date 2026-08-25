// =====================================================================
//  Sana oralig'i — barcha moliyaviy ekran uchun bitta boshqaruv.
//
//  MUAMMO: hisobotlarda oraliq bor edi, lekin boshqaruv paneli, sinflar
//  va sinf kartochkasi FAQAT OY bo'yicha ishlardi. Ya'ni "1-sentabrdan
//  15-dekabrgacha qancha yig'ildi" degan savolga javob berib bo'lmasdi —
//  to'rtta oyni alohida qarab, qo'lda qo'shish kerak edi.
//
//  TZ 4.12.1 — "Kunlik, haftalik, oylik va yillik kesimlar ALOHIDA
//  FUNKSIYA EMAS, balki sana filtri natijasidir." Demak bitta boshqaruv
//  hamma joyda ishlashi kerak.
//
//  TANLOV SAQLANADI: buxgalter oraliqni bir marta qo'yadi va sahifadan
//  sahifaga o'tganda u saqlanib qoladi. Har safar qaytadan tanlash —
//  kunlik ishda eng zerikarli narsa.
// =====================================================================

import { useCallback, useEffect, useState } from 'react';
import { useI18n, useT } from '@/i18n';
import { date, isoDate } from '@/lib/format';
import { Button, Input } from './index';

export interface Range {
  from: string;
  to: string;
  /** Qaysi tayyor oraliq tanlangan. `custom` — qo'lda kiritilgan. */
  preset: PresetId;
}

export type PresetId =
  | 'month' | 'prevMonth' | 'quarter' | 'halfYear'
  | 'year' | 'academicYear' | 'all' | 'custom';

const KEY = 'maktab-date-range';

/** O'quv yili boshlanish oyi — sozlamada 9 (sentabr). */
const ACADEMIC_START_MONTH = 8; // 0-asosli: 8 = sentabr

function build(preset: PresetId, now = new Date()): Range {
  const y = now.getFullYear();
  const m = now.getMonth();
  const mk = (a: Date, b: Date): Range =>
    ({ from: isoDate(a), to: isoDate(b), preset });

  switch (preset) {
    case 'month':
      return mk(new Date(y, m, 1), new Date(y, m + 1, 0));
    case 'prevMonth':
      return mk(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'quarter':
      return mk(new Date(y, m - 2, 1), new Date(y, m + 1, 0));
    case 'halfYear':
      return mk(new Date(y, m - 5, 1), new Date(y, m + 1, 0));
    case 'year':
      return mk(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'academicYear': {
      // Sentabrgacha — o'tgan yil sentabridan boshlanadi.
      const startYear = m >= ACADEMIC_START_MONTH ? y : y - 1;
      return mk(new Date(startYear, ACADEMIC_START_MONTH, 1),
                new Date(startYear + 1, ACADEMIC_START_MONTH, 0));
    }
    case 'all':
      // Maktab ochilganidan beri. Aniq sana kerak emas — yetarlicha
      // uzoq oraliq bir xil natija beradi.
      return mk(new Date(y - 10, 0, 1), new Date(y, m + 1, 0));
    default:
      return mk(new Date(y, m, 1), new Date(y, m + 1, 0));
  }
}

/** Saqlangan tanlovni o'qiydi. Buzuq bo'lsa standart holatga qaytadi. */
function load(): Range {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return build('month');
    const v = JSON.parse(raw) as Range;
    if (!v?.from || !v?.to) return build('month');
    // Tayyor oraliq bo'lsa QAYTA hisoblanadi: kecha saqlangan "shu oy"
    // bugun boshqa oy bo'lishi mumkin.
    if (v.preset && v.preset !== 'custom') return build(v.preset);
    return v;
  } catch {
    return build('month');
  }
}

export function useDateRange() {
  const [range, setRange] = useState<Range>(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(range)); } catch { /* ignore */ }
  }, [range]);

  const setPreset = useCallback((p: PresetId) => setRange(build(p)), []);

  const setCustom = useCallback((from: string, to: string) => {
    setRange({ from, to, preset: 'custom' });
  }, []);

  return { range, setPreset, setCustom };
}

const PRESETS: Array<{ id: PresetId; key: string }> = [
  { id: 'month', key: 'range.month' },
  { id: 'prevMonth', key: 'range.prevMonth' },
  { id: 'quarter', key: 'range.quarter' },
  { id: 'halfYear', key: 'range.halfYear' },
  { id: 'academicYear', key: 'range.academicYear' },
  { id: 'year', key: 'range.year' },
  { id: 'all', key: 'range.all' },
];

export function DateRangePicker({
  range, onPreset, onCustom, compact = false,
}: {
  range: Range;
  onPreset: (p: PresetId) => void;
  onCustom: (from: string, to: string) => void;
  /** Faqat tugmalar — sana maydonlari yashirin, "Qo'lda" bilan ochiladi. */
  compact?: boolean;
}) {
  const t = useT();
  const { lang } = useI18n();
  const [open, setOpen] = useState(!compact);

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
      active
        ? 'border-[var(--sel-border)] bg-[var(--sel-bg)] text-[var(--sel-text)]'
        : 'text-[var(--text-muted)] hover:bg-[var(--bg-inset)]'
    }`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => { onPreset(p.id); if (compact) setOpen(false); }}
            className={chip(range.preset === p.id)}
          >
            {t(p.key)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={chip(range.preset === 'custom')}
        >
          {t('range.custom')}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--text-muted)]">
              {t('common.from')}
            </span>
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => onCustom(e.target.value, range.to)}
              className="w-auto"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--text-muted)]">
              {t('common.to')}
            </span>
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => onCustom(range.from, e.target.value)}
              className="w-auto"
            />
          </label>
          {compact && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.close')}
            </Button>
          )}
        </div>
      )}

      {!open && (
        <p className="text-[12px] text-[var(--text-muted)]">
          {date(range.from, lang)} — {date(range.to, lang)}
        </p>
      )}
    </div>
  );
}

/** Sarlavha ostidagi qisqa yozuv: "1 sen 2025 — 25 avg 2026". */
export function rangeLabel(range: Range, lang: 'uz' | 'uz-cyrl' | 'ru') {
  return `${date(range.from, lang)} — ${date(range.to, lang)}`;
}
