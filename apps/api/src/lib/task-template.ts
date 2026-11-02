import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import QRCode from 'qrcode';
import type { CheckedTaskType, OrganizationType } from '@orghive/shared';

/*
 * Project task templates (docs/PROJECT_WORKFLOW_SPEC.md, section 6, and docs/templates/):
 * a Word file on the official NwSSU letterhead (S.Y. 2026-2027 formats), pre-filled with the
 * organization, college, project, event date and task, with the task's QR code and short
 * code in the header of every page. The organization types in it, prints, signs, scans and
 * uploads the PDF; the worker reads the code back from the scan.
 */

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface TemplateContext {
  type: CheckedTaskType;
  organization: { name: string; acronym: string; type: OrganizationType };
  /** The college's name; null for the ISSC. */
  college: string | null;
  project: { name: string; targetDate: string; location: string; beneficiaries: string };
  /** A Communication Letter's label, e.g. "Letter to the Dean". */
  label: string | null;
  /** e.g. OH-7K3P-ACR. */
  code: string;
  /** The signed QR content (lib/task-qr.ts). */
  qrContent: string;
}

const require = createRequire(import.meta.url);
const CODE_FONT = 'OrghiveTaskCode';
// Bundled, so the code under the QR renders the same on a server with no system fonts.
GlobalFonts.registerFromPath(
  require.resolve('@fontsource/poppins/files/poppins-latin-600-normal.woff2'),
  CODE_FONT,
);

const LETTERHEADS = {
  portrait: new URL('./data/letterhead-portrait.docx', import.meta.url),
  landscape: new URL('./data/letterhead-landscape.docx', import.meta.url),
};
const letterheadCache = new Map<keyof typeof LETTERHEADS, Uint8Array>();

function letterhead(orientation: keyof typeof LETTERHEADS): Uint8Array {
  let bytes = letterheadCache.get(orientation);
  if (!bytes) {
    bytes = new Uint8Array(readFileSync(LETTERHEADS[orientation]));
    letterheadCache.set(orientation, bytes);
  }
  return bytes;
}

// ---------------------------------------------------------------------------------------
// A small WordprocessingML writer: Arial 11 like the official forms.

type Inline = string | { text: string; bold?: boolean; italic?: boolean; hint?: boolean };

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(inline: Inline, size = 11): string {
  const r = typeof inline === 'string' ? { text: inline } : inline;
  const props = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>',
    r.bold ? '<w:b/>' : '',
    r.italic || r.hint ? '<w:i/>' : '',
    // Placeholders are grey, so what still needs typing stands out.
    r.hint ? '<w:color w:val="7F7F7F"/>' : '',
    `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>`,
  ].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
}

interface ParaOptions {
  align?: 'left' | 'center' | 'right' | 'both';
  /** Space after, in points. */
  after?: number;
  before?: number;
  size?: number;
  indent?: number;
}

function p(content: Inline | Inline[] = '', o: ParaOptions = {}): string {
  const runs = (Array.isArray(content) ? content : [content]).map((c) => run(c, o.size));
  const props = [
    `<w:spacing w:before="${(o.before ?? 0) * 20}" w:after="${(o.after ?? 6) * 20}"/>`,
    o.indent ? `<w:ind w:left="${o.indent}"/>` : '',
    `<w:jc w:val="${o.align ?? 'left'}"/>`,
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${runs.join('')}</w:p>`;
}

const hint = (text: string): Inline => ({ text, hint: true });
const bold = (text: string): Inline => ({ text, bold: true });

/** A bordered table; `widths` in twentieths of a point; `height` the minimum row height. */
function table(rows: Inline[][], widths: number[], o: { header?: boolean; height?: number } = {}) {
  const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="000000"/>`)
    .join('');
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const body = rows
    .map((cells, rowIndex) => {
      const isHeader = o.header && rowIndex === 0;
      const height =
        !isHeader && o.height ? `<w:trPr><w:trHeight w:val="${o.height}"/></w:trPr>` : '';
      const tcs = cells
        .map((cell, i) => {
          const content = isHeader && typeof cell === 'string' ? bold(cell) : cell;
          return `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/></w:tcPr>${p(content, {
            align: isHeader ? 'center' : 'left',
            after: 0,
          })}</w:tc>`;
        })
        .join('');
      return `<w:tr>${height}${tcs}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${border}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>${p('', { after: 0 })}`;
}

const blankRows = (count: number, columns: number): Inline[][] =>
  Array.from({ length: count }, () => Array.from({ length: columns }, () => ''));

/** Two names signed side by side under one caption, as on Form 7's "Noted:". */
function signatoryPair(caption: string, left: string, right: string, width: number): string {
  const cell = (position: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="${width / 2}" w:type="dxa"/></w:tcPr>${p(bold('[FULL NAME]'), { after: 0 })}${p(position, { after: 0 })}</w:tc>`;
  return `${p(caption, { before: 12, after: 30 })}<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${width / 2}"/><w:gridCol w:w="${width / 2}"/></w:tblGrid><w:tr>${cell(left)}${cell(right)}</w:tr></w:tbl>${p('', { after: 0 })}`;
}

/** A name to sign over, with its position: "[FULL NAME]" / "President, TAG". */
function signatory(caption: string | null, position: string): string {
  return [
    caption ? p(caption, { before: 12, after: 30 }) : p('', { after: 30 }),
    p(bold('[FULL NAME]'), { after: 0 }),
    p(position, { after: 12 }),
  ].join('');
}

// ---------------------------------------------------------------------------------------
// The task bodies, after the official formats (docs/templates/README.md).

/** "OFFICE OF THE ANIMATION GUILD", the banner of the organization's own documents. */
export function officeName(name: string): string {
  return `OFFICE OF THE ${name.replace(/^the\s+/i, '').toUpperCase()}`;
}

/** "2026-11-07" -> "November 7, 2026". */
export function longDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The project line every template carries, so the checks can find the project's name. */
function projectLine(ctx: TemplateContext): string {
  return p(
    [
      bold('Project: '),
      ctx.project.name,
      '   ',
      bold('Event date: '),
      longDate(ctx.project.targetDate),
    ],
    { align: 'center', after: 12, size: 10 },
  );
}

function banner(ctx: TemplateContext): string {
  return p(bold(officeName(ctx.organization.name)), { align: 'center', after: 12, size: 12 });
}

/** "Name of the Student Body Organization" on the forms, per organization level. */
function levelNoun(type: OrganizationType): string {
  if (type === 'SBO') return 'Student Body Organization';
  if (type === 'CSC') return 'Collegiate Student Council';
  return 'Organization';
}

function proposal(ctx: TemplateContext): string {
  const a = ctx.organization.acronym;
  const section = (title: string, body: string) =>
    p(bold(title), { before: 10, after: 4 }) + p(hint(body), { align: 'both' });
  return [
    banner(ctx),
    p(bold('PROJECT PROPOSAL'), { align: 'center', after: 10 }),
    p(bold('I. PROJECT TITLE'), { after: 4 }),
    p(bold(ctx.project.name.toUpperCase()), { align: 'center', after: 10 }),
    section(
      'II. PROJECT RATIONALE',
      '[Why the project is needed, and how it supports the program and the students.]',
    ),
    section(
      'III. PROJECT DESCRIPTION',
      '[What the activity is, who it is for, and what it will cover.]',
    ),
    section('IV. PROJECT OBJECTIVES', '[The project aims to: 1. …  2. …  3. …]'),
    p(bold('V. PROJECT PROPONENT/S'), { before: 10, after: 4 }),
    p(
      `The project is proposed and organized by ${ctx.organization.name} (${a})${ctx.college ? `, ${ctx.college}` : ''}, Northwest Samar State University.`,
      { align: 'both' },
    ),
    p(bold('VI. PROJECT BENEFICIARIES'), { before: 10, after: 4 }),
    p(ctx.project.beneficiaries, { align: 'both' }),
    p(bold('VII. PROJECT IMPLEMENTATION'), { before: 10, after: 4 }),
    p(
      `The project will be implemented on ${longDate(ctx.project.targetDate)} at ${ctx.project.location}.`,
      { align: 'both' },
    ),
    p(bold('PROPOSED SCHEDULE OF ACTIVITIES'), { before: 8, after: 4 }),
    table([['TIME', 'ACTIVITY', 'PERSON(S) RESPONSIBLE'], ...blankRows(4, 3)], [2200, 4000, 3160], {
      header: true,
      height: 400,
    }),
    section(
      'VIII. PROJECT COST',
      '[Budget, sources of funds, and how expenses will be documented.]',
    ),
    section('IX. EXPECTED OUTPUT', '[What the project will have achieved.]'),
    signatory('Proposed:', `President, ${a}`),
    signatory('Noted:', `Adviser, ${a}`),
    signatory('Recommending Approval:', '[Position, e.g. Dean of the College]'),
    signatory('Approved:', '[Position, e.g. Director, Student Affairs and Services]'),
  ].join('');
}

function noticeOfMeeting(ctx: TemplateContext): string {
  const a = ctx.organization.acronym;
  return [
    banner(ctx),
    p(bold('NOTICE OF MEETING'), { align: 'center', after: 10 }),
    p(bold('[DATE]'), { align: 'right', after: 10 }),
    p([bold('TO: '), hint('[WHO IS INVITED, e.g. ALL BSEMC STUDENTS]')], { after: 10 }),
    p(
      [
        `This is to inform you that ${ctx.organization.name} (${a}) will be conducting a meeting for `,
        bold(ctx.project.name),
        ' on ',
        hint('[date, time]'),
        ' at ',
        hint('[venue]'),
        ' to discuss the following agenda:',
      ],
      { align: 'both' },
    ),
    p(hint('1. [Agenda item]'), { indent: 720, after: 2 }),
    p(hint('2. [Agenda item]'), { indent: 720, after: 2 }),
    p(hint('3. Other matters'), { indent: 720, after: 10 }),
    p(hint('[Registration time, and what attendees should bring or know.]'), { align: 'both' }),
    p('Thank you in advance for your active participation.', { after: 18 }),
    signatory('In service of the students,', `President, ${ctx.organization.name}`),
    signatory('Approved by:', `Adviser, ${ctx.organization.name}`),
  ].join('');
}

function minutesOfMeeting(ctx: TemplateContext): string {
  const field = (label: string, value: string) =>
    p([bold(`${label}: `), hint(value)], { after: 2 });
  const section = (title: string, body: string) =>
    p(bold(title), { before: 10, after: 4 }) + p(hint(body), { align: 'both' });
  return [
    banner(ctx),
    p(bold('Minutes of the Meeting'), { after: 10 }),
    p([bold('Project: '), ctx.project.name], { after: 2 }),
    field('Date', '[Month day, year]'),
    field('Venue/Platform', '[e.g. Multimedia Room, Google Meet]'),
    field('Meeting Started', '[time]'),
    field('Meeting Adjourned', '[time]'),
    section('I. Attendance', '[Present: names]   [Absent: names]'),
    section('II. Agenda', '[1. …  2. …  3. …]'),
    section('III. Discussion', '[What was discussed and agreed, item by item.]'),
    section('IV. Task Assignments', '[Who does what.]'),
    section('V. Other Matters', '[Anything else raised.]'),
    section(
      'VI. Adjournment',
      '[With no other matters to discuss, the meeting was adjourned at … ]',
    ),
    signatory('Prepared by:', `Secretary, ${ctx.organization.name}`),
    signatory('Noted by:', `President, ${ctx.organization.name}`),
  ].join('');
}

function communicationLetter(ctx: TemplateContext): string {
  return [
    banner(ctx),
    p(bold('[DATE]'), { after: 10 }),
    p(bold('[NAME OF THE ADDRESSEE]'), { after: 0 }),
    p(hint('[Position, e.g. Dean, College of …]'), { after: 0 }),
    p('Northwest Samar State University', { after: 10 }),
    p([bold('Subject: '), hint(`[${ctx.label ?? 'Request'}]`), bold(` for ${ctx.project.name}`)], {
      after: 10,
    }),
    p(hint('[Sir/Madam]:'), { after: 8 }),
    p('Greetings!', { after: 8 }),
    p(
      [
        `${ctx.organization.name} (${ctx.organization.acronym}) respectfully `,
        hint('[what you request, when and where, and why]'),
        ` for ${ctx.project.name} on ${longDate(ctx.project.targetDate)}.`,
      ],
      { align: 'both' },
    ),
    p(hint('[Further details and assurances.]'), { align: 'both' }),
    p('Thank you very much.', { after: 18 }),
    signatory('Respectfully yours,', `President, ${ctx.organization.name}`),
    signatory('Noted by:', `Adviser, ${ctx.organization.name}`),
    signatory('Approved by:', '[Position of the approving office]'),
  ].join('');
}

function attendanceSheet(ctx: TemplateContext): string {
  const rows: Inline[][] = Array.from({ length: 25 }, (_, i) => [String(i + 1), '', '', '']);
  return [
    banner(ctx),
    p(bold('ATTENDANCE SHEET'), { align: 'center', after: 4 }),
    projectLine(ctx),
    p([bold('Venue: '), ctx.project.location], { align: 'center', after: 10, size: 10 }),
    table([['No.', 'Name', 'Year & Program', 'Signature'], ...rows], [700, 4060, 2400, 2200], {
      header: true,
      height: 440,
    }),
    signatory('Prepared by:', `Secretary, ${ctx.organization.acronym}`),
    signatory('Noted by:', `Adviser, ${ctx.organization.acronym}`),
  ].join('');
}

/** Form 7 – Accomplishment Report (landscape). */
function accomplishmentReport(ctx: TemplateContext): string {
  const a = ctx.organization.acronym;
  return [
    p(bold('OFFICE OF THE STUDENT BODY ORGANIZATIONS'), { align: 'center', after: 0 }),
    p('Form 7 – Accomplishment Report', { align: 'center', after: 10 }),
    p({ text: `${ctx.organization.name} (${a})`, bold: true }, { align: 'center', after: 0 }),
    p(`Name of the ${levelNoun(ctx.organization.type)}`, { align: 'center', after: 4 }),
    projectLine(ctx),
    table(
      [
        ['Project/Program', 'Input', 'Throughput', 'Output', 'Outcome', 'Impact', 'Pictures'],
        [
          bold(ctx.project.name),
          hint('[What did you need to start?]'),
          hint('[What happened during the activity?]'),
          hint('[What did you do to make it successful?]'),
          hint('[What outcomes were made?]'),
          hint('[What impact did it make on your beneficiaries?]'),
          hint('[Photos of the event, with sources]'),
        ],
      ],
      // The landscape page's full text width (13 in less the margins), like Form 7.
      [2400, 1900, 1900, 1900, 1900, 1900, 3500],
      { header: true, height: 2600 },
    ),
    signatory('Prepared:', `Secretary, ${a}`),
    signatoryPair('Noted:', `President, ${a}`, `Adviser, ${a}`, 12000),
  ].join('');
}

/** Form 9 – Financial Report: the totals here are what the checks compare (spec 6). */
function financialReport(ctx: TemplateContext): string {
  const a = ctx.organization.acronym;
  return [
    p(bold('OFFICE OF THE STUDENT BODY ORGANIZATIONS'), { align: 'center', after: 0 }),
    p('Form 9 – Financial Report', { align: 'center', after: 4 }),
    p(bold(`${ctx.organization.name} (${a})`), { align: 'center', after: 0 }),
    projectLine(ctx),
    p(bold('I. CASH IN'), { after: 4 }),
    table(
      [
        ['Date', 'Fundraising Event', 'Amount'],
        ...blankRows(6, 3),
        ['', bold('TOTAL:'), bold('Php ')],
      ],
      [2200, 4900, 2260],
      { header: true, height: 360 },
    ),
    p(bold('II. CASH OUT'), { before: 6, after: 4 }),
    table(
      [['Item', 'Unit', 'Quantity', 'Amount', 'Official Receipt (OR) Number'], ...blankRows(8, 5)],
      [2700, 1100, 1300, 1700, 2560],
      { header: true, height: 360 },
    ),
    // Below the table, as on the official Form 9.
    p([bold('Total Cash Out:   Php '), hint('[amount]')], { align: 'center', after: 6 }),
    signatory('Audited:', `Auditor, ${a}`),
    signatory('Noted:', `President, ${a}`),
    signatory('Approved:', `Adviser, ${a}`),
  ].join('');
}

const BODIES: Record<CheckedTaskType, (ctx: TemplateContext) => string> = {
  PROPOSAL: proposal,
  NOM: noticeOfMeeting,
  MOM: minutesOfMeeting,
  COMMUNICATION_LETTER: communicationLetter,
  ATTENDANCE_SHEET: attendanceSheet,
  ACR: accomplishmentReport,
  FINANCIAL_REPORT: financialReport,
};

/** Form 7 is landscape, like the official one; every other template is portrait. */
export function orientationOf(type: CheckedTaskType): 'portrait' | 'landscape' {
  return type === 'ACR' ? 'landscape' : 'portrait';
}

// ---------------------------------------------------------------------------------------
// The QR code, in the header of every page.

/** QR image size in the header, in EMU (914,400 per inch). */
const QR_WIDTH_EMU = Math.round(0.85 * 914_400);
const QR_PX = 600;
const CODE_BAND_PX = 96;
const QR_HEIGHT_EMU = Math.round((QR_WIDTH_EMU * (QR_PX + CODE_BAND_PX)) / QR_PX);
const QR_TOP_EMU = Math.round(0.18 * 914_400);
const QR_REL_ID = 'rIdOrghiveQr';
const QR_MEDIA = 'media/orghive-qr.png';

/** The QR with its short code printed under it, as one PNG (the code is OCR-readable too). */
export async function renderQrImage(content: string, code: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(content, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: QR_PX,
  });
  const canvas = createCanvas(QR_PX, QR_PX + CODE_BAND_PX);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(await loadImage(qr), 0, 0, QR_PX, QR_PX);
  ctx.fillStyle = '#000000';
  ctx.font = `600 64px ${CODE_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(code, QR_PX / 2, QR_PX + CODE_BAND_PX / 2 - 6);
  return canvas.toBuffer('image/png');
}

function qrAnchor(code: string): string {
  const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251700000" behindDoc="0" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${QR_TOP_EMU}</wp:posOffset></wp:positionV><wp:extent cx="${QR_WIDTH_EMU}" cy="${QR_HEIGHT_EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="917001" name="Orghive task code" descr="Orghive task code ${esc(code)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${a}" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}"><pic:pic xmlns:pic="${pic}"><pic:nvPicPr><pic:cNvPr id="917002" name="orghive-qr.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${QR_REL_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${QR_WIDTH_EMU}" cy="${QR_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
}

/** The task's template as a Word file. */
export async function buildTaskTemplate(ctx: TemplateContext): Promise<Buffer> {
  const files = unzipSync(letterhead(orientationOf(ctx.type)));
  const document = strFromU8(files['word/document.xml']!);
  files['word/document.xml'] = strToU8(document.replace('{{BODY}}', BODIES[ctx.type](ctx)));

  // The QR joins the header's first paragraph (beside the logo), so the logo does not move.
  const header = strFromU8(files['word/header1.xml']!);
  const end = header.indexOf('</w:p>');
  if (end < 0) throw new Error('The letterhead header has no paragraph');
  files['word/header1.xml'] = strToU8(
    header.slice(0, end) + qrAnchor(ctx.code) + header.slice(end),
  );
  const rels = strFromU8(files['word/_rels/header1.xml.rels']!);
  files['word/_rels/header1.xml.rels'] = strToU8(
    rels.replace(
      '</Relationships>',
      `<Relationship Id="${QR_REL_ID}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${QR_MEDIA}"/></Relationships>`,
    ),
  );
  files[`word/${QR_MEDIA}`] = new Uint8Array(await renderQrImage(ctx.qrContent, ctx.code));
  return Buffer.from(zipSync(files, { level: 6 }));
}
