import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONSTITUTION_DOCUMENT_TYPE,
  type OrgShowcase,
  type ProjectTaskType,
  type SemesterKey,
} from '@orghive/shared';
import { cacheKeys, invalidateDocuments, memoryCache } from '#src/lib/cache';
import { createOrgShowcaseRepository } from '#src/repositories/org-showcase.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import type { LeaderboardRow } from '#src/services/leaderboard.service';
import { createOrgShowcaseService } from '#src/services/org-showcase.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
let world: World;
let cache: ReturnType<typeof memoryCache>;
let app: ReturnType<typeof buildTestApp>;
let boards: Partial<Record<'SBO' | 'CSC', Partial<LeaderboardRow>[]>>;
const board = vi.fn((_semester: SemesterKey, type: 'SBO' | 'CSC') =>
  Promise.resolve((boards[type] ?? []) as LeaderboardRow[]),
);
const clock = new Date('2026-11-07T02:00:00Z');

function read(slug: string) {
  return request(app).get(`/api/v1/organizations/${slug}/showcase`);
}

function build() {
  cache = memoryCache();
  const service = createOrgShowcaseService({
    showcase: createOrgShowcaseRepository(db),
    leaderboard: {
      board,
      meta: () =>
        Promise.resolve({ status: 'provisional', provisionalUntil: '2026-12-27', latePoints: 0.5 }),
    },
    cache,
    now: () => clock,
  });
  app = buildTestApp({ showcase: service });
  return service;
}

async function project(
  organizationId: string,
  name: string,
  targetDate: string,
  extra: { status?: 'active' | 'completed' | 'blocked'; deleted?: boolean } = {},
) {
  return db.project.create({
    data: {
      organizationId,
      name,
      targetDate: new Date(targetDate),
      location: 'CEA Building',
      beneficiaries: 'Civil engineering students',
      description: 'A project.',
      status: extra.status ?? 'completed',
      proposalDueAt: new Date(targetDate),
      postEventDueAt: new Date(targetDate),
      createdById: world.users.officer.id,
      deletedAt: extra.deleted ? new Date() : null,
    },
  });
}

async function taskFile(
  projectId: string,
  type: ProjectTaskType,
  title: string,
  visibility: 'public' | 'governing' | 'private',
  label?: string,
) {
  const doc = await createTestDocument(db, {
    organizationId: world.orgs.jpice.id,
    typeId: world.types.report.id,
    title,
    status: 'available',
    visibility,
    createdById: world.users.officer.id,
  });
  const task = await db.projectTask.upsert({
    where: { projectId_type: { projectId, type } },
    create: { projectId, type, status: 'submitted', ...(label ? {} : { documentId: doc.id }) },
    update: label ? {} : { documentId: doc.id },
  });
  if (label) await db.projectTaskFile.create({ data: { taskId: task.id, documentId: doc.id, label } });
  return doc;
}

beforeAll(() => {
  build();
});

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  build();
  boards = {};
  board.mockClear();
});

describe('GET /organizations/:slug/showcase', () => {
  it('is public, cached for everyone, and 404s for an unknown organization', async () => {
    const res = await read('jpice').expect(200);
    expect(res.headers['cache-control']).toContain('public');
    await read('nope').expect(404);
  });

  it('lists completed projects by semester with only their public task files', async () => {
    const ceWeek = await project(world.orgs.jpice.id, 'CE Week 2026', '2026-09-15');
    const proposal = await taskFile(ceWeek.id, 'PROPOSAL', 'CE Week proposal', 'public');
    const acr = await taskFile(ceWeek.id, 'ACR', 'CE Week ACR', 'private');
    const letter = await taskFile(ceWeek.id, 'COMMUNICATION_LETTER', 'Mayor letter', 'public', 'To the mayor');
    const dean = await taskFile(ceWeek.id, 'COMMUNICATION_LETTER', 'Dean letter', 'governing', 'To the dean');
    await project(world.orgs.jpice.id, 'Mock review', '2026-03-02');
    await project(world.orgs.jpice.id, 'Still running', '2026-10-01', { status: 'active' });
    await project(world.orgs.jpice.id, 'Deleted', '2026-09-01', { deleted: true });
    await project(world.orgs.psme.id, 'PSME plant visit', '2026-09-20');

    const body = (await read('jpice').expect(200)).body as OrgShowcase;

    expect(
      body.projectSemesters.map((s) => [s.academicYear, s.semester, s.projects.map((p) => p.title)]),
    ).toEqual([
      ['2026-2027', 'first', ['CE Week 2026']],
      ['2025-2026', 'second', ['Mock review']],
    ]);
    const [first] = body.projectSemesters[0]!.projects;
    expect(first).toMatchObject({
      date: '2026-09-15',
      location: 'CEA Building',
      beneficiaries: 'Civil engineering students',
      files: [
        { documentId: proposal.id, label: 'Project Proposal' },
        { documentId: letter.id, label: 'To the mayor' },
      ],
    });
    expect(body.projectSemesters[1]!.projects[0]!.files).toEqual([]);
    const text = JSON.stringify(body);
    for (const hidden of [acr, dean, world.docs.jpicePrivate, world.docs.jpiceGoverning]) {
      expect(text).not.toContain(hidden.id);
    }
  });

  it('shows the same to the owner as to anyone', async () => {
    const ceWeek = await project(world.orgs.jpice.id, 'CE Week 2026', '2026-09-15');
    const acr = await taskFile(ceWeek.id, 'ACR', 'CE Week ACR', 'private');
    const service = build();
    const asOwner = await service.read('jpice');
    expect(JSON.stringify(asOwner)).not.toContain(acr.id);
  });

  it('lists the newest public documents without the constitution, and counts them all', async () => {
    const constitutionType = await db.documentType.create({ data: CONSTITUTION_DOCUMENT_TYPE });
    await createTestDocument(db, {
      organizationId: world.orgs.jpice.id,
      typeId: constitutionType.id,
      title: 'Constitution & By-laws',
      status: 'available',
      createdById: world.users.officer.id,
    });
    const body = (await read('jpice').expect(200)).body as OrgShowcase;
    expect(body.documents.map((d) => d.title)).toEqual(['JPICE accomplishment report']);
    expect(body.documents[0]).toMatchObject({ typeName: 'Accomplishment report' });
    // The report and the constitution; never the governing, private, scanning or deleted ones.
    expect(body.publicDocumentCount).toBe(2);
  });

  it('shows a top-10 rank on the organization’s own board, never the ISSC’s', async () => {
    boards = {
      SBO: [{ organizationId: world.orgs.psme.id, rank: 1 }, { organizationId: world.orgs.jpice.id, rank: 3 }],
      CSC: [{ organizationId: world.orgs.cscCea.id, rank: 12 }],
    };
    expect(((await read('jpice')).body as OrgShowcase).rank).toEqual({
      board: 'SBO',
      rank: 3,
      academicYear: '2026-2027',
      semester: 'first',
      status: 'provisional',
    });
    expect(((await read('csc-cea')).body as OrgShowcase).rank).toBeNull();
    board.mockClear();
    expect(((await read('issc')).body as OrgShowcase).rank).toBeNull();
    expect(board).not.toHaveBeenCalled();
  });

  it('serves the cache until a document write or a completed project clears it', async () => {
    const before = (await read('jpice')).body as OrgShowcase;
    expect(before.projectSemesters).toEqual([]);
    await project(world.orgs.jpice.id, 'CE Week 2026', '2026-09-15');
    expect(((await read('jpice')).body as OrgShowcase).projectSemesters).toEqual([]);

    await invalidateDocuments(cache, 'jpice');
    expect(((await read('jpice')).body as OrgShowcase).projectSemesters).toHaveLength(1);

    // A project the sync completes clears it too; one that stays open leaves it.
    const key = cacheKeys.organizationShowcase('jpice');
    const open = await project(world.orgs.jpice.id, 'Fun run', '2026-10-20', { status: 'active' });
    const sync = createProjectSync({ projects: createProjectRepository(db), cache, now: () => clock });
    await read('jpice');
    await sync.sync(open.id);
    expect(cache.store.has(key)).toBe(true);
    for (const type of ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'] as const) {
      await taskFile(open.id, type, `Fun run ${type}`, 'public');
    }
    expect((await sync.sync(open.id))?.status).toBe('completed');
    expect(cache.store.has(key)).toBe(false);
  });
});
