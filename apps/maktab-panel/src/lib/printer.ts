// =====================================================================
//  BLUETOOTH CHEK PRINTERI (ESC/POS)
//
//  Kvitansiya hozirgacha brauzerning chop etish oynasi orqali
//  chiqardi. Kassada esa A4 printer turmaydi — u yerda 58 mm lik
//  termal printer bo'ladi va u Bluetooth orqali ulanadi.
//
//  QAYERDA ISHLAYDI: Chrome/Edge — Android va Windows/macOS/Linux.
//  Safari va iPhone da Web Bluetooth UMUMAN yo'q va yaqin orada
//  paydo bo'lishi kutilmaydi. Shuning uchun tugma faqat qo'llab-
//  quvvatlanadigan brauzerda ko'rsatiladi, qolganlarida esa
//  brauzer orqali chop etish qoladi.
//
//  Protokol Uztomic loyihasidagi ishlaydigan Flutter amalidan
//  olindi (`lib/core/hardware/`) — u haqiqiy B21 da sinovdan
//  o'tgan.
// =====================================================================

/** Chop etish rejimi. */
export type PrintMode = 'text' | 'image' | 'aiyin';

export interface PrinterSettings {
  mode: PrintMode;
  /** Nuqtadagi kenglik: 58 mm → 384, 80 mm → 576. */
  width: number;
  /** Shrift kattaligi (rasm rejimida). */
  scale: 'sm' | 'md' | 'lg';
}

export const DEFAULT_SETTINGS: PrinterSettings = {
  mode: 'aiyin',
  width: 384,
  scale: 'md',
};

// ---------------------------------------------------------------------
//  GATT kanallari
//
//  Arzon printerlarda yagona standart yo'q — har ishlab chiqaruvchi
//  o'z xizmatini qo'yadi. Shuning uchun hammasi so'raladi va
//  ulangandan keyin yozish mumkin bo'lgani qidiriladi.
// ---------------------------------------------------------------------

const SERVICES = [
  '0000ff00-0000-1000-8000-00805f9b34fb', // umumiy arzon printerlar
  '000018f0-0000-1000-8000-00805f9b34fb', // ESC/POS (Goojprt, Xprinter)
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / BM70
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // NIIMBOT
];

/**
 *  Javobsiz yozuvda bir bo'lakning o'lchami.
 *
 *  MTU 517 bo'lsa ham shuncha yuborib bo'lmaydi. BLE moduli baytlarni
 *  efir tezligida qabul qiladi, printerga esa ularni sekin UART orqali
 *  uzatadi (odatda 115200 bod ≈ 11 KB/s). Javobsiz yozuvda oqim
 *  nazorati yo'q: katta rasm yuborilsa modul buferi to'lib toshadi va
 *  ma'lumotning yarmi yo'qoladi — printer esa hech qanday xato
 *  bermaydi, shunchaki chala bosadi yoki umuman bosmaydi.
 */
const CHUNK = 180;
const GAP_MS = 15;

/** Brauzer Web Bluetooth ni qo'llab-quvvatlaydimi. */
export function bluetoothSupported(): boolean {
  return typeof navigator !== 'undefined'
    // deno-lint-ignore no-explicit-any
    && !!(navigator as any).bluetooth;
}

// deno-lint-ignore no-explicit-any
type Char = any;

/** Ulangan printer. */
export interface Printer {
  name: string;
  write: (bytes: number[]) => Promise<void>;
  disconnect: () => void;
}

/**
 *  Printerni tanlash va ulash.
 *
 *  `acceptAllDevices` — chunki printerlar reklama paketida o'z
 *  xizmatini e'lon qilmasligi mumkin va filtr bilan ular ro'yxatda
 *  umuman ko'rinmaydi.
 */
export async function connectPrinter(): Promise<Printer> {
  // deno-lint-ignore no-explicit-any
  const bt = (navigator as any).bluetooth;
  if (!bt) throw new Error('Web Bluetooth qo’llab-quvvatlanmaydi');

  const device = await bt.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICES,
  });

  const server = await device.gatt.connect();

  //  Yozish mumkin bo'lgan birinchi xarakteristika qidiriladi.
  let target: Char | null = null;
  for (const svc of SERVICES) {
    try {
      const service = await server.getPrimaryService(svc);
      const chars = await service.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          target = c;
          break;
        }
      }
      if (target) break;
    } catch {
      //  Bu xizmat printerda yo'q — keyingisiga o'tamiz.
    }
  }

  if (!target) {
    server.disconnect();
    throw new Error('Printerda yozish kanali topilmadi');
  }

  const withoutResponse = target.properties.writeWithoutResponse
    && !target.properties.write;

  return {
    name: device.name ?? 'Printer',
    disconnect: () => server.disconnect(),
    write: async (bytes: number[]) => {
      const buf = Uint8Array.from(bytes);
      for (let i = 0; i < buf.length; i += CHUNK) {
        const part = buf.slice(i, i + CHUNK);
        if (withoutResponse) {
          await target.writeValueWithoutResponse(part);
          await new Promise((r) => setTimeout(r, GAP_MS));
        } else {
          await target.writeValueWithResponse(part);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------
//  Tasvir
// ---------------------------------------------------------------------

export interface Bitmap {
  width: number;
  height: number;
  /** Har qator uchun paketlangan baytlar (1 bit = 1 nuqta). */
  rows: Uint8Array[];
}

/**
 *  Canvas dan bir bitli tasvir yasaydi.
 *
 *  Termal printer faqat qora va oq biladi — kulrang tuslar yo'q.
 *  Shuning uchun oddiy chegara qo'yiladi: yorug'lik 0.5 dan past
 *  bo'lsa nuqta bosiladi.
 */
export function canvasToBitmap(canvas: HTMLCanvasElement): Bitmap {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas ochilmadi');

  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const rows: Uint8Array[] = [];

  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(bytesPerRow);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      //  Shaffof joy — oq. Aks holda butun chek qora chiqadi.
      const a = data[i + 3];
      const lum = a === 0
        ? 255
        : (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
      if (lum < 128) row[x >> 3] |= 0x80 >> (x & 7);
    }
    rows.push(row);
  }

  return { width, height, rows };
}

// ---------------------------------------------------------------------
//  Buyruqlar
// ---------------------------------------------------------------------

const ESC_INIT = [0x1B, 0x40];
const feed = (n: number) => [0x1B, 0x64, Math.max(0, Math.min(255, n))];

/**
 *  ESC/POS raster (`GS v 0`).
 *
 *  Rasm tasmalarga bo'linadi: arzon printerlarning buferi kichik va
 *  butun chek bitta blok bo'lib yuborilsa sig'maydi.
 */
const BAND = 64;

export function buildEscPosJob(bmp: Bitmap, feedLines = 4): number[] {
  const bpr = Math.ceil(bmp.width / 8);
  const out: number[] = [...ESC_INIT];

  for (let top = 0; top < bmp.height; top += BAND) {
    const rows = Math.min(BAND, bmp.height - top);
    out.push(
      0x1D, 0x76, 0x30, 0x00,
      bpr & 0xFF, (bpr >> 8) & 0xFF,
      rows & 0xFF, (rows >> 8) & 0xFF,
    );
    for (let y = top; y < top + rows; y++) out.push(...bmp.rows[y]);
  }

  if (feedLines > 0) out.push(...feed(feedLines));
  return out;
}

/**
 *  AiYin (LuckPrinter) — B21 va shu oiladagilar.
 *
 *  Printer tasvirni oddiy `GS v 0` bilan qabul qiladi, LEKIN undan
 *  oldin o'zining boshqaruv buyruqlari kelishi shart. Aynan
 *  `10 FF FE 01` yetishmagani uchun printer baytlarni qabul qilib,
 *  hech narsa bosmasdan tashlab yuboradi.
 */
export function buildAiyinJob(bmp: Bitmap, density = 3, feedDots = 60): number[] {
  const bpr = Math.ceil(bmp.width / 8);
  const out: number[] = [
    0x10, 0xFF, 0x10, 0x00, Math.max(1, Math.min(5, density)), // zichlik
    0x10, 0xFF, 0x84, 0x01,                                    // uzluksiz rulon
    ...new Array(12).fill(0),                                  // uyg'otish
    0x10, 0xFF, 0xFE, 0x01,                                    // ruxsat
    0x1D, 0x76, 0x30, 0x00,
    bpr & 0xFF, (bpr >> 8) & 0xFF,
    bmp.height & 0xFF, (bmp.height >> 8) & 0xFF,
  ];

  for (let y = 0; y < bmp.height; y++) out.push(...bmp.rows[y]);

  //  Rulonda `1D 0C` (sahifani chiqarish) zarar qiladi — printer
  //  "sahifa" uzunligicha bo'sh qog'oz chiqaradi. Uning o'rniga
  //  qirqish tishigacha suriladi.
  if (feedDots > 0) out.push(0x1B, 0x4A, Math.min(255, feedDots));
  out.push(0x10, 0xFF, 0xFE, 0x45); // tugatish

  return out;
}

/**
 *  Matn rejimi — shrifti bor printerlar uchun.
 *
 *  O'zbek lotin apostroflari (`o'`, `g'`) ESC/POS kod sahifalarida
 *  buziladi, shuning uchun ular oddiy harfga almashtiriladi. Kirill
 *  esa umuman chiqmaydi — bunday matn uchun rasm rejimi kerak.
 */
export function buildTextJob(lines: string[], feedLines = 4): number[] {
  const out: number[] = [...ESC_INIT];
  const enc = new TextEncoder();

  for (const line of lines) {
    const safe = line
      .replace(/[‘’ʻʼ']/g, '')
      .replace(/[^\x20-\x7E]/g, '?');
    out.push(...enc.encode(safe), 0x0A);
  }

  if (feedLines > 0) out.push(...feed(feedLines));
  return out;
}

// ---------------------------------------------------------------------
//  Sozlamalar — qurilmada saqlanadi
//
//  Printer maktabning emas, SHU QURILMANING xossasi: kassada bitta
//  printer, direktorning noutbukida boshqasi yoki umuman yo'q.
//  Shuning uchun bazaga emas, brauzerga yoziladi.
// ---------------------------------------------------------------------

const KEY = 'maktab-printer';

export function loadSettings(): PrinterSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: PrinterSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    //  Shaxsiy oynada saqlash bloklangan bo'lishi mumkin — sozlama
    //  shu seans uchun ishlaydi, bu yetarli.
  }
}
