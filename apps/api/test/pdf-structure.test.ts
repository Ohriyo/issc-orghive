import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  type PDFRef,
  StandardFonts,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { pdfStructure } from '#src/lib/pdf-structure';

interface Bookmark {
  title: string;
  /** 0-based page index, or null for a bookmark that points nowhere. */
  page: number | null;
  children?: Bookmark[];
}

/** A PDF with `texts` as its pages and `bookmarks` as its outline (pdf-lib has no outline API). */
async function pdfWith(texts: string[], bookmarks: Bookmark[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = texts.map((text) => {
    const page = doc.addPage([400, 400]);
    page.drawText(text, { x: 40, y: 300, size: 14, font });
    return page;
  });

  if (bookmarks.length > 0) {
    const ctx = doc.context;
    const build = (items: Bookmark[], parent: PDFRef): PDFRef[] => {
      const refs = items.map(() => ctx.nextRef());
      items.forEach((item, i) => {
        const dict = PDFDict.withContext(ctx);
        dict.set(PDFName.of('Title'), PDFHexString.fromText(item.title));
        dict.set(PDFName.of('Parent'), parent);
        if (item.page !== null) {
          const dest = PDFArray.withContext(ctx);
          dest.push(pages[item.page]!.ref);
          dest.push(PDFName.of('XYZ'));
          dest.push(PDFNull);
          dest.push(PDFNull);
          dest.push(PDFNull);
          dict.set(PDFName.of('Dest'), dest);
        }
        if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]!);
        if (i < items.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]!);
        const children = item.children ?? [];
        if (children.length > 0) {
          const kids = build(children, refs[i]!);
          dict.set(PDFName.of('First'), kids[0]!);
          dict.set(PDFName.of('Last'), kids.at(-1)!);
          dict.set(PDFName.of('Count'), PDFNumber.of(children.length));
        }
        ctx.assign(refs[i]!, dict);
      });
      return refs;
    };
    const root = ctx.nextRef();
    const top = build(bookmarks, root);
    const outlines = PDFDict.withContext(ctx);
    outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
    outlines.set(PDFName.of('First'), top[0]!);
    outlines.set(PDFName.of('Last'), top.at(-1)!);
    outlines.set(PDFName.of('Count'), PDFNumber.of(bookmarks.length));
    ctx.assign(root, outlines);
    doc.catalog.set(PDFName.of('Outlines'), root);
  }
  return doc.save();
}

describe('pdfStructure', () => {
  it('resolves bookmarks to pages, nested, and reads each page text', async () => {
    const pdf = await pdfWith(
      ['Welcome to NwSSU', 'Code of conduct', 'Dress   code\nand uniforms'],
      [
        { title: 'Welcome', page: 0 },
        {
          title: '  Student   conduct ',
          page: 1,
          children: [{ title: 'Dress code', page: 2 }],
        },
      ],
    );
    expect(await pdfStructure(pdf, 500)).toEqual({
      outline: [
        { title: 'Welcome', page: 1, items: [] },
        { title: 'Student conduct', page: 2, items: [{ title: 'Dress code', page: 3, items: [] }] },
      ],
      pageTexts: ['Welcome to NwSSU', 'Code of conduct', 'Dress code and uniforms'],
    });
  });

  it('has no outline without bookmarks, and lifts children of a broken one', async () => {
    expect((await pdfStructure(await pdfWith(['One', 'Two']), 500)).outline).toBeNull();
    const pdf = await pdfWith(
      ['One', 'Two'],
      [{ title: 'Broken', page: null, children: [{ title: 'Two', page: 1 }] }],
    );
    expect((await pdfStructure(pdf, 500)).outline).toEqual([{ title: 'Two', page: 2, items: [] }]);
  });

  it('keeps the text of the pages that were rendered only', async () => {
    const { pageTexts } = await pdfStructure(await pdfWith(['One', 'Two', 'Three']), 2);
    expect(pageTexts).toEqual(['One', 'Two']);
  });
});
