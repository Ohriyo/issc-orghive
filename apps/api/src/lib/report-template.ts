import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { TocRow } from '#src/services/report-rules';

/**
 * The one HTML template for the Semestral End Report's own pages (docs/PROJECT_WORKFLOW_SPEC.md,
 * section 4): cover, table of contents, project dividers and placeholders. Every page is
 * exactly one A4 sheet (fixed size, overflow clipped, long text clamped), so the number of
 * pages is known before rendering and the contents can be numbered in advance. Same look for
 * every organization: Poppins, NwSSU greens, a hexagon mark (apps/web/src/index.css tokens).
 */

export type TemplatePage =
  | {
      kind: 'cover';
      org: { name: string; acronym: string; level: string; college: string | null };
      semester: string;
      academicYear: string;
      generatedOn: string;
      projectCount: number;
    }
  | { kind: 'toc'; rows: TocRow[]; part: number; parts: number }
  | {
      kind: 'divider';
      number: number;
      total: number;
      project: { name: string; eventDate: string; location: string; beneficiaries: string };
    }
  | {
      kind: 'placeholder';
      projectName: string;
      taskLabel: string;
      /** Missing: never submitted. Unreadable: submitted, but the file could not be merged. */
      reason: 'missing' | 'unreadable';
    };

const require = createRequire(import.meta.url);

/** Poppins, embedded so Chromium never fetches anything while rendering. */
function fontFaces(): string {
  return [400, 600, 700]
    .map((weight) => {
      const file = require.resolve(
        `@fontsource/poppins/files/poppins-latin-${weight}-normal.woff2`,
      );
      const data = readFileSync(file).toString('base64');
      return `@font-face{font-family:'Poppins';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${data}) format('woff2');}`;
    })
    .join('');
}

let fontCss: string | undefined;

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const HEXAGON = `<svg class="hex" viewBox="0 0 100 115.47" aria-hidden="true"><polygon points="50,0 100,28.87 100,86.6 50,115.47 0,86.6 0,28.87"/></svg>`;

const STYLES = `
@page { size: A4; margin: 0; }
:root {
  /* apps/web/src/index.css */
  --ink: #095d40; --forest-500: #2f5d3a; --forest-700: #1d5330; --forest-900: #0c4a27;
  --leaf: #429644; --surface: #f9f9f9; --muted: #4a5a50; --line: #d9e3dc; --danger: #a12b2b;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { font-family: 'Poppins', sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 210mm; height: 297mm; overflow: hidden; position: relative; break-after: page; padding: 22mm 20mm; background: #fff; }
.page:last-child { break-after: auto; }
.clamp2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.clamp3 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.hex polygon { fill: var(--forest-700); }
.band { position: absolute; left: 0; right: 0; bottom: 0; height: 30mm; background: linear-gradient(100deg, var(--forest-900), var(--forest-500) 60%, var(--leaf)); }
.band::before { content: ''; position: absolute; left: 0; right: 0; top: -9mm; height: 18mm; background: #fff; border-radius: 0 0 50% 50% / 0 0 100% 100%; }
/* No letter-spacing or text-transform: both break the PDF's text layer (search, copy, reading). */
.eyebrow { font-size: 11pt; font-weight: 600; color: var(--leaf); }

.cover { background: var(--surface); display: flex; flex-direction: column; }
.cover .band::before { background: var(--surface); }
.cover .brand { display: flex; align-items: center; gap: 4mm; font-weight: 700; font-size: 14pt; }
.cover .brand .hex { width: 9mm; }
.cover .mark { margin-top: 30mm; width: 38mm; }
.cover h1 { margin-top: 10mm; font-size: 30pt; line-height: 1.15; font-weight: 700; }
.cover .sub { margin-top: 2mm; font-size: 18pt; font-weight: 600; color: var(--forest-500); }
.cover .org { margin-top: 10mm; font-size: 16pt; font-weight: 600; }
.cover .meta { margin-top: 2mm; font-size: 11pt; color: var(--muted); }
.cover dl { margin-top: 14mm; display: grid; grid-template-columns: 42mm 1fr; row-gap: 3mm; font-size: 11pt; }
.cover dt { color: var(--muted); }
.cover dd { font-weight: 600; }

.toc h2 { margin-top: 3mm; font-size: 20pt; font-weight: 700; }
.toc ol { list-style: none; margin-top: 8mm; }
.toc li { display: flex; align-items: baseline; gap: 3mm; height: 8.6mm; font-size: 10.5pt; border-bottom: .3mm solid var(--line); }
.toc li.project { font-weight: 600; font-size: 11pt; padding-top: 1.5mm; }
.toc li.task { padding-left: 7mm; }
.toc .label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toc .missing { color: var(--danger); font-size: 9pt; font-weight: 600; }
.toc .num { width: 14mm; text-align: right; font-variant-numeric: tabular-nums; }
.toc .more { position: absolute; bottom: 14mm; right: 20mm; font-size: 9pt; color: var(--muted); }

.divider { display: flex; flex-direction: column; justify-content: center; }
.divider .hex { position: absolute; top: 22mm; right: 20mm; width: 22mm; }
.divider h2 { margin-top: 6mm; font-size: 26pt; line-height: 1.2; font-weight: 700; }
.divider dl { margin-top: 12mm; display: grid; grid-template-columns: 42mm 1fr; row-gap: 4mm; font-size: 12pt; }
.divider dt { color: var(--muted); }
.divider dd { font-weight: 600; }

.placeholder { display: flex; align-items: center; justify-content: center; text-align: center; }
.placeholder .box { border: .6mm dashed var(--line); border-radius: 8mm; padding: 18mm 14mm; width: 100%; }
.placeholder h2 { margin-top: 4mm; font-size: 22pt; font-weight: 700; }
.placeholder h2.unreadable { color: var(--danger); }
.placeholder p { margin-top: 4mm; font-size: 12pt; color: var(--muted); }
`;

function cover(p: Extract<TemplatePage, { kind: 'cover' }>): string {
  return `<section class="page cover">
  <div class="brand">${HEXAGON}<span>Orghive</span></div>
  <div class="mark">${HEXAGON}</div>
  <p class="eyebrow" style="margin-top:10mm">Academic Year ${escapeHtml(p.academicYear)}</p>
  <h1>Semestral End Report</h1>
  <p class="sub">${escapeHtml(p.semester)}</p>
  <p class="org clamp2">${escapeHtml(p.org.name)} (${escapeHtml(p.org.acronym)})</p>
  <p class="meta">${escapeHtml(p.org.level)}${p.org.college ? ` · ${escapeHtml(p.org.college)}` : ''}</p>
  <dl>
    <dt>Semester</dt><dd>${escapeHtml(p.semester)}</dd>
    <dt>Academic year</dt><dd>${escapeHtml(p.academicYear)}</dd>
    <dt>Projects</dt><dd>${p.projectCount}</dd>
    <dt>Generated</dt><dd>${escapeHtml(p.generatedOn)}</dd>
  </dl>
  <div class="band"></div>
</section>`;
}

function toc(p: Extract<TemplatePage, { kind: 'toc' }>): string {
  const rows = p.rows
    .map(
      (r) =>
        `<li class="${r.level}"><span class="label">${escapeHtml(r.label)}</span>${
          r.missing ? '<span class="missing">Not submitted</span>' : ''
        }<span class="num">${r.page}</span></li>`,
    )
    .join('');
  return `<section class="page toc">
  <p class="eyebrow">Semestral End Report</p>
  <h2>Contents${p.parts > 1 ? ` (${p.part} of ${p.parts})` : ''}</h2>
  ${p.rows.length ? `<ol>${rows}</ol>` : '<p style="margin-top:8mm">No projects had a target date in this semester.</p>'}
  ${p.part < p.parts ? '<p class="more">Continued on the next page</p>' : ''}
</section>`;
}

function divider(p: Extract<TemplatePage, { kind: 'divider' }>): string {
  return `<section class="page divider">
  ${HEXAGON}
  <p class="eyebrow">Project ${p.number} of ${p.total}</p>
  <h2 class="clamp3">${escapeHtml(p.project.name)}</h2>
  <dl>
    <dt>Event date</dt><dd>${escapeHtml(p.project.eventDate)}</dd>
    <dt>Location</dt><dd class="clamp2">${escapeHtml(p.project.location)}</dd>
    <dt>Beneficiaries</dt><dd class="clamp3">${escapeHtml(p.project.beneficiaries)}</dd>
  </dl>
  <div class="band"></div>
</section>`;
}

function placeholder(p: Extract<TemplatePage, { kind: 'placeholder' }>): string {
  const missing = p.reason === 'missing';
  return `<section class="page placeholder"><div class="box">
  <p class="eyebrow">${escapeHtml(p.taskLabel)}</p>
  <h2 class="${missing ? '' : 'unreadable'}">${missing ? 'Not submitted' : 'Could not be included'}</h2>
  <p class="clamp2">${escapeHtml(p.projectName)}</p>
  <p>${
    missing
      ? 'No file was submitted for this task.'
      : 'The submitted file could not be read. Open it in Orghive instead.'
  }</p>
</div></section>`;
}

/** One HTML document whose pages are `pages`, in order, one A4 sheet each. */
export function renderReportHtml(pages: readonly TemplatePage[]): string {
  fontCss ??= fontFaces();
  const body = pages
    .map((p) =>
      p.kind === 'cover'
        ? cover(p)
        : p.kind === 'toc'
          ? toc(p)
          : p.kind === 'divider'
            ? divider(p)
            : placeholder(p),
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Semestral End Report</title><style>${fontCss}${STYLES}</style></head><body>${body}</body></html>`;
}
