import type { SystemRole } from '@orghive/shared';

/*
 * Who may change which account from the /system console. Pure, so the rule lives in one
 * place; the repository runs it inside a transaction that locks every super admin row, so
 * two console sessions can never both remove "the other" last super admin.
 */

export type AccountChange = 'deactivate' | 'reactivate' | 'demote';

export interface AccountState {
  id: string;
  systemRole: SystemRole;
  disabledAt: Date | null;
  mfaEnabledAt: Date | null;
}

export interface AccountPatch {
  disabledAt?: Date | null;
  /** Back to NONE: the authenticator, its secret and the recovery codes are removed. */
  demote?: true;
}

export type AccountRefusal =
  /** Nobody deactivates their own account. */
  | 'self_deactivation'
  /** At least one active super admin must remain. */
  | 'last_super_admin'
  | 'not_super_admin';

export type AccountDecision =
  | { kind: 'apply'; patch: AccountPatch }
  /** Already in the requested state: nothing to write or audit. */
  | { kind: 'unchanged' }
  | { kind: 'refuse'; reason: AccountRefusal };

/** Can sign in to /system right now: SUPER_ADMIN, not disabled, authenticator confirmed. */
export function isActiveSuperAdmin(account: AccountState): boolean {
  return (
    account.systemRole === 'SUPER_ADMIN' &&
    account.disabledAt === null &&
    account.mfaEnabledAt !== null
  );
}

export interface AccountChangeInput {
  actorId: string;
  target: AccountState;
  change: AccountChange;
  /** Every active super admin, read under the lock. */
  activeSuperAdminIds: string[];
  at: Date;
}

export function decideAccountChange({
  actorId,
  target,
  change,
  activeSuperAdminIds,
  at,
}: AccountChangeInput): AccountDecision {
  const othersRemain = activeSuperAdminIds.some((id) => id !== target.id);
  const removesLast = isActiveSuperAdmin(target) && !othersRemain;

  switch (change) {
    case 'deactivate':
      if (target.id === actorId) return { kind: 'refuse', reason: 'self_deactivation' };
      if (target.disabledAt) return { kind: 'unchanged' };
      if (removesLast) return { kind: 'refuse', reason: 'last_super_admin' };
      return { kind: 'apply', patch: { disabledAt: at } };

    case 'reactivate':
      if (!target.disabledAt) return { kind: 'unchanged' };
      return { kind: 'apply', patch: { disabledAt: null } };

    case 'demote':
      if (target.systemRole !== 'SUPER_ADMIN') return { kind: 'refuse', reason: 'not_super_admin' };
      if (removesLast) return { kind: 'refuse', reason: 'last_super_admin' };
      return { kind: 'apply', patch: { demote: true } };
  }
}
