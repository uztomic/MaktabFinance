#!/usr/bin/env node
// =====================================================================
//  make-icons.mjs — logotip SVG dan PWA ikonkalarini yasaydi.
//
//  SVG manba: apps/maktab-panel/public/
//  Ikonka o'lchamlari brauzer va Android talablariga muvofiq.
//
//  Logotip o'zgarsa faqat SVG ni yangilab, shu skriptni qayta
//  ishga tushirish kifoya.
// =====================================================================

import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'apps', 'maktab-panel', 'public');

/** SVG ni berilgan kenglikda PNG ga aylantiradi. */
async function render(svgFile, outFile, width, background) {
  const svg = await readFile(join(PUB, svgFile), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    ...(background ? { background } : {}),
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  await writeFile(join(PUB, outFile), png);
  console.log(`  ✓ ${outFile.padEnd(24)} ${width}×${width}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('\nIkonkalar yasalmoqda...\n');

// Brauzer yorlig'i va ilova ikonkasi — oq fon bilan (shaffof fon
// ba'zi platformalarda qora chiqadi).
await render('logo-mark.svg', 'icon-192.png', 192, '#ffffff');
await render('logo-mark.svg', 'icon-512.png', 512, '#ffffff');
await render('logo-mark.svg', 'apple-touch-icon.png', 180, '#ffffff');
await render('logo-mark.svg', 'favicon-32.png', 32, '#ffffff');

// Android maskable — to'q ko'k fon, belgi markazda.
await render('icon-maskable.svg', 'icon-maskable-512.png', 512);

console.log('\nTayyor.\n');
