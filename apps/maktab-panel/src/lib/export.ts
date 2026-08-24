// =====================================================================
//  Excel eksporti (TZ 4.12.5).
//
//  Nega CSV: Excel CSV ni to'g'ridan-to'g'ri ochadi, kutubxona kerak
//  emas va fayl yengil. Shart — ikkita tafsilot:
//
//    · UTF-8 BOM — busiz Excel kirill va o'zbek harflarini buzadi
//    · nuqtali vergul ajratgich — Excel ning ru/uz sozlamasida
//      vergul o'nlik belgisi hisoblanadi, shuning uchun ustunlar
//      aralashib ketadi
//
//  TZ 4.12.7 — sarlavhalar tanlangan tilda shakllantiriladi,
//  shuning uchun ustun nomlari chaqiruvchi tomonidan beriladi.
// =====================================================================

export interface Column<T> {
  /** Ustun sarlavhasi — allaqachon tarjima qilingan matn. */
  header: string;
  /** Qator qiymati. */
  value: (row: T) => string | number | null | undefined;
  /** Raqam ustunimi — Excel uni son sifatida o'qishi uchun. */
  numeric?: boolean;
}

/** CSV katakchasini xavfsiz shaklga keltiradi. */
function cell(raw: string | number | null | undefined, numeric = false): string {
  if (raw === null || raw === undefined) return '';

  if (numeric) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return '';
    // Excel ning ru/uz sozlamasi o'nlik belgi sifatida VERGULNI kutadi.
    return String(n).replace('.', ',');
  }

  const s = String(raw);
  // Ajratgich, qo'shtirnoq yoki satr ko'chirish bo'lsa qo'shtirnoqqa olamiz.
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Jadvalni CSV ga aylantirib brauzerdan yuklab beradi.
 *
 * @param filename  kengaytmasiz nom — sana o'zi qo'shiladi
 */
export function exportTable<T>(
  filename: string,
  columns: Array<Column<T>>,
  rows: T[],
  /** Ixtiyoriy sarlavha satrlari (davr, filial va h.k.). */
  meta: string[] = [],
): void {
  const lines: string[] = [];

  for (const m of meta) lines.push(cell(m));
  if (meta.length) lines.push('');

  lines.push(columns.map((c) => cell(c.header)).join(';'));

  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row), c.numeric)).join(';'));
  }

  // BOM — busiz Excel kirillni buzadi.
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// =====================================================================
//  CSV o'qish — bank vypiskasi uchun (TZ 4.7.2.1)
// =====================================================================

/** Ajratgichni fayl mazmunidan topadi: ; yoki , yoki tab. */
function detectDelimiter(sample: string): string {
  const counts = [';', ',', '\t'].map((d) => ({
    d,
    n: (sample.match(new RegExp(`\\${d}`, 'g')) ?? []).length,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ';';
}

/** Bitta CSV satrini katakchalarga ajratadi (qo'shtirnoqni hisobga olib). */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * CSV matnini sarlavha va qatorlarga ajratadi.
 * Bo'sh satrlar tashlab yuboriladi.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };

  const delim = detectDelimiter(lines[0] + '\n' + (lines[1] ?? ''));
  const headers = splitLine(lines[0], delim);
  const rows = lines.slice(1).map((l) => splitLine(l, delim));

  return { headers, rows };
}

/**
 * Turli formatdagi sanani ISO ga keltiradi.
 * Bank vypiskalarida ko'p uchraydigan shakllar qo'llab-quvvatlanadi:
 * 22.08.2026 · 2026-08-22 · 22/08/2026 · 22-08-2026
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // kun.oy.yil (nuqta, slash yoki chiziqcha)
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Summani songa aylantiradi.
 * "1 450 000,00" · "1,450,000.00" · "1450000" — hammasi ishlaydi.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s ]/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');

  if (lastComma > lastDot) {
    // Vergul o'nlik belgisi: 1.450.000,00
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    // Nuqta o'nlik belgisi: 1,450,000.00
    s = s.replace(/,/g, '');
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
