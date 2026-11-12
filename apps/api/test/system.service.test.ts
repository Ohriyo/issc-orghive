import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode } from '@orghive/shared';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import type { AccountRecord } from '#src/repositories/account-admin.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import type { AccountDecision, AccountState } from '#src/services/super-admin-rules';
import { createSystemService } from '#src/services/system.service';

const T0 = new Date('2026-10-19T08:00:00Z');
const ACTOR = 'actor';
const ctx = { ip: '203.0.113.9', userAgent: 'vitest' };

const userRecord = (account: AccountState): AccountRecord => ({
  id: account.id,
  name: account.id,
  email: `${account.id}@nwssu.test`,
  systemRole: account.systemRole,
  mfaEnabledAt: account.mfaEnabledAt,
  disabledAt: account.disabledAt,
  lockedAt: null,
  lockReason: null,
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: T0,
  organizationId: null,
  organization: null,
  officerTerms: [],
});

function setup(accounts: AccountState[], exportRows = 2) {
  const byId = new Map(accounts.map((a) => [a.id, { ...a }]));
  const audit: AuditEntry[] = [];
  const revokeAllForUser = vi.fn(() => Promise.resolve());
  const queues = vi.fn(() =>
    Promise.resolve([{ name: 'documents', waiting: 1, active: 0, delayed: 0, failed: 2 }]),
  );

  const repo = {
    findAccount: (id: string) => Promise.resolve(byId.get(id) ?? null),
    applyAccountChange: async (
      id: string,
      decide: (t: AccountState, active: string[]) => AccountDecision,
    ) => {
      const before = byId.get(id);
      if (!before) return { decision: { kind: 'unchanged' as const }, before: null };
      const active = [...byId.values()]
        .filter((a) => a.systemRole === 'SUPER_ADMIN' && !a.disabledAt && a.mfaEnabledAt)
        .map((a) => a.id);
      const decision = decide({ ...before }, active);
      if (decision.kind === 'apply') {
        const { patch } = decision;
        byId.set(id, {
          ...before,
          ...('disabledAt' in patch && { disabledAt: patch.disabledAt ?? null }),
          ...(patch.demote && { systemRole: 'NONE' as const, mfaEnabledAt: null }),
        });
      }
      return Promise.resolve({ decision, before: { ...before } });
    },
    overviewCounts: () =>
      Promise.resolve({
        users: { total: 10, disabled: 3 },
        superAdmins: { active: 1, pendingMfa: 1 },
        organizations: { total: 9, active: 8 },
        documents: { available: 5, scanning: 2, quarantined: 1, archived: 4 },
        stuckScanning: 1,
        auditEventsSince: 40,
        failedLoginsSince: 6,
      }),
    listAuditLogs: () =>
      Promise.resolve([
        {
          id: 'log1',
          createdAt: T0,
          action: 'login' as const,
          actor: null,
          entityType: 'user',
          entityId: 'u',
          organizationId: null,
          ip: null,
          userAgent: null,
          actingAs: null,
          metadata: ['not', 'an', 'object'],
        },
      ]),
    exportAuditLogs: (_filters: unknown, max: number) =>
      Promise.resolve(
        Array.from({ length: Math.min(exportRows, max + 1) }, (_, i) => ({
          id: `log${i}`,
          createdAt: T0,
          action: 'upload' as const,
          actor: i === 0 ? { id: 'a', name: 'JPICE', email: 'jpice@nwssu.test' } : null,
          entityType: 'document',
          entityId: 'd1',
          organizationId: null,
          ip: '203.0.113.9',
          userAgent: 'vitest',
          actingAs: i === 0 ? '=HYPERLINK("x")' : null,
          metadata: i === 0 ? { title: 'Report, final' } : null,
        })),
      ),
  } as unknown as SystemRepository;

  const service = createSystemService({
    system: repo,
    accounts: {
      find: (id: string) => {
        const account = byId.get(id);
        return Promise.resolve(account ? userRecord(account) : null);
      },
    },
    refreshTokens: { revokeAllForUser },
    audit: {
      record: (e) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    queues,
    logger: pino({ level: 'silent' }),
    now: () => T0,
  });
  return { service, byId, audit, revokeAllForUser, queues };
}

const superAdmin = (id: string): AccountState => ({
  id,
  systemRole: 'SUPER_ADMIN',
  disabledAt: null,
  mfaEnabledAt: T0,
});
const plain = (id: string): AccountState => ({
  id,
  systemRole: 'NONE',
  disabledAt: null,
  mfaEnabledAt: null,
});

describe('systemService.assertSuperAdmin', () => {
  it('passes only an active super admin with MFA', async () => {
    const s = setup([
      superAdmin(ACTOR),
      { ...superAdmin('pending'), mfaEnabledAt: null },
      { ...superAdmin('off'), disabledAt: T0 },
      plain('student'),
    ]);
    await s.service.assertSuperAdmin(ACTOR);
    for (const id of ['pending', 'off', 'student', 'missing']) {
      await expect(s.service.assertSuperAdmin(id)).rejects.toMatchObject({ status: 403 });
    }
  });
});

describe('systemService account changes', () => {
  it('deactivates with an audit of before and after, and signs the user out', async () => {
    const s = setup([superAdmin(ACTOR), plain('student')]);
    const user = await s.service.setUserActive(ACTOR, 'student', false, ctx);

    expect(user.disabledAt).toBe(T0.toISOString());
    expect(s.revokeAllForUser).toHaveBeenCalledWith('student', T0);
    expect(s.audit).toEqual([
      expect.objectContaining({
        action: 'user_deactivate',
        actorId: ACTOR,
        entityId: 'student',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: {
          before: { systemRole: 'NONE', disabledAt: null, mfaEnabled: false },
          after: { systemRole: 'NONE', disabledAt: T0.toISOString(), mfaEnabled: false },
        },
      }),
    ]);
  });

  it('reactivates without revoking anything; a no-op writes no audit entry', async () => {
    const s = setup([superAdmin(ACTOR), { ...plain('student'), disabledAt: T0 }]);
    await s.service.setUserActive(ACTOR, 'student', true, ctx);
    expect(s.audit.map((a) => a.action)).toEqual(['user_reactivate']);
    expect(s.revokeAllForUser).not.toHaveBeenCalled();

    await s.service.setUserActive(ACTOR, 'student', true, ctx);
    expect(s.audit).toHaveLength(1);
  });

  it('turns refusals into clear errors', async () => {
    const s = setup([superAdmin(ACTOR), plain('student')]);
    await expect(s.service.setUserActive(ACTOR, ACTOR, false, ctx)).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.CONFLICT,
    });
    await expect(s.service.demote(ACTOR, ACTOR, ctx)).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.LAST_SUPER_ADMIN,
    });
    await expect(s.service.demote(ACTOR, 'student', ctx)).rejects.toMatchObject({
      status: 409,
      code: ErrorCode.CONFLICT,
    });
    await expect(s.service.demote(ACTOR, 'missing', ctx)).rejects.toMatchObject({ status: 404 });
    expect(s.audit).toEqual([]);
  });

  it('demotes another super admin and records the role change', async () => {
    const s = setup([superAdmin(ACTOR), superAdmin('other')]);
    const user = await s.service.demote(ACTOR, 'other', ctx);
    expect(user).toMatchObject({ systemRole: 'NONE', mfaEnabledAt: null, organization: null });
    expect(s.audit[0]).toMatchObject({
      action: 'system_role_change',
      metadata: { before: { systemRole: 'SUPER_ADMIN' }, after: { systemRole: 'NONE' } },
    });
    expect(s.revokeAllForUser).toHaveBeenCalledWith('other', T0);
  });
});

describe('systemService reads', () => {
  it('builds the overview, and shows no queues when Redis cannot answer', async () => {
    const s = setup([]);
    expect(await s.service.overview()).toEqual({
      users: { total: 10, active: 7, disabled: 3 },
      superAdmins: { active: 1, pendingMfa: 1 },
      organizations: { total: 9, active: 8 },
      documents: { available: 5, scanning: 2, stuckScanning: 1, quarantined: 1, archived: 4 },
      queues: [{ name: 'documents', waiting: 1, active: 0, delayed: 0, failed: 2 }],
      auditEventsLast24h: 40,
      failedLoginsLast24h: 6,
      generatedAt: T0.toISOString(),
    });
    s.queues.mockRejectedValueOnce(new Error('redis down'));
    expect((await s.service.overview()).queues).toEqual([]);
  });

  it('pages audit entries', async () => {
    const s = setup([]);
    const audit = await s.service.listAuditLogs({});
    expect(audit).toEqual({
      items: [expect.objectContaining({ id: 'log1', action: 'login', metadata: null })],
      nextCursor: null,
    });
  });

  it('exports the filtered audit log as CSV, guarded against formulas, and audits it', async () => {
    const s = setup([]);
    const result = await s.service.exportAuditLogs({ userId: ACTOR, ctx }, { action: 'upload' });
    expect(result).toMatchObject({ rows: 2, truncated: false });
    const lines = result.csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Time (UTC),Action,Actor,Actor email,Acting as,Entity type,Entity id,Organization id,IP,User agent,Details',
    );
    // A formula-like "Acting as" becomes text; JSON details are quoted as one cell.
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain(`"{""title"":""Report, final""}"`);
    expect(lines[2]).toContain(',System,');
    expect(s.audit.at(-1)).toMatchObject({
      action: 'audit_export',
      actorId: ACTOR,
      metadata: { filters: { action: 'upload' }, rows: 2, truncated: false },
    });
  });

  it('cuts an export at the row limit and says so', async () => {
    const s = setup([], 10_005);
    const result = await s.service.exportAuditLogs({ userId: ACTOR, ctx }, {});
    expect(result).toMatchObject({ rows: 10_000, truncated: true });
    expect(result.csv.trimEnd().split('\r\n')).toHaveLength(10_001);
  });

  it('records console reads', async () => {
    const s = setup([]);
    await s.service.recordView(ACTOR, '/api/v1/system/users', ctx);
    expect(s.audit[0]).toMatchObject({
      action: 'system_view',
      actorId: ACTOR,
      entityType: 'system',
      metadata: { route: '/api/v1/system/users' },
      userAgent: 'vitest',
    });
  });
});
