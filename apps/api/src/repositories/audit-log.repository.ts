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
}

export function createAuditLogRepository(db: Db) {
  return {
    async record(entry: AuditEntry): Promise<void> {
      await db.auditLog.create({ data: entry });
    },
  };
}

export type AuditLogRepository = ReturnType<typeof createAuditLogRepository>;
