import { describe, expect, it } from 'vitest';
import {
  paginate,
  partLabel,
  planReport,
  reportTasks,
  TOC_ROWS_PER_PAGE,
  tocPageCount,
  type ReportPart,
  type ReportProject,
} from '#src/services/report-rules';

const PDF = [{ storageKey: 'k', mimeType: 'application/pdf' }];
const letter = (label: string) => ({
  storageKey: `k-${label}`,
  mimeType: 'application/pdf',
  label,
});

function project(overrides: Partial<ReportProject> = {}): ReportProject {
  return {
    id: 'p',
    name: 'Seminar',
    targetDate: '2026-09-10',
    location: 'CEA',
    beneficiaries: 'Students',
    nomRequired: false,
    momRequired: false,
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
    files: {},
    ...overrides,
  };
}

const describePart = (p: ReportPart) =>
  p.kind === 'file' || p.kind === 'missing'
    ? `${p.kind}:${p.project.name}:${p.task}`
    : p.kind === 'divider'
      ? `divider:${p.project.name}`
      : p.kind;

describe('planReport', () => {
  it('orders cover, contents, then projects by target date with files in the fixed order', () => {
    const plan = planReport([
      project({ id: 'b', name: 'Late', targetDate: '2026-11-01', files: { ACR: PDF } }),
      project({
        id: 'a',
        name: 'Early',
        targetDate: '2026-09-01',
        nomRequired: true,
        momRequired: true,
        files: { PROPOSAL: PDF, MOM: PDF, FINANCIAL_REPORT: PDF },
      }),
    ]);
    expect(plan.parts.map(describePart)).toEqual([
      'cover',
      'toc',
      'divider:Early',
      'file:Early:PROPOSAL',
      'missing:Early:NOM',
      'file:Early:MOM',
      'missing:Early:ACR',
      'file:Early:FINANCIAL_REPORT',
      'divider:Late',
      'missing:Late:PROPOSAL',
      'file:Late:ACR',
      'missing:Late:FINANCIAL_REPORT',
    ]);
  });

  it('breaks target-date ties by name', () => {
    const plan = planReport([
      project({ id: '2', name: 'Zeta' }),
      project({ id: '1', name: 'Alpha' }),
    ]);
    expect(plan.projects.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('lists NOM and MOM only when needed, or when a file was filed anyway', () => {
    expect(reportTasks(project())).toEqual(['PROPOSAL', 'ACR', 'FINANCIAL_REPORT']);
    expect(reportTasks(project({ files: { MOM: PDF } }))).toEqual([
      'PROPOSAL',
      'MOM',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
  });

  it('orders every pre-event document: Proposal, NOM, MOM, letters, attendance, others', () => {
    const plan = planReport([
      project({
        name: 'Fair',
        nomRequired: true,
        momRequired: true,
        communicationLetterRequired: true,
        attendanceSheetRequired: true,
        files: {
          PROPOSAL: PDF,
          NOM: PDF,
          MOM: PDF,
          COMMUNICATION_LETTER: [
            letter('Letter to the Dean'),
            letter('Letter to the Guidance Office'),
          ],
          ATTENDANCE_SHEET: PDF,
          OTHER_PRE_EVENT: [letter('Venue reservation')],
          ACR: PDF,
          FINANCIAL_REPORT: PDF,
        },
      }),
    ]);
    expect(plan.parts.map(describePart)).toEqual([
      'cover',
      'toc',
      'divider:Fair',
      'file:Fair:PROPOSAL',
      'file:Fair:NOM',
      'file:Fair:MOM',
      'file:Fair:COMMUNICATION_LETTER',
      'file:Fair:COMMUNICATION_LETTER',
      'file:Fair:ATTENDANCE_SHEET',
      'file:Fair:OTHER_PRE_EVENT',
      'file:Fair:ACR',
      'file:Fair:FINANCIAL_REPORT',
    ]);
    const letters = plan.parts.flatMap((p) =>
      p.kind === 'file' && p.task === 'COMMUNICATION_LETTER' ? [p.file.label] : [],
    );
    expect(letters).toEqual(['Letter to the Dean', 'Letter to the Guidance Office']);
  });

  it('puts "Not submitted" for a ticked letter or attendance sheet, never for other documents', () => {
    const plan = planReport([
      project({ name: 'Talk', communicationLetterRequired: true, attendanceSheetRequired: true }),
    ]);
    expect(plan.parts.map(describePart)).toEqual([
      'cover',
      'toc',
      'divider:Talk',
      'missing:Talk:PROPOSAL',
      'missing:Talk:COMMUNICATION_LETTER',
      'missing:Talk:ATTENDANCE_SHEET',
      'missing:Talk:ACR',
      'missing:Talk:FINANCIAL_REPORT',
    ]);
  });

  it('names each letter in the contents by its label', () => {
    const { parts } = planReport([
      project({
        name: 'One',
        communicationLetterRequired: true,
        files: { COMMUNICATION_LETTER: [letter('Letter to the Dean')] },
      }),
    ]);
    const { toc } = paginate(parts, () => 1);
    expect(toc.map((r) => r.label)).toContain('Communication Letter: Letter to the Dean');
    expect(partLabel('ATTENDANCE_SHEET')).toBe('Attendance Sheet');
  });

  it('is a cover and empty contents with no projects', () => {
    expect(planReport([]).parts.map(describePart)).toEqual(['cover', 'toc']);
  });
});

describe('paginate', () => {
  it('numbers each part from where the previous one ended', () => {
    const { parts } = planReport([project({ name: 'One', files: { PROPOSAL: PDF, ACR: PDF } })]);
    // cover 1, contents 1, divider 1, proposal 3, ACR 2, financial missing 1.
    const pages: Record<string, number> = { 'file:One:PROPOSAL': 3, 'file:One:ACR': 2 };
    const result = paginate(parts, (p) => pages[describePart(p)] ?? 1);
    expect(result.starts).toEqual([1, 2, 3, 4, 7, 9]);
    expect(result.totalPages).toBe(9);
    expect(result.toc).toEqual([
      { level: 'project', label: 'One', missing: false, page: 3 },
      { level: 'task', label: 'Project Proposal', missing: false, page: 4 },
      { level: 'task', label: 'Activity Completion Report', missing: false, page: 7 },
      { level: 'task', label: 'Financial Report', missing: true, page: 9 },
    ]);
  });

  it('gives the contents as many pages as its rows need', () => {
    const many = Array.from({ length: 10 }, (_, i) => project({ id: `${i}`, name: `P${i}` }));
    const { parts } = planReport(many);
    // 10 projects x (divider + 3 tasks) = 40 rows.
    expect(tocPageCount(parts)).toBe(Math.ceil(40 / TOC_ROWS_PER_PAGE));
    expect(tocPageCount(planReport([]).parts)).toBe(1);
  });
});
