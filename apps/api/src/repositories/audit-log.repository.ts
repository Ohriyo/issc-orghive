import type { AuditAction, Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  /** Never put passwords, tokens or full request bodies here. */
  metadata?: Prisma.InputJsonObject;
  ip?: string | null;
  /** Trimmed to 255 characters. */
  userAgent?: string | null;
  /** The officer who acted for a shared organization account ("Acting as"). */
  actingAs?: string | null;
}

export function createAuditLogRepository(db: Db) {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await db.auditLog.create({
        data: { ...entry, userAgent: entry.userAgent?.slice(0, 255) ?? null },
      });
    },
  };
}

export type AuditLogRepository = ReturnType<typeof createAuditLogRepository>;
