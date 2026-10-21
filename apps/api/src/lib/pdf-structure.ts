import {
  HANDBOOK_OUTLINE_MAX_DEPTH,
  HANDBOOK_OUTLINE_MAX_ITEMS,
  type HandbookOutlineItem,
} from '@orghive/shared';
import { extractText, getDocumentProxy } from 'unpdf';

/** What the handbook's contents and search are built from. */
export interface PdfStructure {
  /** The bookmarks, resolved to 1-based pages; null when the PDF has none. */
  outline: HandbookOutlineItem[] | null;
  /** One entry per page (up to `maxPages`), whitespace collapsed. */
  pageTexts: string[];
}

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
interface RawOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineItem[];
}

/** The 1-based page a bookmark opens, or null when it points nowhere we can follow. */
async function pageOf(doc: PdfDocument, dest: RawOutlineItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const target = Array.isArray(explicit) ? (explicit[0] as unknown) : null;
    if (typeof target === 'number') return target + 1;
    if (target && typeof target === 'object' && 'num' in target) {
      return (await doc.getPageIndex(target as Parameters<PdfDocument['getPageIndex']>[0])) + 1;
    }
  } catch {
    // A broken or external link: the entry is left out.
  }
  return null;
}

/**
 * Bookmarks a reader can use: resolved to a page within the document, titled, at most
 * HANDBOOK_OUTLINE_MAX_DEPTH deep and HANDBOOK_OUTLINE_MAX_ITEMS in all. An entry whose own
 * link is broken still keeps its children, lifted up a level.
 */
async function resolveOutline(
  doc: PdfDocument,
  raw: RawOutlineItem[],
  depth: number,
  budget: { left: number },
): Promise<HandbookOutlineItem[]> {
  const items: HandbookOutlineItem[] = [];
  for (const entry of raw) {
    if (budget.left <= 0) break;
    const children =
      depth < HANDBOOK_OUTLINE_MAX_DEPTH
        ? await resolveOutline(doc, entry.items ?? [], depth + 1, budget)
        : [];
    const page = await pageOf(doc, entry.dest);
    const title = entry.title.replace(/\s+/g, ' ').trim();
    if (page !== null && page <= doc.numPages && title) {
      budget.left -= 1;
      items.push({ title, page, items: children });
    } else {
      items.push(...children);
    }
  }
  return items;
}

/**
 * Reads a PDF's bookmarks and the text of each page (the Student Handbook's contents and
 * search). Throws like pdf.js on damaged or encrypted files.
 */
export async function pdfStructure(pdf: Uint8Array, maxPages: number): Promise<PdfStructure> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const raw = ((await doc.getOutline()) ?? []) as RawOutlineItem[];
  const outline = await resolveOutline(doc, raw, 1, { left: HANDBOOK_OUTLINE_MAX_ITEMS });
  const { text } = await extractText(doc, { mergePages: false });
  return {
    outline: outline.length > 0 ? outline : null,
    pageTexts: text.slice(0, maxPages).map((page) => page.replace(/\s+/g, ' ').trim()),
  };
}
