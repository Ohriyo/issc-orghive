import { beforeAll, describe, expect, it } from 'vitest';
import { createIntegrityRepository } from '#src/repositories/integrity.repository';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';

const db = testDb();
const repo = createIntegrityRepository(db);
let world: World;

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

/** A project of `org` whose ACR holds a clean file with these bytes and page hashes. */
async function acrFile(
  org: 'jpice' | 'psme',
  sha256: string,
  hashes: bigint[],
  projectName = `${org} project ${crypto.randomUUID().slice(0, 6)}`,
) {
  const organization = world.orgs[org];
  const user = org === 'jpice' ? world.users.officer : world.users.psme;
  const project = await db.project.create({
    data: {
      organizationId: organization.id,
      name: projectName,
      targetDate: new Date('2026-11-07T00:00:00Z'),
      location: 'Gym',
      beneficiaries: 'Students',
      description: 'A project.',
      proposalDueAt: new Date('2026-11-01T00:00:00Z'),
      postEventDueAt: new Date('2026-11-21T00:00:00Z'),
      createdById: user.id,
    },
  });
  const doc = await createTestDocument(db, {
    organizationId: organization.id,
    typeId: world.types.report.id,
    title: `ACR: ${projectName}`,
    status: 'available',
    createdById: user.id,
  });
  await db.documentVersion.update({ where: { id: doc.currentVersionId! }, data: { sha256 } });
  await db.projectTask.create({
    data: { projectId: project.id, type: 'ACR', status: 'submitted', documentId: doc.id },
  });
  await db.pageHash.createMany({
    data: hashes.map((hash, i) => ({ versionId: doc.currentVersionId!, page: i + 1, hash })),
  });
  return { project, doc, versionId: doc.currentVersionId! };
}

describe('integrityRepository: duplicates across tasks, projects and organizations', () => {
  it('finds another organization’s task file with the same bytes, never the file’s own', async () => {
    const original = await acrFile('psme', 'a'.repeat(64), [], 'PSME plant visit');
    const copy = await acrFile('jpice', 'a'.repeat(64), []);
    await expect(repo.exactDuplicate('a'.repeat(64), copy.doc.id)).resolves.toEqual({
      versionId: original.versionId,
      documentId: original.doc.id,
      taskType: 'ACR',
      projectName: 'PSME plant visit',
      acronym: 'PSME',
    });
    await expect(repo.exactDuplicate('b'.repeat(64), copy.doc.id)).resolves.toBeNull();
  });

  it('ignores Paperworks documents that are not task files', async () => {
    // world.docs.jpicePublic has sha256 'x…' and belongs to no task.
    const file = await acrFile('jpice', 'c'.repeat(64), []);
    await expect(repo.exactDuplicate('x'.repeat(64), file.doc.id)).resolves.toBeNull();
  });

  it('finds pages within the threshold, nearest first, across organizations', async () => {
    const base = 0x0f0f_0f0f_0f0f_0f0fn;
    const near = await acrFile('psme', 'd'.repeat(64), [base ^ 0b11n], 'PSME seminar');
    await acrFile('jpice', 'e'.repeat(64), [base ^ 0xffffn]); // 16 bits away
    const self = await acrFile('jpice', 'f'.repeat(64), [base]);
    const found = await repo.nearDuplicates([base], self.doc.id, 6);
    expect(found).toEqual([
      expect.objectContaining({
        versionId: near.versionId,
        acronym: 'PSME',
        page: 1,
        distance: 2,
        // Its words, for the service to compare (isNearDuplicate).
        contentText: null,
      }),
    ]);
    await db.document.update({
      where: { id: near.doc.id },
      data: { contentText: 'PSME seminar: what the file says' },
    });
    await expect(repo.nearDuplicates([base], self.doc.id, 6)).resolves.toEqual([
      expect.objectContaining({ contentText: 'PSME seminar: what the file says' }),
    ]);
    // Signed 64-bit hashes (the top bit set) compare too.
    const negative = BigInt.asIntN(64, 0x8000_0000_0000_0001n);
    const neg = await acrFile('psme', '1'.repeat(64), [negative]);
    const probe = await acrFile('jpice', '2'.repeat(64), []);
    await expect(repo.nearDuplicates([negative ^ 1n], probe.doc.id, 6)).resolves.toEqual([
      expect.objectContaining({ versionId: neg.versionId, distance: 1 }),
    ]);
    await expect(repo.nearDuplicates([], probe.doc.id, 6)).resolves.toEqual([]);
  });
});

describe('integrityRepository: results', () => {
  it('replaces a version’s checks and page hashes, and records its code', async () => {
    const file = await acrFile('jpice', '3'.repeat(64), [1n, 2n]);
    const task = await db.projectTask.findFirstOrThrow({ where: { documentId: file.doc.id } });
    const code = await db.taskCode.create({ data: { taskId: task.id, code: 'OH-7K3P-ACR' } });
    const at = new Date('2026-11-20T02:00:00Z');
    await repo.saveResults(file.versionId, {
      checks: [
        { kind: 'format', result: 'pass', message: 'A PDF of 1 page.', details: { pages: 1 } },
        { kind: 'keywords', result: 'warn', message: 'Could not find: TAG.' },
      ],
      pageHashes: [{ page: 2, hash: 9n }],
      taskCodeId: code.id,
      matchedBy: 'qr',
      replacesFlagged: true,
      checkedAt: at,
    });
    // Run again (a retried job): the rows are replaced, not added.
    await repo.saveResults(file.versionId, {
      checks: [{ kind: 'format', result: 'pass', message: 'A PDF of 1 page.' }],
      pageHashes: [{ page: 2, hash: 9n }],
      taskCodeId: code.id,
      matchedBy: 'qr',
      replacesFlagged: true,
      checkedAt: at,
    });
    const stored = await db.documentVersion.findUniqueOrThrow({
      where: { id: file.versionId },
      select: {
        checks: { select: { kind: true, result: true } },
        pageHashes: { select: { page: true, hash: true } },
        integrity: true,
      },
    });
    expect(stored.checks).toEqual([{ kind: 'format', result: 'pass' }]);
    expect(stored.pageHashes).toEqual([{ page: 2, hash: 9n }]);
    expect(stored.integrity).toMatchObject({
      taskCodeId: code.id,
      matchedBy: 'qr',
      replacesFlagged: true,
      checkedAt: at,
      legacy: false,
    });
  });

  it('keeps a typed code for the newest version, and binds a letter’s code once', async () => {
    const file = await acrFile('jpice', '4'.repeat(64), []);
    await repo.recordTypedCode(file.doc.id, 'OH-7K3P-ACR');
    await expect(
      db.versionIntegrity.findUnique({ where: { versionId: file.versionId } }),
    ).resolves.toMatchObject({ typedCode: 'OH-7K3P-ACR' });

    const task = await db.projectTask.findFirstOrThrow({ where: { documentId: file.doc.id } });
    const letter = await db.projectTaskFile.create({
      data: {
        taskId: task.id,
        documentId: world.docs.jpicePrivate.id,
        label: 'Letter to the Dean',
      },
    });
    const code = await db.taskCode.create({
      data: { taskId: task.id, code: 'OH-9ABC-CL', label: 'Letter to the Dean' },
    });
    await repo.bindCode(code.id, letter.id);
    await repo.bindCode(code.id, crypto.randomUUID()); // already bound: unchanged
    await expect(db.taskCode.findUnique({ where: { id: code.id } })).resolves.toMatchObject({
      taskFileId: letter.id,
    });
  });

  it('lists task files stuck waiting for their checks', async () => {
    const file = await acrFile('jpice', '5'.repeat(64), []);
    await db.documentVersion.update({
      where: { id: file.versionId },
      data: { scanStatus: 'checking', processedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await expect(repo.listStuck(new Date('2026-02-01T00:00:00Z'), 10)).resolves.toEqual([
      file.versionId,
    ]);
    await expect(repo.listStuck(new Date('2025-12-01T00:00:00Z'), 10)).resolves.toEqual([]);
  });
});

describe('integrityRepository: the Financial Report totals check', () => {
  it('finds the filed report’s check with what it read, and updates it', async () => {
    const file = await acrFile('jpice', '6'.repeat(64), []);
    await db.projectTask.updateMany({
      where: { documentId: file.doc.id },
      data: { type: 'FINANCIAL_REPORT' },
    });
    const read = { incomeCentavos: 70_000, expensesCentavos: 20_000 };
    await db.integrityCheck.create({
      data: {
        versionId: file.versionId,
        kind: 'financial_totals',
        result: 'warn',
        message: 'Off by more than 5%.',
        details: { read },
      },
    });
    await expect(repo.findFinancialCheck(file.project.id)).resolves.toEqual({
      versionId: file.versionId,
      details: { read },
    });
    await repo.updateCheck(file.versionId, 'financial_totals', {
      result: 'pass',
      message: 'Match.',
    });
    await expect(
      db.integrityCheck.findFirst({
        where: { versionId: file.versionId },
        select: { result: true },
      }),
    ).resolves.toEqual({ result: 'pass' });
    await expect(repo.findFinancialCheck(crypto.randomUUID())).resolves.toBeNull();
  });
});
