import type { DemoDataCounts } from '@orghive/shared';
import type {
  AppealStatus,
  AppealType,
  AuditAction,
  DocumentVisibility,
  NotificationKind,
  OrganizationType,
  Prisma,
  ProjectStatus,
  ProjectTaskStatus,
  ProjectTaskType,
} from '#src/generated/prisma/client';
import type { SnapshotKey, SnapshotRecord } from './leaderboard.repository';
import type { Db } from './prisma';

/*
 * Demo data (docs/DEPLOYMENT.md, "Demo data"). Every row written here gets is_demo = true,
 * and removal deletes exactly those rows plus what the app derived from them at runtime
 * (task rows the checks added, notifications and audit entries about demo projects, the
 * standings computed while demo data existed). Real rows are never touched.
 */

type Client = Prisma.TransactionClient | Db;

/** Rows by kind, in DEMO_DATA_KINDS order. */
async function countDemo(db: Client): Promise<DemoDataCounts> {
  const where = { isDemo: true };
  const [
    organizations,
    accounts,
    projects,
    projectTasks,
    projectTaskFiles,
    documents,
    documentVersions,
    financialFigures,
    appeals,
    freezes,
    notifications,
    announcements,
    leaderboardSnapshots,
    auditLogs,
  ] = await Promise.all([
    db.organization.count({ where }),
    db.user.count({ where }),
    db.project.count({ where }),
    db.projectTask.count({ where }),
    db.projectTaskFile.count({ where }),
    db.document.count({ where }),
    db.documentVersion.count({ where }),
    db.financialFigures.count({ where }),
    db.appeal.count({ where }),
    db.orgFreeze.count({ where }),
    db.notification.count({ where }),
    db.announcement.count({ where }),
    db.leaderboardSnapshot.count({ where }),
    db.auditLog.count({ where }),
  ]);
  return {
    organizations,
    accounts,
    projects,
    projectTasks,
    projectTaskFiles,
    documents,
    documentVersions,
    financialFigures,
    appeals,
    freezes,
    notifications,
    announcements,
    leaderboardSnapshots,
    auditLogs,
  };
}

export const totalOf = (counts: DemoDataCounts) =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** An organization the demo data uses, with its active shared account. */
export interface DemoOrganizationRecord {
  id: string;
  slug: string;
  type: OrganizationType;
  acronym: string;
  parentId: string | null;
  collegeId: string | null;
  accountId: string | null;
}

/*
 * What the service writes. Ids are chosen by the service so rows can refer to each other;
 * the repository adds is_demo to every one.
 */
export interface DemoInsert {
  organizations: {
    id: string;
    type: OrganizationType;
    slug: string;
    acronym: string;
    name: string;
    parentId: string;
    collegeId: string | null;
  }[];
  accounts: {
    id: string;
    email: string;
    name: string;
    organizationId: string;
    passwordHash: string;
    lockedAt: Date;
    lockReason: string;
  }[];
  projects: {
    id: string;
    organizationId: string;
    name: string;
    targetDate: string;
    location: string;
    beneficiaries: string;
    description: string;
    status: ProjectStatus;
    proposalDueAt: Date;
    postEventDueAt: Date;
    proposalDueOverride: Date | null;
    postEventDueOverride: Date | null;
    nomRequired: boolean;
    communicationLetterRequired: boolean;
    createdById: string;
    createdAt: Date;
  }[];
  documents: {
    id: string;
    organizationId: string;
    typeId: string;
    title: string;
    academicYear: string;
    visibility: DocumentVisibility;
    contentText: string | null;
    createdById: string;
    createdAt: Date;
    version: {
      id: string;
      storageKey: string;
      originalFilename: string;
      sizeBytes: number;
      sha256: string;
      actingAs: string;
      createdAt: Date;
    };
  }[];
  tasks: {
    projectId: string;
    type: ProjectTaskType;
    status: ProjectTaskStatus;
    dueAt: Date | null;
    documentId: string | null;
    submittedAt: Date | null;
  }[];
  figures: {
    projectId: string;
    incomeCentavos: number;
    expensesCentavos: number;
    createdAt: Date;
  }[];
  freezes: {
    id: string;
    organizationId: string;
    projectId: string;
    reports: ProjectTaskType[];
    frozenAt: Date;
    liftedAt: Date | null;
  }[];
  appeals: {
    id: string;
    type: AppealType;
    organizationId: string;
    projectId: string;
    freezeId: string | null;
    reason: string;
    status: AppealStatus;
    submittedById: string;
    decidedById: string | null;
    remarks: string | null;
    newDueAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
  }[];
  notifications: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    link: string | null;
    dedupeKey: string;
    readAt: Date | null;
    createdAt: Date;
  }[];
  announcements: {
    organizationId: string;
    authorId: string;
    title: string;
    body: string;
    publishedAt: Date;
  }[];
  audit: {
    action: AuditAction;
    actorId: string | null;
    entityType: string;
    entityId: string;
    organizationId: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
  }[];
}

/** What removal took away, for the service to clean storage and caches after the commit. */
export interface DemoRemoval {
  /** Flagged rows, by kind, as they were just before. */
  removed: DemoDataCounts;
  /** Every stored file of the removed documents and appeal attachments, and thumbnails. */
  storageKeys: string[];
  /** The removed documents: their page images live under pages/{id}/. */
  documentIds: string[];
  /** Organizations whose cached pages and document lists showed demo data. */
  organizationSlugs: string[];
  /** Event dates of the removed projects: the semesters whose standings change. */
  eventDates: string[];
}

/** The longest an insert or removal may take: hundreds of small rows, one transaction. */
const TRANSACTION = { timeout: 60_000, maxWait: 10_000 };

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function createDemoDataRepository(db: Db) {
  return {
    counts: (): Promise<DemoDataCounts> => countDemo(db),

    /** The organizations by slug (undeleted), each with its active shared account. */
    async organizations(slugs: string[]): Promise<DemoOrganizationRecord[]> {
      const rows = await db.organization.findMany({
        where: { slug: { in: slugs }, deletedAt: null },
        select: {
          id: true,
          slug: true,
          type: true,
          acronym: true,
          parentId: true,
          collegeId: true,
          accounts: { where: { disabledAt: null }, select: { id: true }, take: 1 },
        },
      });
      return rows.map(({ accounts, ...org }) => ({ ...org, accountId: accounts[0]?.id ?? null }));
    },

    /** Document type ids by slug. */
    async documentTypeIds(slugs: string[]): Promise<Map<string, string>> {
      const rows = await db.documentType.findMany({
        where: { slug: { in: slugs } },
        select: { id: true, slug: true },
      });
      return new Map(rows.map((r) => [r.slug, r.id]));
    },

    /** Slugs of the SBOs and CSCs whose public pages show demo data. */
    async organizationSlugs(): Promise<string[]> {
      const rows = await db.organization.findMany({
        where: {
          deletedAt: null,
          type: { in: ['SBO', 'CSC'] },
          OR: [{ isDemo: true }, { projects: { some: { isDemo: true, deletedAt: null } } }],
        },
        orderBy: { slug: 'asc' },
        select: { slug: true },
      });
      return rows.map((r) => r.slug);
    },

    /** Writes the demo data in one transaction, every row flagged. */
    async insert(rows: DemoInsert): Promise<void> {
      const isDemo = true;
      await db.$transaction(async (tx) => {
        await tx.organization.createMany({
          data: rows.organizations.map((r) => ({ ...r, isDemo })),
        });
        await tx.user.createMany({
          data: rows.accounts.map((r) => ({ ...r, mustChangePassword: true, isDemo })),
        });
        await tx.project.createMany({
          data: rows.projects.map((r) => ({ ...r, targetDate: asDate(r.targetDate), isDemo })),
        });
        await tx.document.createMany({
          data: rows.documents.map(({ version: _version, ...r }) => ({
            ...r,
            status: 'available' as const,
            isDemo,
          })),
        });
        await tx.documentVersion.createMany({
          data: rows.documents.map((d) => ({
            ...d.version,
            documentId: d.id,
            version: 1,
            mimeType: 'application/pdf',
            // Generated locally, known to be clean: no scan, as the normal seed does.
            scanStatus: 'clean' as const,
            processedAt: d.version.createdAt,
            uploadedById: d.createdById,
            isDemo,
          })),
        });
        await tx.$executeRaw`
          UPDATE documents d SET current_version_id = v.id
          FROM document_versions v
          WHERE v.document_id = d.id AND d.is_demo AND d.current_version_id IS NULL`;
        await tx.projectTask.createMany({ data: rows.tasks.map((r) => ({ ...r, isDemo })) });
        await tx.financialFigures.createMany({ data: rows.figures.map((r) => ({ ...r, isDemo })) });
        await tx.orgFreeze.createMany({ data: rows.freezes.map((r) => ({ ...r, isDemo })) });
        await tx.appeal.createMany({ data: rows.appeals.map((r) => ({ ...r, isDemo })) });
        await tx.notification.createMany({
          // Already "emailed": demo notifications never reach anyone's inbox.
          data: rows.notifications.map((r) => ({ ...r, emailedAt: r.createdAt, isDemo })),
        });
        await tx.announcement.createMany({
          data: rows.announcements.map((r) => ({ ...r, createdAt: r.publishedAt, isDemo })),
        });
        await tx.auditLog.createMany({
          data: rows.audit.map((r) => ({
            ...r,
            metadata: r.metadata as Prisma.InputJsonValue,
            isDemo,
          })),
        });
      }, TRANSACTION);
    },

    /** The newest demo snapshot of a board: what the demo standings' arrows compare against. */
    latestDemoSnapshot(key: SnapshotKey): Promise<SnapshotRecord | null> {
      return db.leaderboardSnapshot.findFirst({
        where: { ...key, isDemo: true },
        orderBy: { computedAt: 'desc' },
        select: { rows: true, computedAt: true },
      });
    },

    async saveDemoSnapshot(key: SnapshotKey, rows: readonly object[], at: Date): Promise<void> {
      await db.leaderboardSnapshot.create({
        data: { ...key, rows, computedAt: at, isDemo: true },
      });
    },

    /**
     * Deletes every demo row, in foreign-key order, and what the app derived from them, in one
     * transaction. With `expectedTotal` (the console's preview), nothing is deleted and null
     * returned when the flagged total changed since.
     */
    async remove(expectedTotal: number | null): Promise<DemoRemoval | null> {
      return db.$transaction(async (tx) => {
        const removed = await countDemo(tx);
        if (expectedTotal !== null && totalOf(removed) !== expectedTotal) return null;
        const flagged = { isDemo: true };
        const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

        const orgIds = ids(
          await tx.organization.findMany({ where: flagged, select: { id: true } }),
        );
        const userIds = ids(await tx.user.findMany({ where: flagged, select: { id: true } }));
        const projects = await tx.project.findMany({
          where: { OR: [flagged, { organizationId: { in: orgIds } }] },
          select: { id: true, targetDate: true, organization: { select: { slug: true } } },
        });
        const projectIds = ids(projects);
        // Task rows the checks added to a demo project carry no flag, so go by project too.
        const tasks = await tx.projectTask.findMany({
          where: { OR: [flagged, { projectId: { in: projectIds } }] },
          select: { id: true, documentId: true },
        });
        const taskIds = ids(tasks);
        const taskFiles = await tx.projectTaskFile.findMany({
          where: { OR: [flagged, { taskId: { in: taskIds } }] },
          select: { documentId: true },
        });
        const taskDocIds = [
          ...tasks.flatMap((t) => (t.documentId ? [t.documentId] : [])),
          ...taskFiles.map((f) => f.documentId),
        ];

        // Standings computed while demo data existed include it: those of the demo
        // semesters since the demo seed (its newest snapshot) go too.
        const demoSnapshots = await tx.leaderboardSnapshot.findMany({
          where: flagged,
          select: { academicYear: true, semester: true, computedAt: true },
        });
        const seededAt = demoSnapshots.reduce<Date | null>(
          (latest, s) => (!latest || s.computedAt > latest ? s.computedAt : latest),
          null,
        );
        const semesters = [
          ...new Map(
            demoSnapshots.map((s) => [`${s.academicYear}:${s.semester}`, s] as const),
          ).values(),
        ];
        // Semestral End Reports compiled from demo files since the seed.
        const projectOrgIds = await tx.project.findMany({
          where: { id: { in: projectIds } },
          distinct: ['organizationId'],
          select: { organizationId: true },
        });
        const reports = seededAt
          ? await tx.semestralReport.findMany({
              where: {
                organizationId: { in: projectOrgIds.map((p) => p.organizationId) },
                createdAt: { gte: seededAt },
              },
              select: { id: true, documentId: true },
            })
          : [];
        const reportDocIds = reports.flatMap((r) => (r.documentId ? [r.documentId] : []));

        const documents = await tx.document.findMany({
          where: {
            OR: [
              flagged,
              { id: { in: [...taskDocIds, ...reportDocIds] } },
              { organizationId: { in: orgIds } },
            ],
          },
          select: { id: true, organization: { select: { slug: true } } },
        });
        const documentIds = ids(documents);
        const versions = await tx.documentVersion.findMany({
          where: { OR: [flagged, { documentId: { in: documentIds } }] },
          select: { id: true, storageKey: true, thumbnailKey: true },
        });
        const appeals = ids(
          await tx.appeal.findMany({
            where: { OR: [flagged, { projectId: { in: projectIds } }] },
            select: { id: true },
          }),
        );
        const freezes = ids(
          await tx.orgFreeze.findMany({
            where: { OR: [flagged, { projectId: { in: projectIds } }] },
            select: { id: true },
          }),
        );
        const attachments = await tx.appealAttachment.findMany({
          where: { OR: [{ appealId: { in: appeals } }, { organizationId: { in: orgIds } }] },
          select: { id: true, storageKey: true },
        });
        const announcementOrgs = await tx.announcement.findMany({
          where: flagged,
          select: { organization: { select: { slug: true } } },
        });

        // Notifications point at what they are about through their link or dedupe key.
        const referenced = [...projectIds, ...appeals, ...freezes];
        await tx.notification.deleteMany({
          where: {
            OR: [
              flagged,
              { userId: { in: userIds } },
              ...referenced.flatMap((id) => [
                { link: { contains: id } },
                { dedupeKey: { contains: id } },
              ]),
            ],
          },
        });
        await tx.appealAttachment.deleteMany({ where: { id: { in: ids(attachments) } } });
        await tx.appeal.deleteMany({ where: { id: { in: appeals } } });
        await tx.orgFreeze.deleteMany({ where: { id: { in: freezes } } });
        await tx.financialFigures.deleteMany({
          where: { OR: [flagged, { projectId: { in: projectIds } }] },
        });
        await tx.projectTaskFile.deleteMany({
          where: { OR: [flagged, { taskId: { in: taskIds } }] },
        });
        await tx.projectTask.deleteMany({ where: { id: { in: taskIds } } });
        await tx.semestralReport.deleteMany({ where: { id: { in: ids(reports) } } });
        await tx.document.updateMany({
          where: { id: { in: documentIds } },
          data: { currentVersionId: null },
        });
        await tx.organization.updateMany({
          where: { constitutionDocumentId: { in: documentIds } },
          data: { constitutionDocumentId: null },
        });
        await tx.documentPageText.deleteMany({
          where: { versionId: { in: ids(versions) } },
        });
        await tx.documentVersion.deleteMany({ where: { id: { in: ids(versions) } } });
        await tx.document.deleteMany({ where: { id: { in: documentIds } } });
        await tx.project.deleteMany({ where: { id: { in: projectIds } } });
        await tx.announcement.deleteMany({
          where: { OR: [flagged, { organizationId: { in: orgIds } }] },
        });
        await tx.leaderboardSnapshot.deleteMany({
          where: {
            OR: [
              flagged,
              ...(seededAt
                ? semesters.map((s) => ({
                    academicYear: s.academicYear,
                    semester: s.semester,
                    computedAt: { gte: seededAt },
                  }))
                : []),
            ],
          },
        });
        await tx.auditLog.deleteMany({
          where: {
            OR: [
              flagged,
              { actorId: { in: userIds } },
              { organizationId: { in: orgIds } },
              { entityId: { in: [...referenced, ...documentIds] } },
            ],
          },
        });
        // The demo accounts and organizations, with what hangs off them.
        await tx.officerTerm.deleteMany({ where: { userId: { in: userIds } } });
        await tx.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
        await tx.uploadIntent.deleteMany({
          where: { OR: [{ userId: { in: userIds } }, { organizationId: { in: orgIds } }] },
        });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.organizationOfficer.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organizationLink.deleteMany({ where: { organizationId: { in: orgIds } } });
        await tx.organization.deleteMany({ where: { id: { in: orgIds } } });

        return {
          removed,
          storageKeys: [
            ...versions.flatMap((v) => [v.storageKey, ...(v.thumbnailKey ? [v.thumbnailKey] : [])]),
            ...attachments.map((a) => a.storageKey),
          ],
          documentIds,
          organizationSlugs: [
            ...new Set([
              ...projects.map((p) => p.organization.slug),
              ...documents.map((d) => d.organization.slug),
              ...announcementOrgs.map((a) => a.organization.slug),
            ]),
          ],
          eventDates: [...new Set(projects.map((p) => isoDate(p.targetDate)))],
        };
      }, TRANSACTION);
    },
  };
}

export type DemoDataRepository = ReturnType<typeof createDemoDataRepository>;
