import { createHash, randomUUID } from 'node:crypto';
import {
  academicYearOf,
  currentSemesterKey,
  DEMO_STORAGE_PREFIX,
  endOfManilaDay,
  PROJECT_TASK_DOCUMENT_TYPES,
  PROJECT_TASK_LABELS,
  type DemoDataPreview,
  type DemoStatus,
  type ProjectTaskType,
  type RemoveDemoDataResponse,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys, invalidateDocuments } from '#src/lib/cache';
import type { LeaderboardEvents } from '#src/lib/leaderboard-events';
import type { LeaderboardStore } from '#src/lib/leaderboard-store';
import type { Storage } from '#src/lib/storage';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import {
  totalOf,
  type DemoDataRepository,
  type DemoInsert,
  type DemoOrganizationRecord,
} from '#src/repositories/demo-data.repository';
import type { LeaderboardRepository, SnapshotKey } from '#src/repositories/leaderboard.repository';
import { appealDeciderOf } from './appeal-rules';
import {
  DEMO_SBOS,
  demoOverrides,
  planDemoData,
  planDemoProject,
  standingFactsAsOf,
} from './demo-rules';
import { createLeaderboardService, type Boards } from './leaderboard.service';
import type { SystemSettingsService } from './system-settings.service';

export interface DemoDataServiceDeps {
  demo: DemoDataRepository;
  /** The ranking's input, for the demo standings' two snapshots. */
  standings: Pick<LeaderboardRepository, 'standingFacts'>;
  settings: Pick<SystemSettingsService, 'latePoints'>;
  store: LeaderboardStore;
  events?: LeaderboardEvents;
  storage: Pick<Storage, 'put' | 'delete' | 'list'>;
  cache: Pick<Cache, 'getOrSet' | 'deleteMatching' | 'bump'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /**
   * The removed data's semesters need new standings. The API queues them (never rank inside
   * a request); the command line may compute them at once.
   */
  standingsChanged: (eventDates: string[]) => Promise<void>;
  /** The demo PDF for a task's file (watermarked "SAMPLE — DEMO DATA"). */
  fileFor: (type: ProjectTaskType) => Buffer;
  /** The file's text, for search, as the worker extracts it from uploads. */
  textOf?: (pdf: Buffer) => Promise<string | null>;
  /** SHOW_DEMO_BADGE: whether public pages say "Sample data". */
  showBadge: boolean;
  now?: () => Date;
}

/** Who removes the demo data: a super admin in the console, or the command line (null). */
export interface DemoActor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const STATUS_KEY = 'demo:status';
const STATUS_TTL_SECONDS = 60;
/** The officer named on demo uploads ("Acting as"), shown only to the organization. */
const ACTING_AS = 'Sample officer (demo data)';
/** Demo accounts the seed had to create cannot sign in. */
const NO_LOGIN = '!demo-account-without-password';

/** Who sees each demo task file: ACRs are public, so Paperworks pages are not empty. */
const visibilityOf = (type: ProjectTaskType) => (type === 'ACR' ? 'public' : 'governing');

/**
 * Demo data (docs/DEPLOYMENT.md, "Demo data"): `seed` writes the plan of demo-rules.ts onto
 * the existing organizations, every row flagged and every file under demo/; `remove` takes
 * all of it away again, with its files and what the app derived from it. Ranks, blocks,
 * freezes and appeal routing come from the real rules, never from the demo data.
 */
export function createDemoDataService({
  demo,
  standings,
  settings,
  store,
  events,
  storage,
  cache,
  audit,
  standingsChanged,
  fileFor,
  textOf,
  showBadge,
  now = () => new Date(),
}: DemoDataServiceDeps) {
  async function clearCaches(slugs: Iterable<string>) {
    for (const slug of new Set(slugs)) {
      await invalidateDocuments(cache, slug);
      await cache.deleteMatching(cacheKeys.organization(slug));
    }
    await Promise.all([
      cache.deleteMatching(STATUS_KEY),
      cache.deleteMatching('updates:*'),
      cache.deleteMatching(cacheKeys.leaderboardOrganizations()),
    ]);
  }

  /** Deletes the removed rows' files, their page images and anything left under demo/. */
  async function removeFiles(storageKeys: string[], documentIds: string[]): Promise<number> {
    const keys = new Set(storageKeys);
    for (const id of documentIds) {
      for (const key of await storage.list(`pages/${id}/`)) keys.add(key);
    }
    for (const key of await storage.list(DEMO_STORAGE_PREFIX)) keys.add(key);
    for (const key of keys) await storage.delete(key);
    return keys.size;
  }

  async function removeAll(expectedTotal: number | null): Promise<RemoveDemoDataResponse | null> {
    const removal = await demo.remove(expectedTotal);
    if (!removal) return null;
    const files = await removeFiles(removal.storageKeys, removal.documentIds);
    await clearCaches(removal.organizationSlugs);
    if (removal.eventDates.length > 0) await standingsChanged(removal.eventDates);
    return { removed: removal.removed, files };
  }

  /** The organizations the plan needs, creating missing SBOs (and accounts) as demo rows. */
  async function organizationsFor(slugs: string[], rows: DemoInsert) {
    const wanted = [...new Set([...slugs, ...DEMO_SBOS.map((s) => s.parent)])];
    const found = new Map((await demo.organizations(wanted)).map((o) => [o.slug, o]));
    for (const sbo of DEMO_SBOS) {
      if (!slugs.includes(sbo.slug) || found.has(sbo.slug)) continue;
      const parent = found.get(sbo.parent);
      if (!parent) continue;
      const org: DemoOrganizationRecord = {
        id: randomUUID(),
        slug: sbo.slug,
        type: 'SBO',
        acronym: sbo.acronym,
        parentId: parent.id,
        collegeId: parent.collegeId,
        accountId: null,
      };
      rows.organizations.push({
        id: org.id,
        type: 'SBO',
        slug: org.slug,
        acronym: org.acronym,
        name: sbo.name,
        parentId: parent.id,
        collegeId: parent.collegeId,
      });
      found.set(org.slug, org);
    }
    const missing = slugs.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new Error(
        `Demo data needs these organizations: ${missing.join(', ')}. Run pnpm --filter api db:seed first.`,
      );
    }
    // Every organization acts through its shared account; one without gets a demo account.
    for (const org of found.values()) {
      if (org.accountId) continue;
      org.accountId = randomUUID();
      rows.accounts.push({
        id: org.accountId,
        email: `${org.slug}@demo.orghive.local`,
        name: org.acronym,
        organizationId: org.id,
        passwordHash: NO_LOGIN,
        lockedAt: now(),
        lockReason: 'Demo account: no sign-in',
      });
    }
    return found as Map<string, DemoOrganizationRecord & { accountId: string }>;
  }

  async function seed(): Promise<{ counts: DemoDataPreview; boards: Boards }> {
    await removeAll(null);
    const at = now();
    const plan = planDemoData(at);
    const rows: DemoInsert = {
      organizations: [],
      accounts: [],
      projects: [],
      documents: [],
      tasks: [],
      figures: [],
      freezes: [],
      appeals: [],
      notifications: [],
      announcements: [],
      audit: [],
    };
    const orgs = await organizationsFor(plan.organizations, rows);
    const org = (slug: string) => orgs.get(slug)!;
    const typeIds = await demo.documentTypeIds(
      Object.values(PROJECT_TASK_DOCUMENT_TYPES).map((t) => t.slug),
    );
    const texts = new Map<ProjectTaskType, string | null>();
    const overrides = demoOverrides(plan);
    const projectIds = new Map<string, string>();

    for (const project of plan.projects) {
      const owner = org(project.org);
      const id = randomUUID();
      projectIds.set(project.key, id);
      const override = overrides.get(project.key);
      const planned = planDemoProject(project, override, owner.type === 'ISSC', at);
      rows.projects.push({
        id,
        organizationId: owner.id,
        name: project.name,
        targetDate: project.targetDate,
        location: project.location,
        beneficiaries: project.beneficiaries,
        description: project.description,
        status: planned.status,
        proposalDueAt: planned.proposalDueAt,
        postEventDueAt: planned.postEventDueAt,
        proposalDueOverride: override?.proposalDueOverride ?? null,
        postEventDueOverride: override?.postEventDueOverride ?? null,
        nomRequired: project.nomRequired,
        communicationLetterRequired: project.communicationLetterRequired,
        createdById: owner.accountId,
        createdAt: project.createdAt,
      });

      for (const task of planned.tasks) {
        const submittedAt = project.submitted[task.type] ?? null;
        let documentId: string | null = null;
        if (submittedAt) {
          documentId = randomUUID();
          const body = fileFor(task.type);
          if (!texts.has(task.type)) texts.set(task.type, (await textOf?.(body)) ?? null);
          const storageKey = `${DEMO_STORAGE_PREFIX}files/${owner.id}/${documentId}.pdf`;
          await storage.put(storageKey, body, 'application/pdf');
          const typeSlug = PROJECT_TASK_DOCUMENT_TYPES[task.type].slug;
          const typeId = typeIds.get(typeSlug);
          if (!typeId) throw new Error(`Document type ${typeSlug} is missing; run the migrations`);
          rows.documents.push({
            id: documentId,
            organizationId: owner.id,
            typeId,
            title: `${PROJECT_TASK_LABELS[task.type]}: ${project.name}`,
            academicYear: academicYearOf(project.targetDate),
            visibility: visibilityOf(task.type),
            contentText: texts.get(task.type) ?? null,
            createdById: owner.accountId,
            createdAt: submittedAt,
            version: {
              id: randomUUID(),
              storageKey,
              originalFilename: `${typeSlug}-sample.pdf`,
              sizeBytes: body.length,
              sha256: createHash('sha256').update(body).digest('hex'),
              actingAs: ACTING_AS,
              createdAt: submittedAt,
            },
          });
        }
        rows.tasks.push({
          projectId: id,
          type: task.type,
          status: task.status,
          dueAt: task.dueAt,
          documentId,
          submittedAt,
        });
      }
      if (project.figures) {
        rows.figures.push({
          projectId: id,
          ...project.figures,
          createdAt: project.submitted.FINANCIAL_REPORT ?? project.createdAt,
        });
      }
    }

    const freezeIds = new Map<string, string>();
    for (const freeze of plan.freezes) {
      const id = randomUUID();
      freezeIds.set(freeze.key, id);
      const project = plan.projects.find((p) => p.key === freeze.project)!;
      rows.freezes.push({
        id,
        organizationId: org(project.org).id,
        projectId: projectIds.get(freeze.project)!,
        reports: freeze.reports,
        frozenAt: freeze.frozenAt,
        liftedAt: freeze.liftedAt,
      });
    }

    const appealIds = new Map<string, string>();
    for (const appeal of plan.appeals) {
      const project = plan.projects.find((p) => p.key === appeal.project)!;
      const appellant = org(project.org);
      // Routed by the real rule; the plan only says where it expects it to go.
      const decider = appealDeciderOf(appellant);
      if (decider?.organizationId !== org(appeal.decider).id) {
        throw new Error(`The ${appellant.slug} appeal would not go to ${appeal.decider}`);
      }
      const id = randomUUID();
      appealIds.set(appeal.key, id);
      rows.appeals.push({
        id,
        type: appeal.type,
        organizationId: appellant.id,
        projectId: projectIds.get(appeal.project)!,
        freezeId: appeal.freeze ? freezeIds.get(appeal.freeze)! : null,
        reason: appeal.reason,
        status: appeal.status,
        submittedById: appellant.accountId,
        decidedById: appeal.status === 'pending' ? null : org(appeal.decider).accountId,
        remarks: appeal.remarks,
        newDueAt: appeal.newDueDate ? endOfManilaDay(appeal.newDueDate) : null,
        decidedAt: appeal.decidedAt,
        createdAt: appeal.createdAt,
      });
    }

    plan.notifications.forEach((n, i) => {
      const userId = org(n.org).accountId;
      rows.notifications.push({
        userId,
        kind: n.kind,
        title: n.title,
        body: n.body,
        link: n.project ? `/projects/${projectIds.get(n.project)}` : (n.link ?? null),
        dedupeKey: `demo:${i}:${userId}`,
        readAt: n.read ? new Date(n.createdAt.getTime() + 60 * 60_000) : null,
        createdAt: n.createdAt,
      });
    });

    for (const a of plan.announcements) {
      rows.announcements.push({
        organizationId: org(a.org).id,
        authorId: org(a.org).accountId,
        title: a.title,
        body: a.body,
        publishedAt: a.publishedAt,
      });
    }

    for (const entry of plan.audit) {
      const entity =
        'project' in entry.entity
          ? { entityType: 'project', entityId: projectIds.get(entry.entity.project)! }
          : 'freeze' in entry.entity
            ? { entityType: 'org_freeze', entityId: freezeIds.get(entry.entity.freeze)! }
            : { entityType: 'appeal', entityId: appealIds.get(entry.entity.appeal)! };
      rows.audit.push({
        action: entry.action,
        actorId: entry.actor ? org(entry.actor).accountId : null,
        ...entity,
        organizationId: org(entry.org).id,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      });
    }

    await demo.insert(rows);

    // Two snapshots through the real leaderboard service: the boards a week ago (only what
    // was submitted by then), then now. The arrows of the second compare against the first.
    const semester = currentSemesterKey(at);
    const snapshots = {
      latestSnapshot: (key: SnapshotKey) => demo.latestDemoSnapshot(key),
      saveSnapshot: (key: SnapshotKey, rows: readonly object[], when: Date) =>
        demo.saveDemoSnapshot(key, rows, when),
    };
    await createLeaderboardService({
      leaderboard: {
        ...snapshots,
        standingFacts: async (range) =>
          standingFactsAsOf(await standings.standingFacts(range), plan.previousStandingsAt),
      },
      settings,
      store,
      now: () => plan.previousStandingsAt,
    }).compute(semester);
    const boards = await createLeaderboardService({
      leaderboard: { ...snapshots, standingFacts: (range) => standings.standingFacts(range) },
      settings,
      store,
      events,
      now: () => at,
    }).compute(semester);

    await clearCaches(plan.organizations);
    const counts = await demo.counts();
    return { counts: { total: totalOf(counts), counts }, boards };
  }

  return {
    seed,

    async preview(): Promise<DemoDataPreview> {
      const counts = await demo.counts();
      return { total: totalOf(counts), counts };
    },

    /**
     * Removes every demo row and file. From the console, only if the flagged total is still
     * what the preview showed (409 otherwise), and audited; the command line passes null.
     */
    async remove(
      actor: DemoActor | null,
      expectedTotal: number | null,
    ): Promise<RemoveDemoDataResponse> {
      const result = await removeAll(expectedTotal);
      if (!result) {
        throw AppError.conflict('The demo data changed since the preview. Review it again.');
      }
      await audit.record({
        action: 'demo_data_remove',
        actorId: actor?.userId ?? null,
        entityType: 'demo_data',
        metadata: { removed: result.removed, files: result.files, via: actor ? 'console' : 'cli' },
        ip: actor?.ip ?? null,
        userAgent: actor?.userAgent ?? null,
      });
      return result;
    },

    /** Which public pages carry the "Sample data" chip (cached for a minute). */
    async status(): Promise<DemoStatus> {
      if (!showBadge) return { organizations: [] };
      const organizations = await cache.getOrSet(STATUS_KEY, STATUS_TTL_SECONDS, () =>
        demo.organizationSlugs(),
      );
      return { organizations: organizations ?? [] };
    },
  };
}

export type DemoDataService = ReturnType<typeof createDemoDataService>;
