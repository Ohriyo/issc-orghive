import type { z } from 'zod';
import {
  DEFAULT_FINAL_AFTER_DAYS,
  DEFAULT_LATE_POINTS,
  finalAfterDaysSchema,
  DEFAULT_NEAR_DUPLICATE_BITS,
  DEFAULT_TASK_KEYWORDS,
  latePointsSchema,
  nearDuplicateBitsSchema,
  taskKeywordsSchema,
  type SystemSettings,
  type TaskKeywords,
  type UpdateSystemSettingsRequest,
} from '@orghive/shared';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SystemSettingRepository } from '#src/repositories/system-setting.repository';
import type { RequestContext } from '#src/services/auth.service';

export const SETTING_KEYS = {
  latePoints: 'leaderboard.latePoints',
  finalAfterDays: 'leaderboard.finalAfterDays',
  taskKeywords: 'integrity.taskKeywords',
  nearDuplicateBits: 'integrity.nearDuplicateBits',
} as const;

export interface SystemSettingsServiceDeps {
  settings: Pick<SystemSettingRepository, 'get' | 'set'>;
  audit: Pick<AuditLogRepository, 'record'>;
  /** A setting the standings depend on changed: the late value or the grace days. */
  onLatePointsChanged?: () => Promise<void>;
}

type Setting<T> = { value: T; updatedAt: Date | null };

const later = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/**
 * Settings the super admin changes in /system: the late value (docs/PROJECT_WORKFLOW_SPEC.md,
 * 5C), and the task file checks' keywords and near-duplicate threshold (section 6). A missing
 * or unreadable row means the default. Every change is audited with the value before and
 * after.
 */
export function createSystemSettingsService({
  settings,
  audit,
  onLatePointsChanged,
}: SystemSettingsServiceDeps) {
  async function read<T>(key: string, schema: z.ZodType<T>, fallback: T): Promise<Setting<T>> {
    const row = await settings.get(key);
    const parsed = schema.safeParse(row?.value);
    return parsed.success
      ? { value: parsed.data, updatedAt: row!.updatedAt }
      : { value: fallback, updatedAt: null };
  }

  const latePointsSetting = () =>
    read(SETTING_KEYS.latePoints, latePointsSchema, DEFAULT_LATE_POINTS);
  const finalAfterDaysSetting = () =>
    read(SETTING_KEYS.finalAfterDays, finalAfterDaysSchema, DEFAULT_FINAL_AFTER_DAYS);
  const keywordsSetting = () =>
    read(SETTING_KEYS.taskKeywords, taskKeywordsSchema, DEFAULT_TASK_KEYWORDS);
  const nearBitsSetting = () =>
    read(SETTING_KEYS.nearDuplicateBits, nearDuplicateBitsSchema, DEFAULT_NEAR_DUPLICATE_BITS);

  /** Saves and audits one setting when it changed; true when it did. */
  async function change<T extends number | TaskKeywords>(
    key: string,
    before: T,
    after: T,
    actorId: string,
    ctx: RequestContext,
  ): Promise<boolean> {
    if (JSON.stringify(after) === JSON.stringify(before)) return false;
    await settings.set(key, after, actorId);
    await audit.record({
      action: 'system_setting_change',
      actorId,
      entityType: 'system_setting',
      entityId: key,
      metadata: { key, before, after },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return true;
  }

  return {
    async get(): Promise<SystemSettings> {
      const [late, keywords, nearBits, finalAfterDays] = await Promise.all([
        latePointsSetting(),
        keywordsSetting(),
        nearBitsSetting(),
        finalAfterDaysSetting(),
      ]);
      return {
        leaderboardLatePoints: late.value,
        updatedAt: late.updatedAt?.toISOString() ?? null,
        taskKeywords: keywords.value,
        nearDuplicateBits: nearBits.value,
        checksUpdatedAt: later(keywords.updatedAt, nearBits.updatedAt)?.toISOString() ?? null,
        finalAfterDays: finalAfterDays.value,
        finalAfterDaysUpdatedAt: finalAfterDays.updatedAt?.toISOString() ?? null,
      };
    },

    /** Points for a late implemented project, 0 to 1. */
    async latePoints(): Promise<number> {
      return (await latePointsSetting()).value;
    },

    /** Days after a semester's last day until its standings are final (spec 5B). */
    async finalAfterDays(): Promise<number> {
      return (await finalAfterDaysSetting()).value;
    },

    /** What each checked task's file should contain (the worker's keyword check). */
    async taskKeywords(): Promise<TaskKeywords> {
      return (await keywordsSetting()).value;
    },

    /** The worker's near-duplicate threshold, in bits of 64. */
    async nearDuplicateBits(): Promise<number> {
      return (await nearBitsSetting()).value;
    },

    /** Only new checks use changed check settings: files already checked keep their results. */
    async update(
      actorId: string,
      patch: UpdateSystemSettingsRequest,
      ctx: RequestContext,
    ): Promise<SystemSettings> {
      if (patch.leaderboardLatePoints !== undefined) {
        const before = (await latePointsSetting()).value;
        if (
          await change(SETTING_KEYS.latePoints, before, patch.leaderboardLatePoints, actorId, ctx)
        ) {
          await onLatePointsChanged?.();
        }
      }
      if (patch.finalAfterDays !== undefined) {
        const before = (await finalAfterDaysSetting()).value;
        if (await change(SETTING_KEYS.finalAfterDays, before, patch.finalAfterDays, actorId, ctx)) {
          await onLatePointsChanged?.();
        }
      }
      if (patch.taskKeywords !== undefined) {
        const before = (await keywordsSetting()).value;
        await change(SETTING_KEYS.taskKeywords, before, patch.taskKeywords, actorId, ctx);
      }
      if (patch.nearDuplicateBits !== undefined) {
        const before = (await nearBitsSetting()).value;
        await change(SETTING_KEYS.nearDuplicateBits, before, patch.nearDuplicateBits, actorId, ctx);
      }
      return this.get();
    },
  };
}

export type SystemSettingsService = ReturnType<typeof createSystemSettingsService>;
