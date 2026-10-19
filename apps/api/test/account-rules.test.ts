import { describe, expect, it } from 'vitest';
import {
  complianceScopeOf,
  isCouncil,
  isGoverningBodyOf,
  isIssc,
  type OrgPlace,
} from '#src/services/account-rules';

const ISSC: OrgPlace = { id: 'issc', type: 'ISSC', parentId: null };
const CSC_CEA: OrgPlace = { id: 'csc-cea', type: 'CSC', parentId: 'issc' };
const CSC_CAT: OrgPlace = { id: 'csc-cat', type: 'CSC', parentId: 'issc' };
const JPICE: OrgPlace = { id: 'jpice', type: 'SBO', parentId: 'csc-cea' };
const PSME: OrgPlace = { id: 'psme', type: 'SBO', parentId: 'csc-cea' };

describe('isGoverningBodyOf', () => {
  it('is the organization itself, its college CSC, and the ISSC', () => {
    expect(isGoverningBodyOf(JPICE, JPICE)).toBe(true);
    expect(isGoverningBodyOf(CSC_CEA, JPICE)).toBe(true);
    expect(isGoverningBodyOf(ISSC, JPICE)).toBe(true);
    expect(isGoverningBodyOf(ISSC, CSC_CEA)).toBe(true);
  });

  it('is never a sibling, another college CSC, or anyone over the ISSC', () => {
    expect(isGoverningBodyOf(PSME, JPICE)).toBe(false);
    expect(isGoverningBodyOf(CSC_CAT, JPICE)).toBe(false);
    expect(isGoverningBodyOf(CSC_CAT, CSC_CEA)).toBe(false);
    expect(isGoverningBodyOf(JPICE, CSC_CEA)).toBe(false);
    expect(isGoverningBodyOf(CSC_CEA, ISSC)).toBe(false);
  });
});

describe('roles of an account', () => {
  it('knows the ISSC and the councils', () => {
    expect(isIssc(ISSC)).toBe(true);
    expect(isIssc(CSC_CEA)).toBe(false);
    expect(isIssc(null)).toBe(false);
    expect([ISSC, CSC_CEA, JPICE, null].map(isCouncil)).toEqual([true, true, false, false]);
  });

  it('scopes the compliance overview: ISSC sees all, a CSC its SBOs, an SBO none', () => {
    expect(complianceScopeOf(ISSC)).toEqual({ type: 'ISSC' });
    expect(complianceScopeOf(CSC_CEA)).toEqual({ type: 'CSC', cscId: 'csc-cea' });
    expect(complianceScopeOf(JPICE)).toBeNull();
    expect(complianceScopeOf(null)).toBeNull();
  });
});
