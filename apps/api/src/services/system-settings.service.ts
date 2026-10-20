import {
  DEFAULT_LATE_POINTS,
  latePointsSchema,
  type SystemSettings,
  type UpdateSystemSettingsRequest,
} from '@orghive/shared';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SystemSettingRepository } from '#src/repositories/system-setting.repository';
import type { RequestContext } from '#src/services/auth.service';

export const SETTING_KEYS = {
  latePoints: 'leaderboard.latePoints',
} as const;

export interface SystemSettingsServiceDeps {
  settings: Pick<SystemSettingRepository, 'get' | 'set'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /** A setting the standings depend on changed (Phase 2 queues a recompute here). */
  onLatePointsChanged?: () => Promise<void>;
}

/**
 * Settings the super admin changes in /system (docs/PROJECT_WORKFLOW_SPEC.md, 5C: the late
 * value). A missing or unreadable row means the default. Every change is audited with the
 * value before and after.
 */
export function createSystemSettingsService({
  settings,
  audit,
  onLatePointsChanged,
}: SystemSettingsServiceDeps) {
  async function latePointsSetting(): Promise<{ value: number; updatedAt: Date | null }> {
    const row = await settings.get(SETTING_KEYS.latePoints);
    const parsed = latePointsSchema.safeParse(row?.value);
    return parsed.success
      ? { value: parsed.data, updatedAt: row!.updatedAt }
      : { value: DEFAULT_LATE_POINTS, updatedAt: null };
  }

  return {
    async get(): Promise<SystemSettings> {
      const late = await latePointsSetting();
      return {
        leaderboardLatePoints: late.value,
        updatedAt: late.updatedAt?.toISOString() ?? null,
      };
    },

    /** Points for a late implemented project, 0 to 1. */
    async latePoints(): Promise<number> {
      return (await latePointsSetting()).value;
    },

    async update(
      actorId: string,
      patch: UpdateSystemSettingsRequest,
      ctx: RequestContext,
    ): Promise<SystemSettings> {
      if (patch.leaderboardLatePoints !== undefined) {
        const before = (await latePointsSetting()).value;
        const after = patch.leaderboardLatePoints;
        if (after !== before) {
          await settings.set(SETTING_KEYS.latePoints, after, actorId);
          await audit.record({
            action: 'system_setting_change',
            actorId,
            entityType: 'system_setting',
            entityId: SETTING_KEYS.latePoints,
            metadata: { key: SETTING_KEYS.latePoints, before, after },
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          });
          await onLatePointsChanged?.();
        }
      }
      return this.get();
    },
  };
}

export type SystemSettingsService = ReturnType<typeof createSystemSettingsService>;
