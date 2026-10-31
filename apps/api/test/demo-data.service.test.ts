import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_STORAGE_PREFIX } from '@orghive/shared';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createCompliance } from '#src/services/compliance.service';
import { demoDataStartAllowed } from '#src/services/demo-guard';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { createNotificationService } from '#src/services/notification.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createRecipients } from '#src/services/recipients.service';
import { createDemoDataRepository } from '#src/repositories/demo-data.repository';
import { memoryLeaderboardStore } from '#src/lib/leaderboard-store';
import { testDb } from './db';
import { buildDemoService, buildDemoWorld, DEMO_NOW, tableCounts } from './demo-fixtures';

const db = testDb();
const SEMESTER = { academicYear: '2026-2027', semester: 'first' as const };

let world: Awaited<ReturnType<typeof buildDemoWorld>>;
beforeEach(async () => {
  world = await buildDemoWorld(db);
});

const slugOf = async (id: string) =>
  (await db.organization.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug;

describe('seed', () => {
  it('ranks ASIT, TAG and ISO #1 to #3 on the SBO board through the real ranking', async () => {
    const { service, settings } = buildDemoService(db);
    const { boards } = await service.seed();
    const sbo = await Promise.all(
      boards.SBO.map(async (r) => [await slugOf(r.organizationId), r] as const),
    );
    expect(sbo.map(([slug, r]) => `#${r.rank} ${slug}`)).toEqual([
      '#1 asit',
      '#2 tag',
      '#3 iso',
      '#4 jpice',
      '#5 iecep',
      '#6 uapsa',
      '#7 psme',
      '#8 jiiee',
    ]);
    const tag = sbo.find(([slug]) => slug === 'tag')![1];
    expect(tag.lateCount).toBe(1);

    // Rows 4 and below moved since the earlier snapshot, both ways.
    const changes = sbo.slice(3).map(([, r]) => r.rankChange);
    expect(changes).toEqual([1, -1, 1, -1, 0]);
    expect(boards.CSC).toHaveLength(5);

    // A fresh read through the real leaderboard service agrees (and keeps the arrows).
    const fresh = await createLeaderboardService({
      leaderboard: createLeaderboardRepository(db),
      settings,
      store: memoryLeaderboardStore(),
      now: () => DEMO_NOW,
    }).compute(SEMESTER);
    expect(fresh.SBO.map((r) => r.organizationId)).toEqual(boards.SBO.map((r) => r.organizationId));
    expect(fresh.SBO.slice(3).map((r) => r.rankChange)).toEqual(changes);
  });

  it('routes every appeal to the deciding account appeal-rules.ts picks', async () => {
    const { service } = buildDemoService(db);
    await service.seed();
    const appeals = await db.appeal.findMany({
      where: { isDemo: true },
      select: {
        type: true,
        status: true,
        remarks: true,
        newDueAt: true,
        organization: { select: { slug: true, parent: { select: { slug: true } } } },
        decidedBy: { select: { organization: { select: { slug: true } } } },
        freeze: { select: { liftedAt: true } },
        project: { select: { status: true, postEventDueOverride: true } },
      },
    });
    const byOrg = Object.fromEntries(appeals.map((a) => [a.organization.slug, a]));
    expect(Object.keys(byOrg).sort()).toEqual(['asit', 'csc-ccis', 'iso', 'tag']);
    // Each goes to its parent organization: CSC-CCIS for the CCIS SBOs, the ISSC for a CSC.
    for (const a of appeals)
      expect(a.organization.parent?.slug).toBe(
        a.organization.slug === 'csc-ccis' ? 'issc' : 'csc-ccis',
      );
    expect(byOrg.asit).toMatchObject({ type: 'PROJECT_BLOCK', status: 'pending', decidedBy: null });
    expect(byOrg.asit!.project.status).toBe('blocked');
    expect(byOrg.tag).toMatchObject({ type: 'PROJECT_BLOCK', status: 'rejected' });
    expect(byOrg.tag!.decidedBy?.organization?.slug).toBe('csc-ccis');
    expect(byOrg.tag!.project.status).toBe('blocked');
    expect(byOrg.iso).toMatchObject({ type: 'ORG_FREEZE', status: 'approved' });
    expect(byOrg.iso!.decidedBy?.organization?.slug).toBe('csc-ccis');
    expect(byOrg.iso!.freeze?.liftedAt).not.toBeNull();
    expect(byOrg.iso!.project.postEventDueOverride).toEqual(byOrg.iso!.newDueAt);
    expect(byOrg.iso!.remarks).toBeTruthy();
    expect(byOrg['csc-ccis']).toMatchObject({ type: 'ORG_FREEZE', status: 'pending' });
    expect(byOrg['csc-ccis']!.freeze?.liftedAt).toBeNull();
  });

  it('leaves nothing for the compliance checks to change: no new blocks, freezes or notices', async () => {
    const { service } = buildDemoService(db);
    const accounts = createAccountRepository(db);
    const sync = createProjectSync({
      projects: createProjectRepository(db),
      compliance: createCompliance({
        freezes: createOrgFreezeRepository(db),
        recipients: createRecipients({ accounts, organizations: createOrganizationRepository(db) }),
        notifications: createNotificationService({
          notifications: createNotificationRepository(db),
          queue: { enqueueEmails: () => Promise.resolve() },
          logger: pino({ level: 'silent' }),
        }),
        audit: createAuditLogRepository(db),
      }),
      now: () => DEMO_NOW,
    });
    // The real project settles first: only the demo data is under test.
    await sync.syncAll();
    await service.seed();
    const before = await tableCounts(db);
    const statuses = await db.project.findMany({ select: { id: true, status: true } });
    expect(await sync.syncAll()).toBeGreaterThan(0);
    expect(await tableCounts(db)).toEqual(before);
    expect(await db.project.findMany({ select: { id: true, status: true } })).toEqual(
      expect.arrayContaining(statuses),
    );
  });

  it('flags every row, stores every file under demo/, and is safe to run twice', async () => {
    const { service, storage } = buildDemoService(db);
    const first = await service.seed();
    const counts = await tableCounts(db);
    const second = await service.seed();
    expect(second.counts).toEqual(first.counts);
    expect(await tableCounts(db)).toEqual(counts);
    expect(first.counts.counts).toMatchObject({
      organizations: 0,
      accounts: 0,
      appeals: 4,
      freezes: 2,
      announcements: 4,
      leaderboardSnapshots: 4,
    });
    const docs = await db.documentVersion.findMany({ where: { isDemo: true } });
    expect(docs.length).toBe(first.counts.counts.documentVersions);
    expect(docs.every((v) => v.storageKey.startsWith(DEMO_STORAGE_PREFIX))).toBe(true);
    expect([...storage.objects.keys()].every((k) => k.startsWith(DEMO_STORAGE_PREFIX))).toBe(true);
    expect(storage.objects.size).toBe(docs.length);
    // Demo notifications count as emailed, so the worker never sends them.
    expect(await db.notification.count({ where: { isDemo: true, emailedAt: null } })).toBe(0);
  });

  it('creates a missing SBO (and its account) as demo data, and removes it again', async () => {
    world = await buildDemoWorld(db, { without: ['uapsa'] });
    const { service } = buildDemoService(db);
    const { counts } = await service.seed();
    expect(counts.counts).toMatchObject({ organizations: 1, accounts: 1 });
    const uapsa = await db.organization.findUniqueOrThrow({ where: { slug: 'uapsa' } });
    expect(uapsa.isDemo).toBe(true);
    await service.remove(null, null);
    expect(await db.organization.findUnique({ where: { slug: 'uapsa' } })).toBeNull();
  });

  it('names the organizations a status read should mark, unless the badge is off', async () => {
    const { service } = buildDemoService(db);
    await service.seed();
    const { organizations } = await service.status();
    expect(organizations).toEqual(
      expect.arrayContaining(['asit', 'tag', 'iso', 'jpice', 'csc-ccis', 'csc-cea']),
    );
    expect(organizations).not.toContain('issc');
    expect(await buildDemoService(db, { showBadge: false }).service.status()).toEqual({
      organizations: [],
    });
  });
});

describe('remove', () => {
  it('leaves no demo row and no demo file, and does not touch real data', async () => {
    const real = await tableCounts(db);
    const { service, storage, changed } = buildDemoService(db);
    await service.seed();
    expect((await tableCounts(db)).projects).toBeGreaterThan(real.projects);

    // Rows the app derives from demo data at runtime go too: a check's notification about a
    // demo project, and a standings snapshot computed while demo data existed.
    const project = await db.project.findFirstOrThrow({ where: { isDemo: true } });
    await db.notification.create({
      data: {
        userId: world.accounts.get('asit')!,
        kind: 'deadline_soon',
        title: 'Derived',
        body: 'Derived',
        link: `/projects/${project.id}`,
        dedupeKey: `deadline-soon:${project.id}:PROPOSAL:x`,
      },
    });
    await db.leaderboardSnapshot.create({
      data: { ...SEMESTER, type: 'SBO', rows: [], computedAt: new Date(DEMO_NOW.getTime() + 1000) },
    });
    storage.objects.set(
      `pages/${(await db.document.findFirstOrThrow({ where: { isDemo: true } })).id}/v/1.webp`,
      Buffer.from('x'),
    );
    // An extra file someone added to a demo project (spec 2C): unflagged, it goes with it.
    const extra = await db.document.create({
      data: {
        organizationId: project.organizationId,
        typeId: (await db.documentType.findFirstOrThrow()).id,
        title: 'Extra file of a demo project',
        academicYear: '2026-2027',
        status: 'available',
        visibility: 'private',
        createdById: project.createdById,
      },
    });
    await db.projectFile.create({ data: { projectId: project.id, documentId: extra.id } });

    const result = await service.remove(null, null);
    expect(await db.projectFile.count()).toBe(0);
    expect(await db.document.findUnique({ where: { id: extra.id } })).toBeNull();
    expect(result.removed.projects).toBeGreaterThan(0);
    expect(result.files).toBeGreaterThan(0);
    expect(await createDemoDataRepository(db).counts()).toEqual(
      Object.fromEntries(Object.keys(result.removed).map((k) => [k, 0])),
    );
    expect(storage.objects.size).toBe(0);
    expect(await tableCounts(db)).toEqual(real);
    // The removed semester gets new standings, and the removal is audited.
    expect(changed.flat()).toContain(project.targetDate.toISOString().slice(0, 10));
    expect(await db.auditLog.count({ where: { action: 'demo_data_remove' } })).toBe(1);
  });

  it('from the console, removes nothing when the total changed since the preview', async () => {
    const { service } = buildDemoService(db);
    await service.seed();
    const { total } = await service.preview();
    const actor = { userId: world.accounts.get('issc')!, ip: '127.0.0.1', userAgent: 'test' };
    await expect(service.remove(actor, total + 1)).rejects.toMatchObject({ status: 409 });
    expect((await service.preview()).total).toBe(total);
    const { removed } = await service.remove(actor, total);
    expect(Object.values(removed).reduce((a, b) => a + b, 0)).toBe(total);
    expect((await service.preview()).total).toBe(0);
  });
});

describe('the production start guard', () => {
  const logger = () => {
    const lines: string[] = [];
    return {
      lines,
      fatal: (_o: object, msg: string) => void lines.push(`fatal ${msg}`),
      warn: (_o: object, msg: string) => void lines.push(`warn ${msg}`),
    };
  };
  const counts = () => createDemoDataRepository(db).counts();

  it('refuses production while demo rows exist, loudly', async () => {
    await buildDemoService(db).service.seed();
    const log = logger();
    expect(
      await demoDataStartAllowed({
        counts,
        nodeEnv: 'production',
        allowDemoData: false,
        logger: log as never,
      }),
    ).toBe(false);
    expect(log.lines[0]).toMatch(/^fatal DEMO DATA PRESENT IN PRODUCTION/);
  });

  it('starts with ALLOW_DEMO_DATA=true (with a warning), outside production, or without demo rows', async () => {
    const log = logger();
    expect(
      await demoDataStartAllowed({
        counts,
        nodeEnv: 'production',
        allowDemoData: false,
        logger: log as never,
      }),
    ).toBe(true);
    await buildDemoService(db).service.seed();
    expect(
      await demoDataStartAllowed({
        counts,
        nodeEnv: 'development',
        allowDemoData: false,
        logger: log as never,
      }),
    ).toBe(true);
    expect(
      await demoDataStartAllowed({
        counts,
        nodeEnv: 'production',
        allowDemoData: true,
        logger: log as never,
      }),
    ).toBe(true);
    expect(log.lines).toEqual([expect.stringMatching(/^warn Demo data present in production/)]);
  });
});
