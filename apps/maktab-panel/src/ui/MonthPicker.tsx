// =====================================================================
//  Oy tanlagich — "‹ Noyabr 2026 ›".
//
//  Qarzdorlik va bosh sahifa savoli doim bitta: "shu OY qanday?".
//  Sana oralig'i tanlash buxgalter uchun ortiqcha qadam edi. Endi
//  strelka bilan oldingi/keyingi oy, nomini bossa — yil bo'yicha
//  12 oylik jadval: istalgan oyga bir bosishda o'tiladi.
// =====================================================================

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n';
import { currentPeriod, periodLabel, shiftPeriod } from '@/lib/format';

/** Oyning oxirgi kuni: "2026-11-01" → "2026-11-30". */
export function periodEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

export function MonthPicker({
  value, onChange, max = currentPeriod(),
}: {
  /** Davr kaliti — oyning 1-sanasi, "2026-11-01". */
  value: string;
  onChange: (period: string) => void;
  /** Kelajakdagi oylar yopiq (standart — joriy oy). */
  max?: string;
}) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setYear(Number(value.slice(0, 4))); }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const next = shiftPeriod(value, 1);
  const canNext = next <= max;
  const monthName = (m: number) =>
    periodLabel(`${year}-${String(m + 1).padStart(2, '0')}-01`, lang).split(' ')[0];

  const arrow = 'flex h-10 w-9 items-center justify-center text-[var(--text-muted)] ' +
    'hover:text-[var(--text)] disabled:opacity-30 disabled:hover:text-[var(--text-muted)]';

  return (
    <div ref={box} className="relative">
      <div className="flex items-center rounded-[10px] border bg-[var(--bg)]">
        <button type="button" className={arrow} aria-label="‹"
                onClick={() => onChange(shiftPeriod(value, -1))}>
          <Chevron dir="left" />
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="h-10 min-w-[132px] px-1 text-center text-sm font-medium"
        >
          {periodLabel(value, lang)}
        </button>
        <button type="button" className={arrow} aria-label="›" disabled={!canNext}
                onClick={() => canNext && onChange(next)}>
          <Chevron dir="right" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border bg-[var(--bg)] p-3
          shadow-[var(--shadow-pop)]">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className={arrow} onClick={() => setYear((y) => y - 1)}>
              <Chevron dir="left" />
            </button>
            <span className="num text-sm font-semibold">{year}</span>
            <button type="button" className={arrow}
                    disabled={`${year + 1}-01-01` > max}
                    onClick={() => setYear((y) => y + 1)}>
              <Chevron dir="right" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 12 }, (_, m) => {
              const p = `${year}-${String(m + 1).padStart(2, '0')}-01`;
              const active = p === value;
              const disabled = p > max;
              return (
                <button
                  key={m}
                  type="button"
                  disabled={disabled}
                  onClick={() => { onChange(p); setOpen(false); }}
                  className={`h-9 rounded-lg text-[13px] transition-colors ${
                    active
                      ? 'bg-[var(--primary)] font-medium text-[var(--on-primary)]'
                      : 'hover:bg-[var(--bg-inset)] disabled:opacity-30 disabled:hover:bg-transparent'
                  }`}
                >
                  {monthName(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}
