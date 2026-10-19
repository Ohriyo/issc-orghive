import { z } from 'zod';
import { RECOVERY_CODE_COUNT, totpCodeSchema } from './auth';

/*
 * /system: the super admin console (CLAUDE.md, "System roles"). Every route needs an
 * active SUPER_ADMIN with MFA; destructive ones also need a step-up code from the last
 * 5 minutes.
 */

/** A super admin password: longer than everyone else's, and never a common one. */
export const SUPER_ADMIN_PASSWORD_MIN_LENGTH = 14;

/** 15 minutes without activity ends a super admin session. */
export const SUPER_ADMIN_IDLE_TIMEOUT_SECONDS = 15 * 60;
/** A super admin session ends 8 hours after sign-in, however active. */
export const SUPER_ADMIN_SESSION_MAX_SECONDS = 8 * 60 * 60;
/** A step-up code unlocks destructive actions for 5 minutes. */
export const STEP_UP_TTL_SECONDS = 5 * 60;

/**
 * Sent by polling requests (unread counts, scan status). They do not count as activity, so
 * an open tab cannot keep an idle super admin session alive.
 */
export const BACKGROUND_REQUEST_HEADER = 'X-Orghive-Background';

/** POST /system/step-up */
export const stepUpRequestSchema = z.object({ code: totpCodeSchema });
export type StepUpRequest = z.infer<typeof stepUpRequestSchema>;

export const stepUpResponseSchema = z
  .object({ stepUpExpiresAt: z.iso.datetime() })
  .meta({ id: 'StepUpResponse' });
export type StepUpResponse = z.infer<typeof stepUpResponseSchema>;

const countSchema = z.number().int().min(0);

/** GET /system/overview */
export const systemOverviewSchema = z
  .object({
    users: z.object({ total: countSchema, active: countSchema, disabled: countSchema }),
    superAdmins: z.object({ active: countSchema, pendingMfa: countSchema }),
    organizations: z.object({ total: countSchema, active: countSchema }),
    documents: z.object({
      available: countSchema,
      scanning: countSchema,
      /** Still scanning 15 minutes after upload: the worker or ClamAV may be down. */
      stuckScanning: countSchema,
      quarantined: countSchema,
      archived: countSchema,
    }),
    /** Background queues: jobs waiting, and jobs that failed and stay for inspection. */
    queues: z.array(
      z.object({
        name: z.string(),
        waiting: countSchema,
        active: countSchema,
        delayed: countSchema,
        failed: countSchema,
      }),
    ),
    auditEventsLast24h: countSchema,
    failedLoginsLast24h: countSchema,
    generatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SystemOverview' });
export type SystemOverview = z.infer<typeof systemOverviewSchema>;

export const SYSTEM_PAGE_MAX = 50;

const pageQuery = {
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(SYSTEM_PAGE_MAX).optional(),
};

export const systemUserIdParamsSchema = z.object({ userId: z.uuid() });

/** PATCH /system/users/:userId/status: deactivate (signs them out everywhere) or reactivate. */
export const setUserStatusRequestSchema = z.strictObject({ active: z.boolean() });
export type SetUserStatusRequest = z.infer<typeof setUserStatusRequestSchema>;

/**
 * PATCH /system/users/:userId/system-role: demotion only. Promotion needs server access
 * (the create-super-admin command), so a stolen console session cannot mint another one.
 */
export const setSystemRoleRequestSchema = z.strictObject({ systemRole: z.literal('NONE') });
export type SetSystemRoleRequest = z.infer<typeof setSystemRoleRequestSchema>;

/** GET /system/audit-logs: newest first. */
export const systemAuditQuerySchema = z.object({
  ...pageQuery,
  actorId: z.uuid().optional(),
  action: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityId: z.string().trim().max(64).optional(),
  /** Part of an "Acting as" name, any case. */
  actingAs: z.string().trim().min(1).max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type SystemAuditQuery = z.infer<typeof systemAuditQuerySchema>;

export const systemAuditEntrySchema = z
  .object({
    id: z.uuid(),
    createdAt: z.iso.datetime(),
    action: z.string(),
    actor: z.object({ id: z.uuid(), name: z.string(), email: z.email() }).nullable(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    organizationId: z.uuid().nullable(),
    ip: z.string().nullable(),
    userAgent: z.string().nullable(),
    /** The officer who acted for a shared organization account. */
    actingAs: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  })
  .meta({ id: 'SystemAuditEntry' });
export type SystemAuditEntry = z.infer<typeof systemAuditEntrySchema>;

export const systemAuditListResponseSchema = z
  .object({ items: z.array(systemAuditEntrySchema), nextCursor: z.uuid().nullable() })
  .meta({ id: 'SystemAuditListResponse' });
export type SystemAuditListResponse = z.infer<typeof systemAuditListResponseSchema>;

/** GET /system/me/security: the signed-in super admin's own session and MFA state. */
export const systemSecuritySchema = z
  .object({
    mfaEnabledAt: z.iso.datetime(),
    recoveryCodesRemaining: countSchema,
    sessionStartedAt: z.iso.datetime(),
    sessionExpiresAt: z.iso.datetime(),
    idleTimeoutSeconds: z.number().int().positive(),
    /** Null when no step-up is active. */
    stepUpExpiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'SystemSecurity' });
export type SystemSecurity = z.infer<typeof systemSecuritySchema>;

/** POST /system/me/recovery-codes: replaces every old code; shown once. */
export const recoveryCodesResponseSchema = z
  .object({ recoveryCodes: z.array(z.string()).length(RECOVERY_CODE_COUNT) })
  .meta({ id: 'RecoveryCodesResponse' });
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;
