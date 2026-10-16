import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { extractText, getDocumentProxy, renderPageAsImage } from 'unpdf';

/** Preview width in px; the browser shows it at most ~360px wide, so 2x for sharp screens. */
const THUMBNAIL_WIDTH = 720;
/** Search text is capped: the first pages carry what people search for. */
const MAX_TEXT = 200_000;

/** Content-based type check: the MIME type the bytes actually are, from their magic numbers. */
export async function detectMimeType(body: Uint8Array): Promise<string | undefined> {
  return (await fileTypeFromBuffer(body))?.mime;
}

export function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** Page 1 of a PDF as a WebP preview. Throws on damaged or encrypted PDFs. */
export async function pdfThumbnail(body: Uint8Array): Promise<Buffer> {
  const png = await renderPageAsImage(new Uint8Array(body), 1, {
    canvasImport: () => import('@napi-rs/canvas'),
    width: THUMBNAIL_WIDTH,
  });
  return sharp(Buffer.from(png)).webp({ quality: 78 }).toBuffer();
}

/** All text of a PDF, whitespace collapsed and capped. Empty for scanned (image-only) PDFs. */
export async function pdfText(body: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** A JPG or PNG upload's preview, at most THUMBNAIL_WIDTH wide. */
export function imageThumbnail(body: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(body))
    .rotate() // honour EXIF orientation
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}
