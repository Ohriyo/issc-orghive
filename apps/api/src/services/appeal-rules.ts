import type { MembershipRole, OrganizationType } from '@orghive/shared';

/** What the rules need about the appealing organization. */
export interface AppellantOrg {
  id: string;
  type: OrganizationType;
  /** SBO: its college's CSC. CSC: the ISSC. ISSC: null. */
  parentId: string | null;
}

/** What the rules need about one of the actor's active memberships. */
export interface DeciderMembership {
  role: MembershipRole;
  isHead: boolean;
  organization: { id: string; type: OrganizationType };
}

/**
 * Who decides an organization's appeals (docs/PROJECT_WORKFLOW_SPEC.md, 3A; provisional
 * details in docs/DOMAIN_RULES.md, 2026-10-17). The only place this rule lives.
 * - SBO: its college's CSC, through the CSC's head (the Governor).
 * - CSC: the ISSC only, through its head (the President).
 * - ISSC: the ISSC adviser (the spec does not cover the ISSC; the project owner chose this).
 */
export function appealDeciderOf(org: AppellantOrg): {
  organizationId: string;
  seat: 'head' | 'adviser';
} {
  if (org.type === 'ISSC') return { organizationId: org.id, seat: 'adviser' };
  if (!org.parentId) throw new Error(`${org.type} ${org.id} has no parent organization`);
  return { organizationId: org.parentId, seat: 'head' };
}

/** Whether a membership holds the seat that decides `appellant`'s appeals. */
export function holdsDecidingSeat(appellant: AppellantOrg, m: DeciderMembership): boolean {
  const decider = appealDeciderOf(appellant);
  if (m.organization.id !== decider.organizationId) return false;
  return decider.seat === 'adviser' ? m.role === 'adviser' : m.isHead;
}

export type DecisionAuthority = 'seat' | 'admin_override';

/**
 * Whether the actor may decide `appellant`'s appeals: they hold the deciding seat, or the
 * seat is vacant and they are an ISSC admin (an audited override). Null: they may not.
 */
export function decisionAuthority(
  appellant: AppellantOrg,
  actor: readonly DeciderMembership[],
  seatFilled: boolean,
): DecisionAuthority | null {
  if (actor.some((m) => holdsDecidingSeat(appellant, m))) return 'seat';
  const isAdmin = actor.some((m) => m.role === 'admin' && m.organization.type === 'ISSC');
  if (!seatFilled && isAdmin) return 'admin_override';
  return null;
}
