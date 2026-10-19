import type { DeleteTestDataResponse, SupportDocumentList, TestDataPreview } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, invalidateDocuments } from '#src/lib/cache';
import type { JobQueue } from '#src/lib/queue';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import { supportTitleOf } from '#src/repositories/document-visibility';
import type { SupportRepository } from '#src/repositories/support.repository';
import type { ConsoleActor } from '#src/services/account-admin.service';

/** A scan still pending after this long is stuck: the worker or ClamAV may have been down. */
const STUCK_SCAN_MS = 15 * 60 * 1000;

export interface SupportServiceDeps {
  support: SupportRepository;
  queue: Pick<JobQueue, 'enqueueProcessing'>;
  cache: Pick<Cache, 'deleteMatching' | 'bump'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

/**
 * The super admin's file support (docs/DOMAIN_RULES.md, "Accounts"): file details without
 * opening or downloading anything (private titles hidden), a stuck scan run again, an
 * archived file restored, and the bulk deletion of test data. Each action is audited.
 */
export function createSupportService({
  support,
  queue,
  cache,
  audit,
  now = () => new Date(),
}: SupportServiceDeps) {
  async function loadDocument(id: string) {
    const doc = await support.findDocument(id);
    if (!doc) throw AppError.notFound('Document not found');
    return doc;
  }

  return {
    async listDocuments(slug: string): Promise<SupportDocumentList> {
      const org = await support.findOrganization(slug);
      if (!org) throw AppError.notFound('Organization not found');
      const docs = await support.listDocuments(org.id);
      const stuckBefore = now().getTime() - STUCK_SCAN_MS;
      return {
        organization: { slug: org.slug, acronym: org.acronym, name: org.name },
        items: docs.map((doc) => {
          const latest = doc.versions[0];
          return {
            id: doc.id,
            title: supportTitleOf(doc),
            type: doc.type.name,
            status: doc.status,
            visibility: doc.visibility,
            isTestData: doc.isTestData,
            sizeBytes: latest?.sizeBytes ?? null,
            scanStatus: latest?.scanStatus ?? null,
            stuck: latest?.scanStatus === 'pending' && latest.createdAt.getTime() < stuckBefore,
            createdAt: doc.createdAt.toISOString(),
            updatedAt: doc.updatedAt.toISOString(),
          };
        }),
      };
    },

    /** Queues the latest file's virus scan again. 409 when nothing waits for a scan. */
    async rescan(actor: ConsoleActor, documentId: string): Promise<void> {
      const doc = await loadDocument(documentId);
      const latest = doc.versions[0];
      if (!latest || latest.scanStatus !== 'pending') {
        throw AppError.conflict('No file of this document is waiting for a virus scan');
      }
      await queue.enqueueProcessing(latest.id);
      await audit.record({
        action: 'support_rescan',
        actorId: actor.userId,
        entityType: 'document',
        entityId: doc.id,
        organizationId: doc.organization.id,
        metadata: { versionId: latest.id },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
    },

    /** archived -> available, with the visibility it had. 409 otherwise. */
    async restore(actor: ConsoleActor, documentId: string): Promise<void> {
      const doc = await loadDocument(documentId);
      if (!(await support.restore(doc.id))) {
        throw AppError.conflict('Only archived documents can be restored');
      }
      await audit.record({
        action: 'restore',
        actorId: actor.userId,
        entityType: 'document',
        entityId: doc.id,
        organizationId: doc.organization.id,
        metadata: { support: true },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      await invalidateDocuments(cache, doc.organization.slug);
    },

    async testDataPreview(): Promise<TestDataPreview> {
      const { items, total } = await support.testDataPreview();
      return {
        total,
        items: items.map((doc) => ({
          id: doc.id,
          organization: doc.organization,
          type: doc.type.name,
          status: doc.status,
          createdAt: doc.createdAt.toISOString(),
        })),
      };
    },

    /**
     * Soft-deletes every test-data file, if the preview the super admin saw is still
     * current; 409 otherwise, so nothing unseen is deleted. One audit entry per file.
     */
    async deleteTestData(
      actor: ConsoleActor,
      expectedCount: number,
    ): Promise<DeleteTestDataResponse> {
      const deleted = await support.deleteTestData(expectedCount, now());
      if (!deleted) {
        throw AppError.conflict('The test data changed since the preview. Review it again.');
      }
      for (const doc of deleted) {
        await audit.record({
          action: 'delete',
          actorId: actor.userId,
          entityType: 'document',
          entityId: doc.id,
          organizationId: doc.organizationId,
          metadata: { testData: true },
          ip: actor.ctx.ip,
          userAgent: actor.ctx.userAgent,
        });
      }
      for (const slug of new Set(deleted.map((doc) => doc.slug))) {
        await invalidateDocuments(cache, slug);
      }
      return { deleted: deleted.length };
    },
  };
}

export type SupportService = ReturnType<typeof createSupportService>;
