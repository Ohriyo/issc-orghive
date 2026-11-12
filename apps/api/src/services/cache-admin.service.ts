import type { CacheNamespace, CacheStats, FlushCacheResponse } from '@orghive/shared';
import type { CacheAdmin } from '#src/lib/cache-admin';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { ConsoleActor } from '#src/services/account-admin.service';

/**
 * The cached public reads, by namespace (lib/cache.ts `cacheKeys` and the services' own
 * keys). Only these patterns are ever counted or flushed: sessions (`sa:`), rate limits
 * (`rl:`), Reveals, the leaderboard's published boards and the queues share the same Redis
 * and are never touched. Flushing only costs a slower first read: the next request loads
 * from the database again.
 */
export const CACHE_NAMESPACE_PATTERNS: Record<
  CacheNamespace,
  { label: string; description: string; patterns: readonly string[] }
> = {
  organizations: {
    label: 'Organizations',
    description:
      'Organization pages, their document lists, posts, showcase, constitution and the Student Handbook.',
    patterns: ['org:*'],
  },
  colleges: {
    label: 'Colleges',
    description: 'The college list and college pages.',
    patterns: ['college:*'],
  },
  search: {
    label: 'Search',
    description: 'Search results and their generation counter.',
    patterns: ['search:*'],
  },
  updates: {
    label: 'Updates',
    description: 'Council announcements (/updates).',
    patterns: ['updates:*'],
  },
  'document-types': {
    label: 'Document types',
    description: 'The list of document types.',
    patterns: ['document-types:*'],
  },
  leaderboard: {
    label: 'Leaderboard',
    description: "Ranked organizations' names and logos. The boards themselves are not cache.",
    patterns: ['leaderboard:orgs'],
  },
  semesters: {
    label: 'Semester calendar',
    description: 'The semester dates the ISSC set.',
    patterns: ['semester:calendar'],
  },
  demo: {
    label: 'Demo data',
    description: 'Which organizations show the "Sample data" chip.',
    patterns: ['demo:status'],
  },
};

export interface CacheAdminServiceDeps {
  cache: CacheAdmin;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** /system/cache: key counts per namespace, and flushing one (a step-up, in the route). */
export function createCacheAdminService({
  cache,
  audit,
  now = () => new Date(),
}: CacheAdminServiceDeps) {
  const entries = Object.entries(CACHE_NAMESPACE_PATTERNS) as [
    CacheNamespace,
    (typeof CACHE_NAMESPACE_PATTERNS)[CacheNamespace],
  ][];

  return {
    async stats(): Promise<CacheStats> {
      const [namespaces, whole] = await Promise.all([
        Promise.all(
          entries.map(async ([id, { label, description, patterns }]) => ({
            id,
            label,
            description,
            keys: sum(await Promise.all(patterns.map((pattern) => cache.count(pattern)))),
          })),
        ),
        cache.stats(),
      ]);
      return { namespaces, ...whole, generatedAt: now().toISOString() };
    },

    async flush(actor: ConsoleActor, namespace: CacheNamespace): Promise<FlushCacheResponse> {
      const { patterns } = CACHE_NAMESPACE_PATTERNS[namespace];
      const deleted = sum(await Promise.all(patterns.map((pattern) => cache.remove(pattern))));
      await audit.record({
        action: 'cache_flush',
        actorId: actor.userId,
        entityType: 'cache',
        entityId: namespace,
        metadata: { namespace, deleted },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return { namespace, deleted };
    },
  };
}

export type CacheAdminService = ReturnType<typeof createCacheAdminService>;
