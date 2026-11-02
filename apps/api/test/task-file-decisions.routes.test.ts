import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ComplianceOverview,
  DocumentVisibility,
  TaskFileDecisionResponse,
} from '@orghive/shared';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createComplianceOverviewRepository } from '#src/repositories/compliance-overview.repository';
import { createTaskFileDecisionRepository } from '#src/repositories/task-file-decision.repository';
import { createComplianceOverviewService } from '#src/services/compliance-overview.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createTaskFileDecisionService } from '#src/services/task-file-decision.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceWorld, seedProject, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
/** The 1st semester of 2026-2027. */
const NOW = new Date('2026-10-16T00:00:00Z');

let app: ReturnType<typeof buildTestApp>;
let ids: Record<Person, string>;
let orgs: Awaited<ReturnType<typeof buildComplianceWorld>>['orgs'];
const notify = vi.fn((_input: { kind: string; title: string; body: string }) => Promise.resolve());
const forEventDates = vi.fn((_date: Date) => Promise.resolve());

async function as(person: Person) {
  const { token } = await tokens.sign({ userId: ids[person], passwordChangeRequired: false });
  return `Bearer ${token}`;
}

/**
 * A JPICE project whose Project Proposal is filed and checked: its checks warn unless `warn`
 * is false.
 */
async function proposal(visibility: DocumentVisibility, opts: { warn?: boolean } = {}) {
  const project = await seedProject(db, {
    organizationId: orgs.jpice.id,
    createdById: ids.officer,
    createdAt: new Date('2026-10-10T02:00:00Z'),
    targetDate: '2026-11-05',
    name: `Seminar ${crypto.randomUUID().slice(0, 6)}`,
    filed: ['PROPOSAL'],
  });
  const task = await db.projectTask.findFirstOrThrow({
    where: { projectId: project.id, type: 'PROPOSAL' },
    select: { document: { select: { id: true, currentVersionId: true } } },
  });
  const doc = task.document!;
  await db.document.update({ where: { id: doc.id }, data: { visibility } });
  const versionId = doc.currentVersionId!;
  // seedProject wrote its integrity row, as the worker does; add what the checks found.
  await db.integrityCheck.create({
    data: {
      versionId,
      kind: 'keywords',
      result: opts.warn === false ? 'pass' : 'warn',
      message: opts.warn === false ? 'Found every expected word.' : 'Could not find: JPICE.',
    },
  });
  return { projectId: project.id, documentId: doc.id, versionId };
}

const clear = async (
  person: Person,
  documentId: string,
  body: object = { actingAs: 'Ana Reyes' },
) =>
  request(app)
    .post(`/api/v1/task-files/${documentId}/integrity/clear-warnings`)
    .set('Authorization', await as(person))
    .send(body);

const flag = async (
  person: Person,
  documentId: string,
  body: object = { reason: 'The signatures are pasted images.', actingAs: 'Ana Reyes' },
) =>
  request(app)
    .post(`/api/v1/task-files/${documentId}/integrity/flag`)
    .set('Authorization', await as(person))
    .send(body);

beforeAll(async () => {
  const built = await buildComplianceWorld(db);
  ids = built.ids;
  orgs = built.orgs;
  const accounts = createAccountRepository(db);
  const viewers = createDocumentViewerService({ accounts });
  const taskFileDecisions = createTaskFileDecisionService({
    decisions: createTaskFileDecisionRepository(db),
    viewers,
    recipients: { officersOf: () => Promise.resolve([ids.officer]) },
    notifications: { notify },
    audit: createAuditLogRepository(db),
    leaderboard: { forEventDates },
    now: () => NOW,
  });
  app = buildTestApp({
    tokens,
    taskFileDecisions,
    complianceOverview: createComplianceOverviewService({
      overview: createComplianceOverviewRepository(db),
      accounts,
      viewers,
      attention: taskFileDecisions,
      now: () => NOW,
    }),
  });
});

beforeEach(() => {
  notify.mockClear();
  forEventDates.mockClear();
});

describe('POST /task-files/:documentId/integrity/* access', () => {
  it('401s signed out', async () => {
    const { documentId } = await proposal('governing');
    await request(app)
      .post(`/api/v1/task-files/${documentId}/integrity/flag`)
      .send({ reason: 'Pasted signatures.', actingAs: 'Ana Reyes' })
      .expect(401);
    await request(app)
      .post(`/api/v1/task-files/${documentId}/integrity/clear-warnings`)
      .send({ actingAs: 'Ana Reyes' })
      .expect(401);
  });

  it('400s without a reason or an acting-as name', async () => {
    const { documentId } = await proposal('governing');
    expect((await flag('governor', documentId, { reason: 'no', actingAs: 'Ana' })).status).toBe(
      400,
    );
    expect((await clear('governor', documentId, {})).status).toBe(400);
  });

  it('403s the organization itself: it never decides on its own files', async () => {
    const { documentId } = await proposal('governing');
    expect((await flag('officer', documentId)).status).toBe(403);
    expect((await clear('officer', documentId)).status).toBe(403);
  });

  it('403s another college’s CSC, even on a public file', async () => {
    const { documentId } = await proposal('public');
    expect((await flag('catGovernor', documentId)).status).toBe(403);
  });

  it('404s a private file for every governing body: it is never found', async () => {
    const { documentId } = await proposal('private');
    expect((await flag('governor', documentId)).status).toBe(404);
    expect((await clear('isscPresident', documentId)).status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });

  it('404s a document that is not a task file', async () => {
    const doc = await db.document.findFirstOrThrow({
      where: { organizationId: orgs.jpice.id, visibility: 'public', projectTask: null },
      select: { id: true },
    });
    expect((await flag('governor', doc.id)).status).toBe(404);
  });
});

describe('POST /task-files/:documentId/integrity/clear-warnings', () => {
  it('lets the college’s CSC clear the warnings: verified, audited and told', async () => {
    const file = await proposal('governing');
    const res = await clear('governor', file.documentId, {
      note: 'The acronym is in the letterhead image.',
      actingAs: 'Ana Reyes',
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((res.body as TaskFileDecisionResponse).integrity.state).toBe('verified');
    await expect(
      db.versionIntegrity.findUnique({ where: { versionId: file.versionId } }),
    ).resolves.toMatchObject({
      warningsClearedById: ids.governor,
      warningsClearedActingAs: 'Ana Reyes',
      warningsClearedNote: 'The acronym is in the letterhead image.',
    });
    await expect(
      db.auditLog.findFirst({
        where: { action: 'task_file_clear_warnings', entityId: file.documentId },
      }),
    ).resolves.toMatchObject({ actorId: ids.governor, actingAs: 'Ana Reyes' });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_file_checked',
        dedupeKey: `task-file-clear:${file.versionId}`,
      }),
    );
    expect(forEventDates).toHaveBeenCalledWith(new Date('2026-11-05T00:00:00Z'));

    // Already cleared: nothing to clear.
    expect((await clear('governor', file.documentId)).status).toBe(409);
  });

  it('409s a file without warnings', async () => {
    const { documentId } = await proposal('public', { warn: false });
    expect((await clear('isscPresident', documentId)).status).toBe(409);
  });
});

describe('POST /task-files/:documentId/integrity/flag', () => {
  it('lets the ISSC flag a file invalid: it drops from ranking, audited and told', async () => {
    const file = await proposal('public', { warn: false });
    const res = await flag('isscPresident', file.documentId);
    expect(res.status).toBe(200);
    expect((res.body as TaskFileDecisionResponse).integrity).toMatchObject({
      state: 'flagged_invalid',
      reasons: ['The signatures are pasted images.'],
    });
    await expect(
      db.auditLog.findFirst({ where: { action: 'task_file_flag', entityId: file.documentId } }),
    ).resolves.toMatchObject({
      actorId: ids.isscPresident,
      actingAs: 'Ana Reyes',
      organizationId: orgs.jpice.id,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_file_flagged',
        dedupeKey: `task-file-flag:${file.versionId}`,
      }),
    );
    expect(forEventDates).toHaveBeenCalledOnce();

    expect((await flag('governor', file.documentId)).status).toBe(409);
    expect((await clear('governor', file.documentId)).status).toBe(409);
  });
});

describe('GET /compliance/overview: task files needing attention', () => {
  it('lists warned and flagged files the governing body may see, never private ones', async () => {
    const warned = await proposal('governing');
    const flagged = await proposal('public', { warn: false });
    await flag('governor', flagged.documentId);
    const hidden = await proposal('private');
    const fine = await proposal('public', { warn: false });

    const res = await request(app)
      .get('/api/v1/compliance/overview')
      .set('Authorization', await as('governor'));
    const row = (res.body as ComplianceOverview).organizations.find(
      (r) => r.organization.slug === 'jpice',
    )!;
    const listed = row.attentionFiles.map((f) => f.documentId);
    expect(listed).toEqual(expect.arrayContaining([warned.documentId, flagged.documentId]));
    expect(listed).not.toContain(hidden.documentId);
    expect(listed).not.toContain(fine.documentId);
    expect(row.attentionFiles.find((f) => f.documentId === warned.documentId)).toMatchObject({
      projectId: warned.projectId,
      task: 'PROPOSAL',
      label: null,
      integrity: { state: 'needs_attention', reasons: ['Could not find: JPICE.'] },
    });
  });
});
