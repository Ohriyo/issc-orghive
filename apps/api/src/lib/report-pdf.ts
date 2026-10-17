import { PDFDocument, StandardFonts, rgb, type PDFPage } from 'pdf-lib';

/** A4 in PDF points. */
const A4 = { width: 595.28, height: 841.89 };
/** White space around an image placed on its own page. */
const IMAGE_MARGIN = 36;

/** Turns HTML into PDF bytes. Chromium in production; tests may pass a fake. */
export interface HtmlToPdf {
  render(html: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

/**
 * Headless Chromium (playwright-core) for the report's own pages. Offline: every request is
 * refused, since the template embeds its fonts and draws its marks. One browser per report.
 */
export async function createChromiumRenderer(executablePath?: string): Promise<HtmlToPdf> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath && { executablePath }),
  });
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  return {
    async render(html) {
      await page.setContent(html, { waitUntil: 'load' });
      return page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    },
    close: () => browser.close(),
  };
}

/** A submitted file, read and checked once, ready to merge. */
export type LoadedSource =
  | { kind: 'pdf'; doc: PDFDocument; pages: number }
  | { kind: 'image'; bytes: Uint8Array; format: 'jpg' | 'png' }
  /** Damaged, encrypted, or not what it claims: replaced by a "could not be included" page. */
  | { kind: 'unreadable' };

export async function loadSource(bytes: Uint8Array, mimeType: string): Promise<LoadedSource> {
  try {
    if (mimeType === 'application/pdf') {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      const pages = doc.getPageCount();
      return pages > 0 ? { kind: 'pdf', doc, pages } : { kind: 'unreadable' };
    }
    if (mimeType === 'image/jpeg' || mimeType === 'image/png') {
      const format = mimeType === 'image/jpeg' ? 'jpg' : 'png';
      // Parse it now, so a damaged image becomes a placeholder instead of failing the merge.
      const probe = await PDFDocument.create();
      await (format === 'jpg' ? probe.embedJpg(bytes) : probe.embedPng(bytes));
      return { kind: 'image', bytes, format };
    }
  } catch {
    // Falls through: an encrypted or damaged PDF.
  }
  return { kind: 'unreadable' };
}

/** How many pages a loaded source becomes (images and unreadable files: one). */
export function pagesOfSource(source: LoadedSource): number {
  return source.kind === 'pdf' ? source.pages : 1;
}

/** What goes where in the final PDF, in order. */
export type AssemblyStep =
  /** A page of the rendered template, by its index there. */
  | { kind: 'generated'; page: number }
  | { kind: 'source'; source: Exclude<LoadedSource, { kind: 'unreadable' }> };

async function addImagePage(out: PDFDocument, image: { bytes: Uint8Array; format: 'jpg' | 'png' }) {
  const embedded =
    image.format === 'jpg' ? await out.embedJpg(image.bytes) : await out.embedPng(image.bytes);
  const page = out.addPage([A4.width, A4.height]);
  const box = { width: A4.width - 2 * IMAGE_MARGIN, height: A4.height - 2 * IMAGE_MARGIN };
  const scale = Math.min(box.width / embedded.width, box.height / embedded.height, 1);
  const width = embedded.width * scale;
  const height = embedded.height * scale;
  page.drawImage(embedded, {
    x: (A4.width - width) / 2,
    y: (A4.height - height) / 2,
    width,
    height,
  });
}

/**
 * Merges the rendered template pages and the submitted files in the given order with pdf-lib,
 * then numbers every page after the cover ("Page n of N", bottom centre). Files keep their
 * own page size; images get an A4 page each, scaled to fit.
 */
export async function assembleReport(
  generated: Uint8Array,
  steps: readonly AssemblyStep[],
  meta: { title: string; author: string; now: Date },
  onStep?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; pages: number }> {
  const out = await PDFDocument.create();
  const template = await PDFDocument.load(generated);
  const templatePages = await out.copyPages(template, template.getPageIndices());

  for (const [i, step] of steps.entries()) {
    if (step.kind === 'generated') {
      const page = templatePages[step.page];
      if (!page) throw new Error(`The template has no page ${step.page}`);
      out.addPage(page);
    } else if (step.source.kind === 'pdf') {
      const copied = await out.copyPages(step.source.doc, step.source.doc.getPageIndices());
      for (const page of copied) out.addPage(page);
    } else {
      await addImagePage(out, step.source);
    }
    onStep?.(i + 1, steps.length);
  }

  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  pages.forEach((page: PDFPage, i) => {
    if (i === 0) return;
    const text = `Page ${i + 1} of ${pages.length}`;
    const size = 8;
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, size);
    // A white label behind the number keeps it readable on the template's green band and
    // on dark scans alike.
    page.drawRectangle({
      x: (width - textWidth) / 2 - 6,
      y: 10,
      width: textWidth + 12,
      height: 14,
      color: rgb(1, 1, 1),
      opacity: 0.9,
    });
    page.drawText(text, {
      x: (width - textWidth) / 2,
      y: 14,
      size,
      font,
      color: rgb(0.29, 0.35, 0.31),
    });
  });

  out.setTitle(meta.title);
  out.setAuthor(meta.author);
  out.setCreator('Orghive');
  out.setProducer('Orghive');
  out.setCreationDate(meta.now);
  return { bytes: await out.save(), pages: pages.length };
}
