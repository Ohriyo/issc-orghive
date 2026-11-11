import type { ProjectTaskType } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import { PUBLIC_VIEWER, visibleDocumentsWhere } from './document-visibility';
import type { Db } from './prisma';

const projectSelect = {
  id: true,
  name: true,
  targetDate: true,
  location: true,
  beneficiaries: true,
  tasks: {
    select: {
      type: true,
      documentId: true,
      files: { select: { documentId: true, label: true }, orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.ProjectSelect;

export interface ShowcaseProjectRecord {
  id: string;
  name: string;
  targetDate: Date;
  location: string;
  beneficiaries: string;
  /** Only the files anyone may view (the public visibility filter), in upload order. */
  files: { taskType: ProjectTaskType; documentId: string; label: string | null }[];
}

export interface ShowcaseDocumentRecord {
  id: string;
  title: string;
  createdAt: Date;
  type: { name: string };
}

/**
 * The reads behind /orgs/:slug's showcase. Everything here is what a visitor may see: every
 * document goes through the public visibility filter (document-visibility.ts), whoever asks.
 */
export function createOrgShowcaseRepository(db: Db) {
  return {
    findOrganization(slug: string) {
      return db.organization.findFirst({
        where: { slug, deletedAt: null },
        select: { id: true, slug: true, type: true },
      });
    },

    /** Completed projects, newest event first, each with its public task files only. */
    async completedProjects(organizationId: string, limit: number): Promise<ShowcaseProjectRecord[]> {
      const projects = await db.project.findMany({
        where: { organizationId, status: 'completed', deletedAt: null },
        select: projectSelect,
        orderBy: [{ targetDate: 'desc' }, { id: 'asc' }],
        take: limit,
      });
      const candidates = projects.flatMap((p) =>
        p.tasks.flatMap((t) => [
          ...(t.documentId ? [t.documentId] : []),
          ...t.files.map((f) => f.documentId),
        ]),
      );
      const visible = new Set(
        candidates.length === 0
          ? []
          : (
              await db.document.findMany({
                where: { id: { in: candidates }, ...visibleDocumentsWhere(PUBLIC_VIEWER) },
                select: { id: true },
              })
            ).map((d) => d.id),
      );
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        targetDate: p.targetDate,
        location: p.location,
        beneficiaries: p.beneficiaries,
        files: p.tasks.flatMap((t) => [
          ...(t.documentId && visible.has(t.documentId)
            ? [{ taskType: t.type, documentId: t.documentId, label: null }]
            : []),
          ...t.files
            .filter((f) => visible.has(f.documentId))
            .map((f) => ({ taskType: t.type, documentId: f.documentId, label: f.label })),
        ]),
      }));
    },

    /** The newest public documents, leaving out the given types (constitution, handbook). */
    newestPublicDocuments(
      organizationId: string,
      limit: number,
      excludeTypeSlugs: string[],
    ): Promise<ShowcaseDocumentRecord[]> {
      return db.document.findMany({
        where: {
          organizationId,
          ...visibleDocumentsWhere(PUBLIC_VIEWER),
          type: { slug: { notIn: excludeTypeSlugs } },
        },
        select: { id: true, title: true, createdAt: true, type: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
    },

    publicDocumentCount(organizationId: string): Promise<number> {
      return db.document.count({
        where: { organizationId, ...visibleDocumentsWhere(PUBLIC_VIEWER) },
      });
    },
  };
}

export type OrgShowcaseRepository = ReturnType<typeof createOrgShowcaseRepository>;
