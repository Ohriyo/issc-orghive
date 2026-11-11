import {
  CONSTITUTION_DOCUMENT_TYPE,
  ErrorCode,
  HANDBOOK_DOCUMENT_TYPE,
  PROJECT_TASK_LABELS,
  PROJECT_TASK_TYPES,
  SHOWCASE_DOCUMENTS,
  SHOWCASE_PROJECTS_MAX,
  type OrgShowcase,
  type ShowcaseProject,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { cacheKeys, type Cache } from '#src/lib/cache';
import type {
  OrgShowcaseRepository,
  ShowcaseProjectRecord,
} from '#src/repositories/org-showcase.repository';
import type { LeaderboardService } from '#src/services/leaderboard.service';
import { badgeSemester, boardOf, groupBySemester, rankBadge } from '#src/services/org-showcase-rules';
import { USUAL_SEMESTER_READER, type SemesterReader } from '#src/services/semester-calendar.service';

/** Cleared on every document write and when a project completes; this is the backstop. */
export const SHOWCASE_TTL_SECONDS = 5 * 60;

export interface OrgShowcaseServiceDeps {
  showcase: OrgShowcaseRepository;
  leaderboard: Pick<LeaderboardService, 'board' | 'meta'>;
  semesters?: SemesterReader;
  cache: Pick<Cache, 'getOrSet'>;
  now?: () => Date;
}

type CachedPart = Omit<OrgShowcase, 'rank'>;

const taskOrder = (type: string) => PROJECT_TASK_TYPES.indexOf(type as never);

function toProject(record: ShowcaseProjectRecord): ShowcaseProject {
  return {
    id: record.id,
    title: record.name,
    date: record.targetDate.toISOString().slice(0, 10),
    location: record.location,
    beneficiaries: record.beneficiaries,
    files: [...record.files]
      .sort((a, b) => taskOrder(a.taskType) - taskOrder(b.taskType))
      .map((file) => ({
        documentId: file.documentId,
        label: file.label ?? PROJECT_TASK_LABELS[file.taskType],
      })),
  };
}

/**
 * GET /organizations/:slug/showcase (docs/DOMAIN_RULES.md, "Organization page"): the rank
 * badge, completed projects and public documents. The same answer for every viewer. The
 * projects and documents are cached under the organization's `docs:` keys; the rank is read
 * from the stored boards each time (never ranked here unless the store is empty).
 */
export function createOrgShowcaseService({
  showcase,
  leaderboard,
  semesters = USUAL_SEMESTER_READER,
  cache,
  now = () => new Date(),
}: OrgShowcaseServiceDeps) {
  async function records(org: { id: string; slug: string }): Promise<CachedPart> {
    const part = await cache.getOrSet<CachedPart>(
      cacheKeys.organizationShowcase(org.slug),
      SHOWCASE_TTL_SECONDS,
      async () => {
        const [projects, documents, publicDocumentCount, calendar] = await Promise.all([
          showcase.completedProjects(org.id, SHOWCASE_PROJECTS_MAX),
          showcase.newestPublicDocuments(org.id, SHOWCASE_DOCUMENTS, [
            CONSTITUTION_DOCUMENT_TYPE.slug,
            HANDBOOK_DOCUMENT_TYPE.slug,
          ]),
          showcase.publicDocumentCount(org.id),
          semesters.load(),
        ]);
        return {
          projectSemesters: groupBySemester(projects.map(toProject), calendar),
          documents: documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            typeName: doc.type.name,
            createdAt: doc.createdAt.toISOString(),
          })),
          publicDocumentCount,
        };
      },
    );
    // getOrSet returns null only when load does, which it never does.
    return part ?? { projectSemesters: [], documents: [], publicDocumentCount: 0 };
  }

  async function rankOf(org: { id: string; type: 'ISSC' | 'CSC' | 'SBO' }) {
    const board = boardOf(org.type);
    if (!board) return null;
    const semester = badgeSemester(await semesters.load(), now());
    const [rows, meta] = await Promise.all([
      leaderboard.board(semester, board),
      leaderboard.meta(semester),
    ]);
    return rankBadge({
      organizationId: org.id,
      organizationType: org.type,
      semester,
      status: meta.status,
      rows,
    });
  }

  return {
    async read(slug: string): Promise<OrgShowcase> {
      const org = await showcase.findOrganization(slug);
      if (!org) throw new AppError(404, ErrorCode.NOT_FOUND, 'Organization not found');
      const [part, rank] = await Promise.all([records(org), rankOf(org)]);
      return { rank, ...part };
    },
  };
}

export type OrgShowcaseService = ReturnType<typeof createOrgShowcaseService>;
