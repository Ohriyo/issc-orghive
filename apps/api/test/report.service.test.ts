import { writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReportService,
  chromiumInstalled,
  ensureReportDocumentType,
  pageTexts,
  seedReportProject,
} from './report-fixtures';
import { buildWorld, createTaskDocumentTypes, resetDb, testDb, type World } from './db';

const db = testDb();
// Each test rebuilds the database and may start Chromium.
const SLOW = 120_000;
vi.setConfig({ testTimeout: SLOW, hookTimeout: SLOW });

let world: World;
let s: ReturnType<typeof buildReportService>;
const officer = () => ({ userId: world.users.officer.id });
const jpice = () => ({ id: world.orgs.jpice.id, slug: world.orgs.jpice.slug });
const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
/** The report prints the day it was generated; pinned so the cover text stays the same. */
const GENERATED_AT = new Date('2026-10-17T02:00:00Z'); // 10:00 on October 17, Manila

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  await createTaskDocumentTypes(db);
  await ensureReportDocumentType(db);
  s = buildReportService(db, () => GENERATED_AT);
}, SLOW);

/** Queues a report for JPICE's 1st semester and runs the worker's half. */
async function generate() {
  const report = await s.service.request(officer(), jpice(), FIRST);
  const outcome = await s.service.generate(report.id);
  const stored = await db.semestralReport.findUniqueOrThrow({
    where: { id: report.id },
    include: { document: { include: { currentVersion: true } } },
  });
  const key = stored.document?.currentVersion?.storageKey;
  const pdf = key ? new Uint8Array(s.stored.get(key)!) : null;
  return { report, outcome, stored, pdf };
}

describe('the Semestral End Report', () => {
  it('compiles the semester’s projects in the fixed order, with placeholders', async () => {
    const base = { organizationId: world.orgs.jpice.id, createdById: world.users.officer.id };
    await seedReportProject(db, {
      ...base,
      name: 'Clean-up Drive',
      targetDate: '2026-11-20',
      files: { PROPOSAL: 'photo', ACR: 'broken' },
    });
    await seedReportProject(db, {
      ...base,
      name: 'Bridge Design Competition',
      targetDate: '2026-09-10',
      nomRequired: true,
      files: { PROPOSAL: 'proposal', ACR: 'acr', FINANCIAL_REPORT: 'financial' },
    });
    // 2nd semester and another organization: not in this report.
    await seedReportProject(db, { ...base, name: 'Spring Fair', targetDate: '2027-02-01' });
    await seedReportProject(db, {
      organizationId: world.orgs.psme.id,
      createdById: world.users.officer.id,
      name: 'PSME Plant Visit',
      targetDate: '2026-10-01',
    });

    const { outcome, stored, pdf } = await generate();
    expect(outcome).toBe('ready');
    expect(stored).toMatchObject({ status: 'ready', progress: 100, error: null });

    const pages = await pageTexts(pdf!);
    if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT, pdf!);
    // cover, contents, Bridge (divider, proposal 1, NOM missing, ACR 3, financial 2),
    // Clean-up (divider, photo, ACR unreadable, financial missing).
    expect(pages).toHaveLength(14);
    const expectPage = (n: number, ...texts: string[]) => {
      for (const text of texts) expect(pages[n - 1], `page ${n}`).toContain(text);
    };
    expectPage(1, 'Semestral End Report', '1st semester', '2026-2027', 'JPICE', 'October 17, 2026');
    expectPage(2, 'Contents', 'Bridge Design Competition', 'Clean-up Drive', 'Not submitted');
    expectPage(3, 'Project 1 of 2', 'Bridge Design Competition', 'September 10, 2026');
    expectPage(4, 'FIXTURE-PROPOSAL page 1 of 1');
    expectPage(5, 'Notice of Meeting', 'Not submitted');
    expectPage(6, 'FIXTURE-ACR page 1 of 3');
    expectPage(8, 'FIXTURE-ACR page 3 of 3');
    expectPage(9, 'FIXTURE-FINANCIAL page 1 of 2');
    expectPage(10, 'FIXTURE-FINANCIAL page 2 of 2');
    expectPage(11, 'Project 2 of 2', 'Clean-up Drive');
    expectPage(13, 'Activity Completion Report', 'Could not be included');
    expectPage(14, 'Financial Report', 'Not submitted');
    // Every page but the cover is numbered.
    expect(pages[0]).not.toContain('Page 1 of');
    pages.slice(1).forEach((text, i) => expect(text).toContain(`Page ${i + 2} of 14`));
    expect(pages.join(' ')).not.toMatch(/Spring Fair|PSME Plant Visit/);
  });

  it('numbers the contents with the pages each part starts on', async () => {
    await seedReportProject(db, {
      organizationId: world.orgs.jpice.id,
      createdById: world.users.officer.id,
      name: 'Bridge Design Competition',
      targetDate: '2026-09-10',
      files: { PROPOSAL: 'proposal', ACR: 'acr', FINANCIAL_REPORT: 'financial' },
    });
    const { pdf } = await generate();
    const contents = (await pageTexts(pdf!))[1]!;
    // divider 3, proposal 4, ACR 5-7, financial 8-9.
    expect(contents).toMatch(/Bridge Design Competition\s+3/);
    expect(contents).toMatch(/Project Proposal\s+4/);
    expect(contents).toMatch(/Activity Completion Report\s+5/);
    expect(contents).toMatch(/Financial Report\s+8/);
  });

  it('places labelled letters and the attendance sheet between the MOM and the ACR', async () => {
    await seedReportProject(db, {
      organizationId: world.orgs.jpice.id,
      createdById: world.users.officer.id,
      name: 'Bridge Design Competition',
      targetDate: '2026-09-10',
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
      files: { PROPOSAL: 'proposal', ATTENDANCE_SHEET: 'nom', ACR: 'acr' },
      labelled: [
        { task: 'COMMUNICATION_LETTER', label: 'Letter to the Dean', file: 'mom' },
        { task: 'COMMUNICATION_LETTER', label: 'Letter to the Guidance Office', file: 'proposal' },
        { task: 'OTHER_PRE_EVENT', label: 'Venue reservation', file: 'photo' },
      ],
    });
    const { pdf } = await generate();
    const pages = await pageTexts(pdf!);
    // cover 1, contents 2, divider 3, proposal 4, Dean letter 5-6, Guidance letter 7,
    // attendance 8, venue 9, ACR 10-12, financial missing 13.
    expect(pages).toHaveLength(13);
    expect(pages[4]).toContain('FIXTURE-MOM page 1 of 2');
    expect(pages[6]).toContain('FIXTURE-PROPOSAL page 1 of 1');
    expect(pages[7]).toContain('FIXTURE-NOM page 1 of 1');
    expect(pages[9]).toContain('FIXTURE-ACR page 1 of 3');
    expect(pages[12]).toMatch(/Financial Report[\s\S]*Not submitted/);
    const contents = pages[1]!;
    expect(contents).toMatch(/Communication Letter: Letter to the Dean\s+5/);
    expect(contents).toMatch(/Communication Letter: Letter to the Guidance Office\s+7/);
    expect(contents).toMatch(/Attendance Sheet\s+8/);
    expect(contents).toMatch(/Other pre-event document: Venue reservation\s+9/);
    expect(contents).toMatch(/Activity Completion Report\s+10/);
  });

  it('files it as a private, available document of the organization and tells the officer', async () => {
    const { stored } = await generate();
    expect(stored.document).toMatchObject({
      organizationId: world.orgs.jpice.id,
      title: 'Semestral End Report: JPICE, 1st semester 2026-2027',
      status: 'available',
      visibility: 'private',
      academicYear: '2026-2027',
      semester: 'first',
      createdById: world.users.officer.id,
    });
    expect(stored.document!.currentVersion).toMatchObject({
      scanStatus: 'clean',
      mimeType: 'application/pdf',
      originalFilename: 'jpice-semestral-end-report-2026-2027-first.pdf',
    });
    expect(stored.document!.currentVersion!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Its watermarked pages are rendered like any upload's, in case the officers share it.
    expect(s.previewsQueued).toEqual([stored.document!.currentVersionId]);
    expect(stored.document!.currentVersion!.thumbnailKey).toBeNull();
    expect(s.notified).toEqual([
      {
        userIds: [world.users.officer.id],
        title: 'Your Semestral End Report is ready',
        link: `/documents/${stored.documentId}`,
      },
    ]);
    expect(
      await db.auditLog.count({ where: { action: 'report_generate', entityId: stored.id } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: 'upload', entityId: stored.documentId! } }),
    ).toBe(1);
  });

  it('is a cover and empty contents when no project falls in the semester', async () => {
    const { outcome, pdf } = await generate();
    expect(outcome).toBe('ready');
    const pages = await pageTexts(pdf!);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toContain('No projects had a target date in this semester');
  });

  it(`does not time out on 25 projects (${chromiumInstalled ? 'Chromium' : 'text renderer'})`, async () => {
    for (let i = 0; i < 25; i++) {
      await seedReportProject(db, {
        organizationId: world.orgs.jpice.id,
        createdById: world.users.officer.id,
        name: `Project ${String(i + 1).padStart(2, '0')}`,
        targetDate: `2026-${String(8 + (i % 5)).padStart(2, '0')}-${String(1 + i).padStart(2, '0')}`,
        nomRequired: true,
        momRequired: true,
        files: {
          PROPOSAL: 'proposal',
          NOM: 'nom',
          MOM: 'mom',
          ACR: 'acr',
          FINANCIAL_REPORT: i % 2 ? 'financial' : 'wide',
        },
      });
    }
    const started = Date.now();
    const { outcome, pdf } = await generate();
    const elapsed = Date.now() - started;
    expect(outcome).toBe('ready');
    const pages = await pageTexts(pdf!);
    // Cover 1 + contents ceil(25 x 6 rows / 24) = 7, then 25 x (divider 1 + proposal 1 +
    // NOM 1 + MOM 2 + ACR 3) = 200, plus the financial reports: 12 PDFs of 2 pages (odd i)
    // and 13 images of 1 page (even i).
    expect(pages).toHaveLength(1 + 7 + 200 + 12 * 2 + 13);
    expect(elapsed).toBeLessThan(90_000);
  });

  it('records a failure in words the officer can use and tells them; one per semester runs at a time', async () => {
    await seedReportProject(db, {
      organizationId: world.orgs.jpice.id,
      createdById: world.users.officer.id,
      name: 'Bridge',
      targetDate: '2026-09-10',
      files: { PROPOSAL: 'proposal' },
    });
    const version = await db.documentVersion.findFirstOrThrow({
      where: { storageKey: { startsWith: 'fixtures/proposal' } },
    });
    s.failing.add(version.storageKey);

    const report = await s.service.request(officer(), jpice(), FIRST);
    await expect(s.service.request(officer(), jpice(), FIRST)).rejects.toMatchObject({
      status: 409,
    });
    expect(await s.service.generate(report.id)).toBe('failed');
    expect(await db.semestralReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({
      status: 'failed',
      error: 'Something went wrong while making the report. Try again.',
    });
    expect(s.notified.at(-1)?.title).toBe('Your Semestral End Report could not be made');
    // Finished: running it again does nothing, and a new request is allowed.
    expect(await s.service.generate(report.id)).toBe('skipped');
    await expect(s.service.request(officer(), jpice(), FIRST)).resolves.toMatchObject({
      status: 'queued',
    });
    const list = await s.service.list(jpice());
    expect(list.items.map((r) => r.status)).toEqual(['queued', 'failed']);
  });
});
