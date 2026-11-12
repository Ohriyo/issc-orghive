import { describe, expect, it, vi } from 'vitest';
import { CACHE_NAMESPACES } from '@orghive/shared';
import { usedMemoryOf, type CacheAdmin } from '#src/lib/cache-admin';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import {
  CACHE_NAMESPACE_PATTERNS,
  createCacheAdminService,
} from '#src/services/cache-admin.service';

const T0 = new Date('2026-11-12T01:00:00Z');
const actor = { userId: 'dev', ctx: { ip: '203.0.113.9', userAgent: 'vitest' } };

function setup() {
  const remove = vi.fn((pattern: string) => Promise.resolve(pattern === 'org:*' ? 12 : 0));
  const cache: CacheAdmin = {
    count: (pattern: string) => Promise.resolve(pattern === 'org:*' ? 12 : 1),
    remove,
    stats: () => Promise.resolve({ totalKeys: 80, usedMemoryBytes: 2048 }),
  };
  const audit: AuditEntry[] = [];
  const service = createCacheAdminService({
    cache,
    audit: {
      record: (entry) => {
        audit.push(entry);
        return Promise.resolve();
      },
    },
    now: () => T0,
  });
  return { service, remove, audit };
}

describe('cacheAdmin', () => {
  it('has a pattern for every namespace, and none touches sessions, rate limits or queues', () => {
    expect(Object.keys(CACHE_NAMESPACE_PATTERNS).sort()).toEqual([...CACHE_NAMESPACES].sort());
    const patterns = Object.values(CACHE_NAMESPACE_PATTERNS).flatMap((n) => n.patterns);
    for (const pattern of patterns) {
      expect(pattern).not.toMatch(/^(\*|sa:|rl:|rlhits:|reveal:|bull:|worker:|leaderboard:\*)/);
    }
    // The leaderboard's published boards are not cache: only the organizations' names are.
    expect(CACHE_NAMESPACE_PATTERNS.leaderboard.patterns).toEqual(['leaderboard:orgs']);
  });

  it('counts keys per namespace and reads the whole Redis', async () => {
    const { service } = setup();
    const stats = await service.stats();
    expect(stats.namespaces.find((n) => n.id === 'organizations')).toMatchObject({
      label: 'Organizations',
      keys: 12,
    });
    expect(stats).toMatchObject({
      totalKeys: 80,
      usedMemoryBytes: 2048,
      generatedAt: T0.toISOString(),
    });
  });

  it('flushes one namespace and audits how many keys went', async () => {
    const { service, remove, audit } = setup();
    expect(await service.flush(actor, 'organizations')).toEqual({
      namespace: 'organizations',
      deleted: 12,
    });
    expect(remove).toHaveBeenCalledWith('org:*');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'cache_flush',
        actorId: 'dev',
        entityType: 'cache',
        entityId: 'organizations',
        metadata: { namespace: 'organizations', deleted: 12 },
      }),
    ]);
  });

  it('reads used memory from INFO', () => {
    expect(usedMemoryOf('# Memory\r\nused_memory:1048576\r\nused_memory_human:1.00M\r\n')).toBe(
      1048576,
    );
    expect(usedMemoryOf('nothing here')).toBeNull();
  });
});

describe('cacheAdmin defaults', () => {
  it('stamps its counts with the real clock when none is given', async () => {
    const service = createCacheAdminService({
      cache: {
        count: () => Promise.resolve(0),
        remove: () => Promise.resolve(0),
        stats: () => Promise.resolve({ totalKeys: null, usedMemoryBytes: null }),
      },
      audit: { record: () => Promise.resolve() },
    });
    const stats = await service.stats();
    expect(Number.isNaN(Date.parse(stats.generatedAt))).toBe(false);
    expect(stats.namespaces.every((n) => n.keys === 0)).toBe(true);
  });
});
