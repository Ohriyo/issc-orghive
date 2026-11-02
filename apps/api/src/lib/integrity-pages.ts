import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';
import { readBarcodes } from 'zxing-wasm/reader';

/*
 * What the integrity checks read from a task file's pages (docs/PROJECT_WORKFLOW_SPEC.md,
 * section 6). Pages are rendered here without the view-only watermark, in memory only:
 * these images are never stored or served.
 */

/** 150 dpi: QR codes read reliably from it (tested down to 100), and OCR is accurate. */
const RENDER_DPI = 150;
/** OCR is slow (seconds a page); the keywords and totals are on the first pages. */
export const MAX_OCR_PAGES = 4;
/** A digital PDF with at least this much text is read from its text layer, not by OCR. */
const TEXT_LAYER_MIN_CHARS = 200;
/** Share of dark pixels under which a page counts as blank. */
export const BLANK_INK_RATIO = 0.003;

export interface AnalyzedPage {
  /** Every QR code's text on the page. */
  qrTexts: string[];
  /** Share of dark pixels (0 to 1). */
  ink: number;
  /** 64-bit difference hash of the page without its letterhead, as a signed bigint. */
  hash: bigint;
  /** The rendered page (PNG), for OCR. */
  png: Buffer;
}

export interface PdfAnalysis {
  totalPages: number;
  pages: AnalyzedPage[];
  /** The PDF's own text (empty for a scan). */
  textLayer: string;
}

/** Share of pixels darker than mid-grey, on a small greyscale copy. */
export async function inkRatio(png: Buffer): Promise<number> {
  const { data } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize({ width: 300 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (const value of data) if (value < 160) dark += 1;
  return dark / data.length;
}

/**
 * The page's difference hash: 9×8 greyscale, one bit per neighbouring pair. The letterhead
 * (top 15%) and the footer (bottom 10%) are left out: every template shares them, so they
 * would make every file look alike.
 */
export async function pageHash(png: Buffer): Promise<bigint> {
  const image = sharp(png).flatten({ background: '#ffffff' });
  const { width = 0, height = 0 } = await image.metadata();
  const top = Math.round(height * 0.15);
  const body = Math.max(1, Math.round(height * 0.75));
  const { data } = await image
    .extract({ left: 0, top, width, height: Math.min(body, height - top) })
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col]!;
      const right = data[row * 9 + col + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return BigInt.asIntN(64, bits);
}

/** Every QR code on a page image. */
export async function readQrCodes(png: Buffer): Promise<string[]> {
  const found = await readBarcodes(new Uint8Array(png), {
    formats: ['QRCode'],
    tryHarder: true,
    maxNumberOfSymbols: 4,
  });
  return found.filter((r) => r.isValid).map((r) => r.text);
}

/**
 * Renders and reads the first `maxPages` pages of a PDF, one at a time. Throws on a damaged
 * or encrypted PDF (the format check turns that into a refusal).
 */
export async function analyzePdf(pdf: Uint8Array, maxPages: number): Promise<PdfAnalysis> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const pages: AnalyzedPage[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const { width } = (await doc.getPage(n)).getViewport({ scale: 1 });
    const png = Buffer.from(
      await renderPageAsImage(doc, n, {
        canvasImport: () => import('@napi-rs/canvas'),
        width: Math.round((width / 72) * RENDER_DPI),
      }),
    );
    const [qrTexts, ink, hash] = await Promise.all([
      readQrCodes(png),
      inkRatio(png),
      pageHash(png),
    ]);
    pages.push({ qrTexts, ink, hash, png });
  }
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), {
    mergePages: true,
  });
  return { totalPages: doc.numPages, pages, textLayer: text };
}

const require = createRequire(import.meta.url);

/**
 * tesseract.js reads every language from one folder; the English and Filipino models ship in
 * separate packages, so they are copied together once (nothing is downloaded at runtime).
 */
function languageFolder(): string {
  const folder = join(tmpdir(), 'orghive-tessdata');
  mkdirSync(folder, { recursive: true });
  for (const lang of ['eng', 'fil']) {
    const target = join(folder, `${lang}.traineddata.gz`);
    if (existsSync(target)) continue;
    const pkg = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    copyFileSync(join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`), target);
  }
  return folder;
}

export interface Ocr {
  recognize(png: Buffer): Promise<string>;
  terminate(): Promise<void>;
}

/** English and Filipino OCR; one Tesseract worker, started on first use and reused. */
export function createOcr(): Ocr {
  let worker: Promise<Worker> | null = null;
  const start = () =>
    (worker ??= createWorker(['eng', 'fil'], OEM.LSTM_ONLY, {
      langPath: languageFolder(),
      gzip: true,
      cacheMethod: 'none',
    }));
  return {
    async recognize(png) {
      const { data } = await (await start()).recognize(png);
      return data.text;
    },
    async terminate() {
      if (worker) await (await worker).terminate();
      worker = null;
    },
  };
}

/**
 * The file's text for the keyword and totals checks: its own text layer when it has one (a
 * PDF saved from Word), else OCR of its first pages (a scan).
 */
export async function textOf(analysis: PdfAnalysis, ocr: Pick<Ocr, 'recognize'>): Promise<string> {
  if (analysis.textLayer.replace(/\s+/g, '').length >= TEXT_LAYER_MIN_CHARS) {
    return analysis.textLayer;
  }
  const texts: string[] = [];
  for (const page of analysis.pages.slice(0, MAX_OCR_PAGES))
    texts.push(await ocr.recognize(page.png));
  return texts.join('\n');
}
