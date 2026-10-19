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
