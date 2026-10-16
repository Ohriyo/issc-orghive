// Renders apps/web/public/og-default.png (1200 x 630) from brand tokens and the
// WaveDivider / HexFrame geometry, using Playwright: node apps/web/scripts/render-og-image.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..').replaceAll(path.sep, '/');
const require = createRequire(`${ROOT}/package.json`);
const { chromium } = require('@playwright/test');
const font = (w) =>
  pathToFileURL(`${ROOT}/node_modules/@fontsource/poppins/files/poppins-latin-${w}-normal.woff2`).href;

const html = `<!doctype html><html><head><style>
@font-face { font-family: Poppins; font-weight: 400; src: url(${font(400)}); }
@font-face { font-family: Poppins; font-weight: 700; src: url(${font(700)}); }
html, body { margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; position: relative; font-family: Poppins;
  background: linear-gradient(100deg, #f9f9f9 0%, #f9f9f9 35%, #d8d8d8 100%); color: #095d40; }
.wave { position: absolute; left: 0; width: 1200px; }
.hex { position: absolute; left: 92px; top: 150px; width: 380px; filter: drop-shadow(0 14px 22px rgb(0 0 0 / .22)); }
.text { position: absolute; left: 540px; top: 196px; width: 600px; }
h1 { margin: 0; font-size: 104px; line-height: 1; letter-spacing: -0.035em; font-weight: 700; }
p { margin: 18px 0 0; font-size: 31px; line-height: 1.35; }
</style></head><body>
<svg class="wave" style="top:-118px" viewBox="0 0 1366 300">
  <path fill="#809562" d="M495 37C640 15 800 35 950 90C1080 135 1200 135 1366 85V112C1250 165 1110 182 985 165C880 150 800 132 740 115C650 88 570 55 495 37Z"/>
  <path fill="#095d40" d="M0 100C150 60 280 40 420 45C600 50 760 120 980 180C1150 225 1280 215 1366 180V198C1270 250 1120 275 950 255C760 232 600 170 420 160C260 152 120 190 0 265Z"/>
  <path fill="#429644" d="M0 292C140 235 330 200 550 195C360 225 200 262 0 300Z"/>
</svg>
<svg class="wave" style="top:520px; transform: rotate(180deg)" viewBox="0 0 1366 300">
  <path fill="#809562" d="M495 37C640 15 800 35 950 90C1080 135 1200 135 1366 85V112C1250 165 1110 182 985 165C880 150 800 132 740 115C650 88 570 55 495 37Z"/>
  <path fill="#095d40" d="M0 100C150 60 280 40 420 45C600 50 760 120 980 180C1150 225 1280 215 1366 180V198C1270 250 1120 275 950 255C760 232 600 170 420 160C260 152 120 190 0 265Z"/>
  <path fill="#429644" d="M0 292C140 235 330 200 550 195C360 225 200 262 0 300Z"/>
</svg>
<svg class="hex" viewBox="0 0 100 86.6">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f5d3a"/><stop offset="1" stop-color="#2a5536"/></linearGradient>
    <radialGradient id="sheen" cx=".22" cy=".18" r="1"><stop offset="0" stop-color="#3f6a4a"/><stop offset=".6" stop-color="#1d5330"/><stop offset="1" stop-color="#0c4a27"/></radialGradient>
  </defs>
  <polygon fill="url(#band)" points="25,0 75,0 100,43.3 75,86.6 25,86.6 0,43.3"/>
  <polygon fill="#fff" points="27.5,4 72.5,4 95.5,43.3 72.5,82.6 27.5,82.6 4.5,43.3"/>
  <polygon fill="url(#sheen)" points="28.8,6 71.2,6 93.2,43.3 71.2,80.6 28.8,80.6 6.8,43.3"/>
  <g fill="none" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M38 24h17l8 8v31H38z"/><path d="M55 24v8h8"/><path d="M43 42h15M43 49h15M43 56h10"/>
  </g>
</svg>
<div class="text"><h1>Orghive</h1><p>Paperworks of NwSSU&rsquo;s student organizations: ISSC, CSCs and SBOs.</p></div>
</body></html>`;

mkdirSync(`${ROOT}/public`, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
/* global document -- runs in the browser page */
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: `${ROOT}/public/og-default.png` });
await browser.close();
console.log('wrote og-default.png');
