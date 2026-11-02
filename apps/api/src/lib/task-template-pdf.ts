import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { DEFAULT_TASK_KEYWORDS, PROJECT_TASK_LABELS } from '@orghive/shared';
import {
  longDate,
  officeName,
  orientationOf,
  renderQrImage,
  type TemplateContext,
} from './task-template';

/** 8.5 × 13 in long bond, in points. */
const LONG_BOND = { width: 612, height: 936 } as const;
const MARGIN = 72;
const QR_WIDTH = 0.85 * 72;

export interface FilledTaskFacts extends TemplateContext {
  /** The Financial Report's totals, printed the way the template's table ends. */
  totals?: { incomeCentavos: number; expensesCentavos: number };
}

const pesos = (centavos: number) =>
  (centavos / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The words the keyword check looks for: the first alternative of each phrase. */
const keywordsOf = (ctx: FilledTaskFacts) =>
  DEFAULT_TASK_KEYWORDS[ctx.type].map((phrase) => phrase.split('|')[0]!);

/**
 * A task's template as an organization uploads it: filled in, signed and saved as a PDF,
 * with the task's QR code at the top right and its short code under it (spec section 6).
 * The demo data uses it; real files are the Word template (task-template.ts), printed and
 * scanned. Plain text on long bond, so the checks read it from its text layer.
 */
export async function filledTaskPdf(ctx: FilledTaskFacts): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const landscape = orientationOf(ctx.type) === 'landscape';
  const size: [number, number] = landscape
    ? [LONG_BOND.height, LONG_BOND.width]
    : [LONG_BOND.width, LONG_BOND.height];
  const page = pdf.addPage(size);
  const [width, height] = size;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.05, 0.1, 0.08);

  const qr = await pdf.embedPng(await renderQrImage(ctx.qrContent, ctx.code));
  const qrHeight = (QR_WIDTH * qr.height) / qr.width;
  page.drawImage(qr, {
    x: width - MARGIN - QR_WIDTH,
    y: height - 0.3 * 72 - qrHeight,
    width: QR_WIDTH,
    height: qrHeight,
  });

  let y = height - MARGIN;
  const line = (text: string, options: { size?: number; font?: typeof regular } = {}) => {
    const fontSize = options.size ?? 11;
    page.drawText(text, {
      x: MARGIN,
      y,
      size: fontSize,
      font: options.font ?? regular,
      color: ink,
    });
    y -= fontSize * 1.6;
  };

  line('Republic of the Philippines', { size: 10 });
  line('NORTHWEST SAMAR STATE UNIVERSITY', { size: 12, font: bold });
  if (ctx.college) line(ctx.college, { size: 10 });
  line(officeName(ctx.organization.name), { size: 11, font: bold });
  y -= 18;

  const title = ctx.label
    ? `${PROJECT_TASK_LABELS[ctx.type]}: ${ctx.label}`
    : PROJECT_TASK_LABELS[ctx.type];
  line(title.toUpperCase(), { size: 14, font: bold });
  y -= 6;
  line(`Project Title: ${ctx.project.name}`);
  line(`Organization: ${ctx.organization.name} (${ctx.organization.acronym})`);
  line(`Date: ${longDate(ctx.project.targetDate)}`);
  line(`Venue: ${ctx.project.location}`);
  line(`Participants: ${ctx.project.beneficiaries}`);
  y -= 10;
  // The totals first, as the form's tables end them: the reader takes the income total from
  // before the first "cash out" (readFinancialTotals).
  if (ctx.totals) {
    line(`Total Cash In: PHP ${pesos(ctx.totals.incomeCentavos)}`, { font: bold });
    line(`Total Cash Out: PHP ${pesos(ctx.totals.expensesCentavos)}`, { font: bold });
    y -= 6;
  }
  for (const keyword of keywordsOf(ctx)) line(`${keyword}: as prepared by the organization.`);
  y -= 30;
  line('Prepared by:');
  y -= 14;
  line(`Signed, ${ctx.organization.acronym} President`, { font: bold });
  line(`Task code: ${ctx.code}`, { size: 9 });

  return Buffer.from(await pdf.save());
}
