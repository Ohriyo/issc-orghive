#!/usr/bin/env node
// Orghive responsive check: screenshots routes at several widths and measures the rules
// from CLAUDE.md ("Responsive design rules"). Run from the repo root:
//
//   node .claude/skills/orghive-responsive/scripts/check-responsive.mjs \
//     --routes /,/colleges,/orgs/jpice --widths 360,768,1366,1920 --out <dir>
//
// Options:
//   --base   http://localhost:5173  (the running `pnpm dev` web server)
//   --routes comma-separated paths, leading slash optional (default: main public routes).
//            In Git Bash on Windows, prefix the command with MSYS_NO_PATHCONV=1.
//   --widths comma-separated widths from the matrix (default 360,768,1366,1920)
//   --out    output directory for screenshots and results.json (required)
//   --login  sign in first; the credentials come from ORGHIVE_EMAIL / ORGHIVE_PASSWORD
//   --no-fail  exit 0 even when a hard rule fails
//
// Hard rules (exit code 1): page-level horizontal scroll, a button/link with a hit area
// under 44x44px, a page error. Soft findings (reported only): text under 14px, clipped
// text, images upscaled past their source.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(join(REPO, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const MATRIX = {
  360: { h: 740, touch: true, dpr: 3 },
  390: { h: 844, touch: true, dpr: 3 },
  768: { h: 1024, touch: true, dpr: 2 },
  1024: { h: 768, touch: true, dpr: 2 },
  1366: { h: 768, touch: false, dpr: 1 },
  1920: { h: 1080, touch: false, dpr: 1 },
  2560: { h: 1440, touch: false, dpr: 1 },
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => {
    if (arg.startsWith('--'))
      acc.push([arg.slice(2), all[i + 1]?.startsWith('--') ? true : (all[i + 1] ?? true)]);
    return acc;
  }, []),
);
if (!args.out || args.out === true) {
  console.error('Missing --out <dir>. See the header of this file for usage.');
  process.exit(2);
}
const BASE = typeof args.base === 'string' ? args.base : 'http://localhost:5173';
const ROUTES = (
  typeof args.routes === 'string'
    ? args.routes
    : '/,/colleges,/colleges/cea,/colleges/cea/organizations,/orgs/jpice,/orgs/jpice/paperworks,/login'
)
  .split(',')
  .map((route) => {
    // Git Bash on Windows rewrites "/x" arguments into "C:/Program Files/Git/x".
    if (/^[A-Za-z]:[\\/]/.test(route)) {
      console.error(
        `Route "${route}" looks like a rewritten path. In Git Bash, prefix the command with MSYS_NO_PATHCONV=1, or pass routes without the leading slash (e.g. colleges/cea).`,
      );
      process.exit(2);
    }
    return `/${route.replace(/^\/+/, '')}`;
  });
const WIDTHS = (typeof args.widths === 'string' ? args.widths : '360,768,1366,1920')
  .split(',')
  .map(Number);
const OUT = resolve(args.out);
mkdirSync(join(OUT, 'shots'), { recursive: true });

for (const w of WIDTHS) {
  if (!MATRIX[w]) {
    console.error(`Width ${w} is not in the viewport matrix (${Object.keys(MATRIX).join(', ')}).`);
    process.exit(2);
  }
}

/** Runs in the page. */
function measure() {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
  };
  const name = (el) =>
    `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}"`;
  const clipsX = (el) =>
    ['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(el).overflowX);

  const overflow = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || (r.right <= vw + 1 && r.left >= -1)) continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement)
      if (clipsX(a)) {
        clipped = true;
        break;
      }
    if (!clipped) overflow.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }

  const smallText = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || !visible(el) || el.closest('.sr-only,[aria-hidden="true"]'))
      continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 14) smallText.add(`${size.toFixed(1)}px "${n.textContent.trim().slice(0, 30)}"`);
  }

  const clipped = [];
  for (const el of document.body.querySelectorAll('h1,h2,h3,p,span,a,button,label,li')) {
    if (!visible(el) || !el.textContent.trim()) continue;
    const s = getComputedStyle(el);
    const lineClamped = s.webkitLineClamp !== 'none' || s.textOverflow === 'ellipsis';
    if (!lineClamped && clipsX(el) && el.scrollWidth > el.clientWidth + 1) clipped.push(name(el));
  }

  const images = [];
  for (const img of document.querySelectorAll('img')) {
    if (!visible(img) || !img.complete || !img.naturalWidth || /\.svg(\?|$)/.test(img.currentSrc))
      continue;
    const r = img.getBoundingClientRect();
    // With srcset, naturalWidth is density-corrected; use the picked variant's width.
    const picked = Number(/-(\d+)\.webp(\?|$)/.exec(img.currentSrc)?.[1]) || img.naturalWidth;
    const upscale = (r.width * devicePixelRatio) / picked;
    if (upscale > 1.05)
      images.push(
        `${img.currentSrc.split('/').pop()} drawn ${Math.round(r.width)}px @${devicePixelRatio}x = ${upscale.toFixed(2)}x upscaled`,
      );
  }

  return {
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    pageHeight: document.documentElement.scrollHeight,
    overflow: overflow.slice(0, 6),
    smallText: [...smallText].slice(0, 6),
    clipped: clipped.slice(0, 6),
    images: images.slice(0, 6),
  };
}

/** Runs in the page: buttons/links whose hit area (probed, so ::after layers count) is under 44x44. */
async function smallTargets() {
  const small = [];
  for (const el of document.querySelectorAll('a[href], button, [role="button"]')) {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2 || s.visibility === 'hidden' || Number(s.opacity) === 0)
      continue;
    if (el.closest('[aria-hidden="true"],[inert],.sr-only')) continue;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((r) => requestAnimationFrame(r));
    const r = el.getBoundingClientRect();
    const hits = (x, y) => {
      const h = document.elementFromPoint(x, y);
      return !!h && (h === el || el.contains(h));
    };
    const cx = r.left + r.width / 2,
      cy = r.top + r.height / 2;
    if (!hits(cx, cy)) continue;
    let up = 0,
      down = 0,
      left = 0,
      right = 0;
    while (up < 44 && hits(cx, r.top - up - 1)) up++;
    while (down < 44 && hits(cx, r.bottom + down + 1)) down++;
    while (left < 44 && hits(r.left - left - 1, cy)) left++;
    while (right < 44 && hits(r.right + right + 1, cy)) right++;
    const w = r.width + left + right,
      h = r.height + up + down;
    if (w < 43.5 || h < 43.5)
      small.push(
        `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(w)}x${Math.round(h)}`,
      );
  }
  window.scrollTo(0, 0);
  return small;
}

async function settle(page) {
  // Wait for content, not network idle: the Vite dev server keeps a socket open.
  await page
    .locator('h1')
    .first()
    .waitFor({ state: 'attached', timeout: 20_000 })
    .catch(() => {});
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15_000 })
    .catch(() => {});
  // Scroll through once so every scroll reveal has run (they start blurred and transparent).
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.6)) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
}

async function signIn(page) {
  const email = process.env.ORGHIVE_EMAIL;
  const password = process.env.ORGHIVE_PASSWORD;
  if (!email || !password)
    throw new Error('--login needs ORGHIVE_EMAIL and ORGHIVE_PASSWORD in the environment.');
  await page.goto(`${BASE}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForTimeout(2500);
}

const browser = await chromium.launch();
const results = [];
let hardFailures = 0;
for (const width of WIDTHS) {
  const vp = MATRIX[width];
  const context = await browser.newContext({
    viewport: { width, height: vp.h },
    deviceScaleFactor: vp.dpr,
    hasTouch: vp.touch,
    isMobile: vp.touch && width < 1024,
  });
  const page = await context.newPage();
  if (args.login) await signIn(page);
  for (const route of ROUTES) {
    const errors = [];
    page.removeAllListeners('pageerror');
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    // Signed in, navigate client-side so the in-memory session survives.
    if (args.login) {
      await page.evaluate((r) => {
        history.pushState({}, '', r);
        dispatchEvent(new PopStateEvent('popstate'));
      }, route);
    } else {
      await page.goto(`${BASE}${route}`);
    }
    await settle(page);
    const file = `${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}-${width}`;
    await page.screenshot({ path: join(OUT, 'shots', `${file}.png`) });
    await page.screenshot({ path: join(OUT, 'shots', `${file}-full.png`), fullPage: true });
    const m = await page.evaluate(measure);
    const targets = await page.evaluate(smallTargets);
    const hScroll = m.scrollWidth > m.innerWidth;
    const fail = hScroll || targets.length > 0 || errors.length > 0;
    if (fail) hardFailures++;
    results.push({
      route,
      width,
      finalUrl: page.url().replace(BASE, ''),
      hScroll,
      ...m,
      smallTargets: targets,
      errors,
      screenshot: `shots/${file}.png`,
    });
    const flags = [
      hScroll && `OVERFLOW ${m.scrollWidth}px (${m.overflow[0] ?? '?'})`,
      targets.length && `TARGETS<44: ${targets.join(', ')}`,
      errors.length && `ERRORS: ${errors[0]}`,
      m.smallText.length && `small text: ${m.smallText.length}`,
      m.clipped.length && `clipped: ${m.clipped.length}`,
      m.images.length && `upscaled images: ${m.images.length}`,
    ].filter(Boolean);
    console.log(
      `${fail ? 'FAIL' : 'ok  '} ${String(width).padEnd(5)} ${route.padEnd(32)} ${flags.join(' | ')}`,
    );
  }
  await context.close();
}
await browser.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
console.log(
  `\n${results.length} checks, ${hardFailures} failing. Screenshots and results.json in ${OUT}`,
);
process.exit(hardFailures > 0 && !args['no-fail'] ? 1 : 0);
