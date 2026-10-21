import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_TASK_DOCUMENT_TYPES, type ProjectTaskType } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { memoryLeaderboardStore } from '#src/lib/leaderboard-store';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDemoDataRepository } from '#src/repositories/demo-data.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import type { Db } from '#src/repositories/prisma';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createDemoDataService } from '#src/services/demo-data.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { createAccount, createTaskDocumentTypes, createTestDocument, resetDb } from './db';

/** 2026-10-21, noon in Manila: the 1st semester of 2026-2027. */
export const DEMO_NOW = new Date('2026-10-21T04:00:00Z');

const ASSETS = join(import.meta.dirname, '..', 'prisma', 'seed', 'demo-assets');

/** In-memory object storage: just enough for put, list and delete. */
export function memoryStorage() {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    put: (key: string, body: Buffer) => {
      objects.set(key, body);
      return Promise.resolve();
    },
    delete: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
    list: (prefix: string) =>
      Promise.resolve([...objects.keys()].filter((key) => key.startsWith(prefix))),
  };
}

/**
 * What the normal seed makes that the demo data uses: the ISSC, the CSCs of CCIS, CEA, COM,
 * CoED and CAT, and the CCIS and CEA SBOs, each with its shared account (`without` leaves
 * some SBOs out). Plus a little real data the demo data must never touch.
 */
export async function buildDemoWorld(db: Db, { without = [] as string[] } = {}) {
  await resetDb(db);
  await createTaskDocumentTypes(db);
  const issc = await db.organization.create({
    data: {
      type: 'ISSC',
      slug: 'issc',
      acronym: 'ISSC',
      name: 'Institutional Supreme Student Council',
    },
  });
  const accounts = new Map<string, string>();
  const ids = new Map<string, string>([['issc', issc.id]]);
  accounts.set('issc', (await createAccount(db, 'issc@test.local', issc.id)).id);

  const colleges = { ccis: 'CCIS', cea: 'CEA', com: 'COM', coed: 'CoED', cat: 'CAT' };
  const sbos: Record<string, string[]> = {
    ccis: ['asit', 'tag', 'iso'],
    cea: ['jpice', 'iecep', 'uapsa', 'psme', 'jiiee'],
  };
  for (const [slug, code] of Object.entries(colleges)) {
    const college = await db.college.create({ data: { code, slug, name: `College ${code}` } });
    const csc = await db.organization.create({
      data: {
        type: 'CSC',
        slug: `csc-${slug}`,
        acronym: `CSC-${code}`,
        name: `CSC of ${code}`,
        parentId: issc.id,
        collegeId: college.id,
      },
    });
    ids.set(csc.slug, csc.id);
    accounts.set(csc.slug, (await createAccount(db, `${csc.slug}@test.local`, csc.id)).id);
    for (const sbo of sbos[slug] ?? []) {
      if (without.includes(sbo)) continue;
      const org = await db.organization.create({
        data: {
          type: 'SBO',
          slug: sbo,
          acronym: sbo.toUpperCase(),
          name: `${sbo.toUpperCase()} organization`,
          parentId: csc.id,
          collegeId: college.id,
        },
      });
      ids.set(sbo, org.id);
      accounts.set(sbo, (await createAccount(db, `${sbo}@test.local`, org.id)).id);
    }
  }

  // Real data: a document, a project, a notification, an announcement and an audit entry.
  const type = await db.documentType.findFirstOrThrow({ where: { slug: 'project-proposal' } });
  await createTestDocument(db, {
    organizationId: ids.get('csc-cea')!,
    typeId: type.id,
    title: 'A real CEA proposal',
    status: 'available',
    createdById: accounts.get('csc-cea')!,
  });
  await db.project.create({
    data: {
      organizationId: ids.get('csc-cea')!,
      name: 'A real CEA project',
      targetDate: new Date('2026-12-01T00:00:00Z'),
      location: 'Campus',
      beneficiaries: 'Students',
      description: 'Real',
      proposalDueAt: new Date('2026-11-01T15:59:59Z'),
      postEventDueAt: new Date('2026-12-15T15:59:59Z'),
      createdById: accounts.get('csc-cea')!,
      tasks: { create: [{ type: 'PROPOSAL', status: 'open' }] },
    },
  });
  await db.notification.create({
    data: { userId: accounts.get('asit')!, kind: 'term_ending', title: 'Real', body: 'Real' },
  });
  await db.announcement.create({
    data: {
      organizationId: issc.id,
      authorId: accounts.get('issc')!,
      title: 'A real update',
      body: 'Real',
      publishedAt: new Date('2026-10-01T00:00:00Z'),
    },
  });
  await db.auditLog.create({
    data: { action: 'login', actorId: accounts.get('asit')!, entityType: 'user' },
  });
  await db.leaderboardSnapshot.create({
    data: {
      academicYear: '2025-2026',
      semester: 'second',
      type: 'SBO',
      rows: [],
      computedAt: new Date('2026-05-31T00:00:00Z'),
    },
  });
  return { ids, accounts };
}

/** Row counts of every table the demo data writes to, flagged or not. */
export async function tableCounts(db: Db) {
  return {
    organizations: await db.organization.count(),
    users: await db.user.count(),
    projects: await db.project.count(),
    projectTasks: await db.projectTask.count(),
    documents: await db.document.count(),
    documentVersions: await db.documentVersion.count(),
    financialFigures: await db.financialFigures.count(),
    appeals: await db.appeal.count(),
    freezes: await db.orgFreeze.count(),
    notifications: await db.notification.count(),
    announcements: await db.announcement.count(),
    leaderboardSnapshots: await db.leaderboardSnapshot.count(),
    auditLogs: await db.auditLog.count({ where: { action: { not: 'demo_data_remove' } } }),
  };
}

/** The demo data service on the test database, with in-memory storage, store and cache. */
export function buildDemoService(db: Db, { now = () => DEMO_NOW, showBadge = true } = {}) {
  const storage = memoryStorage();
  const store = memoryLeaderboardStore();
  const audit = createAuditLogRepository(db);
  const changed: string[][] = [];
  const settings = createSystemSettingsService({
    settings: createSystemSettingRepository(db),
    audit,
  });
  const service = createDemoDataService({
    demo: createDemoDataRepository(db),
    standings: createLeaderboardRepository(db),
    settings,
    store,
    storage,
    cache: memoryCache(),
    audit,
    standingsChanged: (dates) => {
      changed.push(dates);
      return Promise.resolve();
    },
    fileFor: (type: ProjectTaskType) =>
      readFileSync(join(ASSETS, `${PROJECT_TASK_DOCUMENT_TYPES[type].slug}.pdf`)),
    showBadge,
    now,
  });
  return { service, storage, store, settings, changed };
}
