// Turns a round seal photographed or scanned on a light background (JPG/PNG) into the seed
// logo format: 512 x 512 WebP, cropped to the seal's circle, transparent outside it.
//   node apps/web/scripts/prepare-seal.mjs <input image> <output .webp>
// e.g. node apps/web/scripts/prepare-seal.mjs con-seal.jpg apps/api/prisma/seed/assets/logos/csc-con.webp
// Then `pnpm --filter api db:seed` uploads it and sets the organization's logo.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [input, output, sizeArg = '512'] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node apps/web/scripts/prepare-seal.mjs <input image> <output .webp> [size]');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('@playwright/test');

const type = input.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
const source = `data:${type};base64,${readFileSync(input).toString('base64')}`;

const browser = await chromium.launch();
const page = await browser.newPage();
/* global document, Image */
const result = await page.evaluate(
  async ({ source, size }) => {
    const img = new Image();
    img.src = source;
    await img.decode();
    const scan = document.createElement('canvas');
    scan.width = img.naturalWidth;
    scan.height = img.naturalHeight;
    const sctx = scan.getContext('2d');
    sctx.drawImage(img, 0, 0);
    const { data, width, height } = sctx.getImageData(0, 0, scan.width, scan.height);

    // "Ink" is anything clearly darker or more colourful than the paper. A row or column
    // needs a few ink pixels to count, so JPEG speckle near the edges is ignored.
    const isInk = (i) => {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      return Math.min(r, g, b) < 200 || Math.max(r, g, b) - Math.min(r, g, b) > 40;
    };
    const rows = new Array(height).fill(0);
    const cols = new Array(width).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (isInk((y * width + x) * 4)) {
          rows[y]++;
          cols[x]++;
        }
      }
    }
    const first = (arr) => arr.findIndex((n) => n > 3);
    const last = (arr) => arr.length - 1 - [...arr].reverse().findIndex((n) => n > 3);
    const top = first(rows), bottom = last(rows), left = first(cols), right = last(cols);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const radius = Math.max(right - left, bottom - top) / 2;

    const out = document.createElement('canvas');
    out.width = out.height = size;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.beginPath();
    // Half a pixel inside the ring, so no paper-white fringe survives the anti-aliasing.
    ctx.arc(size / 2, size / 2, size / 2 - 0.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2, 0, 0, size, size);
    return {
      webp: out.toDataURL('image/webp', 0.92),
      crop: { left, top, right, bottom, radius: Math.round(radius) },
    };
  },
  { source, size: Number(sizeArg) },
);
await browser.close();

writeFileSync(output, Buffer.from(result.webp.split(',')[1], 'base64'));
console.log(`wrote ${output}`, result.crop);
