import { createRequire } from 'node:module';
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import sharp from 'sharp';
import { getDocumentProxy, renderPageAsImage } from 'unpdf';

/** Stamped across every page image; non-owners never get the file without it. */
export const WATERMARK_TEXT = 'NwSSU Orghive · View only';
/** Reading resolution: an A4 page at about 150 DPI, sharp on phones and laptops. */
export const PAGE_WIDTH = 1240;
/** Card previews: shown at most ~360px wide, so 2x for sharp screens. */
const THUMBNAIL_WIDTH = 720;
/** The handbook's contents thumbnails: shown about 100px wide, so 2x. */
const PAGE_THUMBNAIL_WIDTH = 220;
const PAGE_QUALITY = 80;

const FONT_FAMILY = 'OrghiveWatermark';
const require = createRequire(import.meta.url);
// Bundled, so the watermark renders the same on a server with no system fonts.
GlobalFonts.registerFromPath(
  require.resolve('@fontsource/poppins/files/poppins-latin-600-normal.woff2'),
  FONT_FAMILY,
);

export interface RenderedPage {
  webp: Buffer;
  width: number;
  height: number;
}

/**
 * The watermark: the text tiled diagonally over the whole page, dark with a light edge so it
 * shows on light and dark content alike, faint enough to read the page through it.
 */
function drawWatermark(ctx: SKRSContext2D, width: number, height: number) {
  const fontSize = Math.max(14, Math.round(width / 32));
  ctx.save();
  ctx.font = `600 ${fontSize}px ${FONT_FAMILY}`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(15, 76, 42, 0.17)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.lineWidth = Math.max(1, fontSize / 24);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const step = ctx.measureText(WATERMARK_TEXT).width + fontSize * 3;
  const rowGap = fontSize * 5;
  const reach = Math.hypot(width, height) / 2 + step;
  for (let row = 0, y = -reach; y <= reach; row++, y += rowGap) {
    // Every other row is offset, so the text never lines up in clean columns to crop around.
    for (let x = -reach - (row % 2) * (step / 2); x <= reach; x += step) {
      ctx.strokeText(WATERMARK_TEXT, x, y);
      ctx.fillText(WATERMARK_TEXT, x, y);
    }
  }
  ctx.restore();
}

/** Any raster image (PNG, JPEG, WebP) on white, watermarked, as WebP. */
export async function stampWatermark(image: Buffer): Promise<RenderedPage> {
  const img = await loadImage(image);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  drawWatermark(ctx, img.width, img.height);
  return {
    webp: await canvas.encode('webp', PAGE_QUALITY),
    width: img.width,
    height: img.height,
  };
}

/**
 * Renders the first `maxPages` pages of a PDF, one at a time (only one page is in memory),
 * each watermarked, and hands each to `onPage`. Throws on damaged or encrypted PDFs.
 */
export async function renderPdfPages(
  pdf: Uint8Array,
  maxPages: number,
  onPage: (page: RenderedPage, pageNumber: number) => Promise<void>,
): Promise<{ totalPages: number }> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const last = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= last; n++) {
    const png = await renderPageAsImage(doc, n, {
      canvasImport: () => import('@napi-rs/canvas'),
      width: PAGE_WIDTH,
    });
    await onPage(await stampWatermark(Buffer.from(png)), n);
  }
  return { totalPages: doc.numPages };
}

/** A JPG or PNG upload as its one watermarked page, upright, at most PAGE_WIDTH wide. */
export async function renderImagePage(body: Uint8Array): Promise<RenderedPage> {
  const png = await sharp(Buffer.from(body))
    .rotate() // honour EXIF orientation
    .resize({ width: PAGE_WIDTH, withoutEnlargement: true })
    .png()
    .toBuffer();
  return stampWatermark(png);
}

export { pdfStructure } from './pdf-structure';

/** A page thumbnail for the handbook's contents, from the already-watermarked page. */
export function pageThumbnailOf(page: Buffer): Promise<Buffer> {
  return sharp(page)
    .resize({ width: PAGE_THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer();
}

/** The card preview, from the already-watermarked first page. */
export function thumbnailOf(page: Buffer): Promise<Buffer> {
  return sharp(page)
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}
