import type { OrganizationType } from '@orghive/shared';

/** What the rules need about the appealing organization. */
export interface AppellantOrg {
  id: string;
  type: OrganizationType;
  /** SBO: its college's CSC. CSC: the ISSC. ISSC: null. */
  parentId: string | null;
}

/** What the rules need about the deciding account's organization. */
export interface DeciderOrg {
  id: string;
  type: OrganizationType;
}

/**
 * Who decides an organization's appeals (docs/PROJECT_WORKFLOW_SPEC.md, 3A; shared accounts,
 * docs/DOMAIN_RULES.md, chosen 2026-10-19). The only place this rule lives.
 * - SBO: its college's CSC account.
 * - CSC: the ISSC account.
 * - ISSC: nobody. Its projects never block or freeze (project-rules.ts), so it never appeals.
 */
export function appealDeciderOf(org: AppellantOrg): { organizationId: string } | null {
  if (org.type === 'ISSC') return null;
  if (!org.parentId) throw new Error(`${org.type} ${org.id} has no parent organization`);
  return { organizationId: org.parentId };
}

export type DecisionAuthority = 'seat' | 'admin_override';

/**
 * Whether the actor's account may decide `appellant`'s appeals: it is the deciding account,
 * or the deciding organization has no active account and the actor is the ISSC (an audited
 * override). Null: it may not.
 */
export function decisionAuthority(
  appellant: AppellantOrg,
  actor: DeciderOrg | null,
  deciderVacant: boolean,
): DecisionAuthority | null {
  const decider = appealDeciderOf(appellant);
  if (!decider || !actor) return null;
  if (actor.id === decider.organizationId) return 'seat';
  if (deciderVacant && actor.type === 'ISSC') return 'admin_override';
  return null;
}
