// =====================================================================
//  KVITANSIYANI TASVIRGA AYLANTIRISH
//
//  NEGA MATN EMAS, RASM: o'zbek lotin harflari (`o'`, `g'`) va kirill
//  ESC/POS kod sahifalarida buziladi yoki umuman chiqmaydi. Arzon
//  printerlarning ko'pchiligida shrift jadvali yo'q — ular matn
//  baytlarini jimgina tashlab yuboradi va qog'oz bo'sh chiqadi.
//
//  Tasvir sifatida esa hamma narsa ekrandagidek bosiladi.
// =====================================================================

import { date, type Lang, money } from '@/lib/format';

export interface ReceiptPrintData {
  school_name: string;
  branch_name?: string | null;
  receipt_code: string;
  paid_on: string;
  student_name: string;
  student_class?: string | null;
  payment_code?: string | null;
  method_name?: string | null;
  amount: number | string;
  balance?: number | string | null;
  cashier?: string | null;
}

export interface ReceiptLabels {
  title: string;
  date: string;
  from: string;
  klass: string;
  code: string;
  method: string;
  received: string;
  balanceAfter: string;
  advance: string;
  cashier: string;
  thanks: string;
}

const SCALE = { sm: 0.85, md: 1, lg: 1.2 } as const;

/**
 *  Kvitansiyani canvas ga chizadi.
 *
 *  Balandlik oldindan noma'lum — avval qatorlar ro'yxati yig'iladi,
 *  keyin canvas o'sha balandlikda yaratiladi. Aks holda uzun ismli
 *  o'quvchining kvitansiyasi kesilib qolardi.
 */
export function renderReceipt(
  d: ReceiptPrintData,
  labels: ReceiptLabels,
  lang: Lang,
  width = 384,
  scale: keyof typeof SCALE = 'md',
): HTMLCanvasElement {
  const k = SCALE[scale];
  const pad = Math.round(8 * k);
  const base = Math.round(20 * k);   // oddiy matn
  const small = Math.round(17 * k);
  const big = Math.round(30 * k);

  //  O'lchash uchun vaqtinchalik kontekst.
  const probe = document.createElement('canvas').getContext('2d')!;
  const font = (px: number, bold = false) =>
    `${bold ? 'bold ' : ''}${px}px ui-sans-serif, system-ui, Arial, sans-serif`;

  type Item =
    | { t: 'center'; text: string; px: number; bold?: boolean }
    | { t: 'pair'; left: string; right: string; px: number; bold?: boolean }
    | { t: 'rule' }
    | { t: 'gap'; h: number };

  const items: Item[] = [];

  items.push({ t: 'center', text: d.school_name, px: base, bold: true });
  if (d.branch_name) items.push({ t: 'center', text: d.branch_name, px: small });
  items.push({ t: 'gap', h: Math.round(4 * k) });
  items.push({ t: 'center', text: labels.title, px: small });
  items.push({ t: 'center', text: d.receipt_code, px: big, bold: true });
  items.push({ t: 'rule' });

  items.push({ t: 'pair', left: labels.date, right: date(d.paid_on, lang), px: base });
  items.push({ t: 'pair', left: labels.from, right: d.student_name, px: base });
  if (d.student_class) {
    items.push({ t: 'pair', left: labels.klass, right: d.student_class, px: base });
  }
  if (d.payment_code) {
    items.push({ t: 'pair', left: labels.code, right: d.payment_code, px: base });
  }
  if (d.method_name) {
    items.push({ t: 'pair', left: labels.method, right: d.method_name, px: base });
  }
  items.push({ t: 'rule' });

  items.push({
    t: 'pair', left: labels.received, right: money(d.amount, lang),
    px: big, bold: true,
  });

  if (d.balance !== null && d.balance !== undefined) {
    const b = Number(d.balance);
    items.push({
      t: 'pair',
      left: labels.balanceAfter,
      right: b < 0 ? `${labels.advance} ${money(-b, lang)}` : money(b, lang),
      px: small,
    });
  }

  items.push({ t: 'rule' });
  if (d.cashier) {
    items.push({ t: 'pair', left: labels.cashier, right: d.cashier, px: small });
  }
  items.push({ t: 'gap', h: Math.round(6 * k) });
  items.push({ t: 'center', text: labels.thanks, px: small });

  //  Uzun matnni ikkiga bo'lish uchun o'lchaymiz.
  const inner = width - pad * 2;
  function fits(text: string, px: number, bold = false) {
    probe.font = font(px, bold);
    return probe.measureText(text).width;
  }

  //  Balandlikni hisoblaymiz.
  let h = pad;
  for (const it of items) {
    if (it.t === 'gap') h += it.h;
    else if (it.t === 'rule') h += Math.round(10 * k);
    else if (it.t === 'center') h += Math.round(it.px * 1.35);
    else {
      //  Juftlik bitta qatorga sig'masa, o'ng tomoni pastga tushadi.
      const w = fits(it.left, it.px) + fits(it.right, it.px, it.bold) + 12;
      h += w > inner ? Math.round(it.px * 1.35) * 2 : Math.round(it.px * 1.35);
    }
  }
  h += pad;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, h);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = pad;
  for (const it of items) {
    if (it.t === 'gap') { y += it.h; continue; }

    if (it.t === 'rule') {
      const ry = y + Math.round(4 * k);
      ctx.fillRect(pad, ry, inner, Math.max(1, Math.round(k)));
      y += Math.round(10 * k);
      continue;
    }

    if (it.t === 'center') {
      ctx.font = font(it.px, it.bold);
      const w = ctx.measureText(it.text).width;
      ctx.fillText(it.text, Math.max(pad, (width - w) / 2), y);
      y += Math.round(it.px * 1.35);
      continue;
    }

    ctx.font = font(it.px);
    const lw = ctx.measureText(it.left).width;
    ctx.font = font(it.px, it.bold);
    const rw = ctx.measureText(it.right).width;

    if (lw + rw + 12 > inner) {
      //  Sig'masa: chapi tepada, o'ngi pastda va o'ngga tekislangan.
      ctx.font = font(it.px);
      ctx.fillText(it.left, pad, y);
      y += Math.round(it.px * 1.35);
      ctx.font = font(it.px, it.bold);
      ctx.fillText(it.right, width - pad - rw, y);
      y += Math.round(it.px * 1.35);
    } else {
      ctx.font = font(it.px);
      ctx.fillText(it.left, pad, y);
      ctx.font = font(it.px, it.bold);
      ctx.fillText(it.right, width - pad - rw, y);
      y += Math.round(it.px * 1.35);
    }
  }

  return canvas;
}

/** Matn rejimi uchun qatorlar — shrifti bor printerlarda. */
export function receiptLines(
  d: ReceiptPrintData,
  labels: ReceiptLabels,
  lang: Lang,
  cols = 32,
): string[] {
  const pair = (l: string, r: string) => {
    const space = Math.max(1, cols - l.length - r.length);
    return l + ' '.repeat(space) + r;
  };
  const center = (s: string) => {
    const left = Math.max(0, Math.floor((cols - s.length) / 2));
    return ' '.repeat(left) + s;
  };
  const rule = '-'.repeat(cols);

  const out = [center(d.school_name)];
  if (d.branch_name) out.push(center(d.branch_name));
  out.push(center(labels.title), center(d.receipt_code), rule);
  out.push(pair(labels.date, date(d.paid_on, lang)));
  out.push(pair(labels.from, d.student_name));
  if (d.student_class) out.push(pair(labels.klass, d.student_class));
  if (d.payment_code) out.push(pair(labels.code, d.payment_code));
  if (d.method_name) out.push(pair(labels.method, d.method_name));
  out.push(rule);
  out.push(pair(labels.received, money(d.amount, lang)));
  if (d.balance !== null && d.balance !== undefined) {
    const b = Number(d.balance);
    out.push(pair(labels.balanceAfter,
      b < 0 ? `${labels.advance} ${money(-b, lang)}` : money(b, lang)));
  }
  out.push(rule);
  if (d.cashier) out.push(pair(labels.cashier, d.cashier));
  out.push('', center(labels.thanks));
  return out;
}
