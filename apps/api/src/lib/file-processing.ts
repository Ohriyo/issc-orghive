import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { extractText, getDocumentProxy } from 'unpdf';

/** Search text is capped: the first pages carry what people search for. */
const MAX_TEXT = 200_000;

/** Content-based type check: the MIME type the bytes actually are, from their magic numbers. */
export async function detectMimeType(body: Uint8Array): Promise<string | undefined> {
  return (await fileTypeFromBuffer(body))?.mime;
}

export function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

/** All text of a PDF, whitespace collapsed and capped. Empty for scanned (image-only) PDFs. */
export async function pdfText(body: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}
