import { describe, expect, it } from 'vitest';
import {
  decideAccountChange,
  isActiveSuperAdmin,
  type AccountState,
} from '#src/services/super-admin-rules';

const AT = new Date('2026-10-19T08:00:00Z');
const superAdmin = (id: string, extra: Partial<AccountState> = {}): AccountState => ({
  id,
  systemRole: 'SUPER_ADMIN',
  disabledAt: null,
  mfaEnabledAt: AT,
  ...extra,
});
const student: AccountState = {
  id: 'student',
  systemRole: 'NONE',
  disabledAt: null,
  mfaEnabledAt: null,
};

describe('isActiveSuperAdmin', () => {
  it('needs the role, an enabled account and a confirmed authenticator', () => {
    expect(isActiveSuperAdmin(superAdmin('a'))).toBe(true);
    expect(isActiveSuperAdmin(superAdmin('a', { disabledAt: AT }))).toBe(false);
    expect(isActiveSuperAdmin(superAdmin('a', { mfaEnabledAt: null }))).toBe(false);
    expect(isActiveSuperAdmin(student)).toBe(false);
  });
});

describe('decideAccountChange', () => {
  const decide = (
    target: AccountState,
    change: 'deactivate' | 'reactivate' | 'demote',
    active: string[],
    actorId = 'actor',
  ) => decideAccountChange({ actorId, target, change, activeSuperAdminIds: active, at: AT });

  it('never lets anyone deactivate themselves', () => {
    expect(decide(superAdmin('actor'), 'deactivate', ['actor', 'b'], 'actor')).toEqual({
      kind: 'refuse',
      reason: 'self_deactivation',
    });
  });

  it('deactivates others, but never the last active super admin', () => {
    expect(decide(student, 'deactivate', ['actor'])).toEqual({
      kind: 'apply',
      patch: { disabledAt: AT },
    });
    expect(decide(superAdmin('b'), 'deactivate', ['actor', 'b'])).toMatchObject({
      kind: 'apply',
    });
    expect(decide(superAdmin('b'), 'deactivate', ['b'])).toEqual({
      kind: 'refuse',
      reason: 'last_super_admin',
    });
    // A super admin still setting up MFA is not one of the active ones.
    expect(decide(superAdmin('b', { mfaEnabledAt: null }), 'deactivate', [])).toMatchObject({
      kind: 'apply',
    });
    expect(decide({ ...student, disabledAt: AT }, 'deactivate', ['actor'])).toEqual({
      kind: 'unchanged',
    });
  });

  it('reactivates a disabled account; an enabled one is unchanged', () => {
    expect(decide({ ...student, disabledAt: AT }, 'reactivate', [])).toEqual({
      kind: 'apply',
      patch: { disabledAt: null },
    });
    expect(decide(student, 'reactivate', [])).toEqual({ kind: 'unchanged' });
  });

  it('demotes a super admin (themselves included) unless it is the last one', () => {
    expect(decide(superAdmin('actor'), 'demote', ['actor', 'b'], 'actor')).toEqual({
      kind: 'apply',
      patch: { demote: true },
    });
    expect(decide(superAdmin('actor'), 'demote', ['actor'], 'actor')).toEqual({
      kind: 'refuse',
      reason: 'last_super_admin',
    });
    expect(decide(student, 'demote', ['actor'])).toEqual({
      kind: 'refuse',
      reason: 'not_super_admin',
    });
  });
});
