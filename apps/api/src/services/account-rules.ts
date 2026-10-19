import type { OrganizationType } from '@orghive/shared';

/*
 * Who governs whom, between shared organization accounts (docs/DOMAIN_RULES.md, "Accounts").
 * Pure, so each rule lives here once and is tested on its own:
 * - an SBO is governed by its college's CSC and by the ISSC;
 * - a CSC by the ISSC;
 * - the ISSC by nobody.
 * The document visibility filter (document-visibility.ts) expresses the same rule in SQL, and
 * its tests check it against isGoverningBodyOf.
 */

export interface OrgPlace {
  id: string;
  type: OrganizationType;
  /** An SBO's college CSC; a CSC's ISSC; null for the ISSC. */
  parentId: string | null;
}

/** The organization itself, or one of its governing bodies. */
export function isGoverningBodyOf(viewer: OrgPlace, target: OrgPlace): boolean {
  if (viewer.id === target.id) return true;
  if (viewer.type === 'ISSC') return true;
  return viewer.type === 'CSC' && target.type === 'SBO' && target.parentId === viewer.id;
}

/** The ISSC account manages organizations (/admin). */
export function isIssc(org: OrgPlace | null | undefined): boolean {
  return org?.type === 'ISSC';
}

/** Councils (the ISSC and the CSCs) post updates and decide appeals. */
export function isCouncil(org: OrgPlace | null | undefined): boolean {
  return org?.type === 'ISSC' || org?.type === 'CSC';
}

/**
 * Which compliance overview an account sees: the ISSC sees every CSC and SBO; a CSC sees its
 * college's SBOs; an SBO sees none.
 */
export type ComplianceScope = { type: 'ISSC' } | { type: 'CSC'; cscId: string };

export function complianceScopeOf(org: OrgPlace | null): ComplianceScope | null {
  if (org?.type === 'ISSC') return { type: 'ISSC' };
  if (org?.type === 'CSC') return { type: 'CSC', cscId: org.id };
  return null;
}

/**
 * Where a new temporary password goes (docs/DOMAIN_RULES.md, "Accounts"): every
 * organization's goes to the ISSC account's one-time Reveal, so the ISSC hands it over and
 * the super admin never sees it; the ISSC account's own is shown once to the super admin who
 * issued it, since nobody else could receive it.
 */
export function passwordRecipientOf(org: { type: OrganizationType }): 'issc_reveal' | 'shown_once' {
  return org.type === 'ISSC' ? 'shown_once' : 'issc_reveal';
}

/**
 * ACCOUNT_EMAIL_DOMAINS: an organization account's email must be at one of these domains;
 * an empty list allows any. Returns the refusal message, or null when allowed.
 */
export function accountEmailRefusal(email: string, domains: string[]): string | null {
  if (domains.length === 0) return null;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return domains.includes(domain) ? null : `Use an address at ${domains.join(' or ')}`;
}
