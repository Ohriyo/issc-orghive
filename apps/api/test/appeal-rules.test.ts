import { describe, expect, it } from 'vitest';
import {
  appealDeciderOf,
  decisionAuthority,
  holdsDecidingSeat,
  type AppellantOrg,
  type DeciderMembership,
} from '#src/services/appeal-rules';

const ISSC: AppellantOrg = { id: 'issc', type: 'ISSC', parentId: null };
const CSC_CEA: AppellantOrg = { id: 'csc-cea', type: 'CSC', parentId: 'issc' };
const CSC_CAT: AppellantOrg = { id: 'csc-cat', type: 'CSC', parentId: 'issc' };
const JPICE: AppellantOrg = { id: 'jpice', type: 'SBO', parentId: 'csc-cea' };

function member(
  org: AppellantOrg,
  role: DeciderMembership['role'],
  isHead = false,
): DeciderMembership {
  return { role, isHead, organization: { id: org.id, type: org.type } };
}

const ceaGovernor = member(CSC_CEA, 'officer', true);
const ceaOfficer = member(CSC_CEA, 'officer');
const catGovernor = member(CSC_CAT, 'officer', true);
const isscPresident = member(ISSC, 'officer', true);
const isscAdviser = member(ISSC, 'adviser');
const admin = member(ISSC, 'admin');

describe('appealDeciderOf', () => {
  it('sends an SBO appeal to its college CSC, a CSC appeal to the ISSC', () => {
    expect(appealDeciderOf(JPICE)).toEqual({ organizationId: 'csc-cea', seat: 'head' });
    expect(appealDeciderOf(CSC_CEA)).toEqual({ organizationId: 'issc', seat: 'head' });
  });

  it('sends the ISSC’s own appeals to its adviser', () => {
    expect(appealDeciderOf(ISSC)).toEqual({ organizationId: 'issc', seat: 'adviser' });
  });

  it('refuses an SBO or CSC without a parent (broken data)', () => {
    expect(() => appealDeciderOf({ id: 'x', type: 'SBO', parentId: null })).toThrow();
  });
});

describe('holdsDecidingSeat', () => {
  it('SBO appeals: only the head of the SBO’s own CSC', () => {
    expect(holdsDecidingSeat(JPICE, ceaGovernor)).toBe(true);
    expect(holdsDecidingSeat(JPICE, ceaOfficer)).toBe(false);
    expect(holdsDecidingSeat(JPICE, catGovernor)).toBe(false);
    // Not the ISSC: SBO appeals stop at the CSC.
    expect(holdsDecidingSeat(JPICE, isscPresident)).toBe(false);
  });

  it('CSC appeals: only the ISSC head, never another CSC', () => {
    expect(holdsDecidingSeat(CSC_CEA, isscPresident)).toBe(true);
    expect(holdsDecidingSeat(CSC_CEA, catGovernor)).toBe(false);
    expect(holdsDecidingSeat(CSC_CEA, ceaGovernor)).toBe(false);
    expect(holdsDecidingSeat(CSC_CEA, isscAdviser)).toBe(false);
  });

  it('ISSC appeals: the ISSC adviser, not its President', () => {
    expect(holdsDecidingSeat(ISSC, isscAdviser)).toBe(true);
    expect(holdsDecidingSeat(ISSC, isscPresident)).toBe(false);
  });
});

describe('decisionAuthority', () => {
  it('lets the seat holder decide', () => {
    expect(decisionAuthority(JPICE, [ceaOfficer, ceaGovernor], true)).toBe('seat');
  });

  it('refuses everyone else, admins included, while the seat is filled', () => {
    expect(decisionAuthority(JPICE, [ceaOfficer], true)).toBeNull();
    expect(decisionAuthority(JPICE, [admin], true)).toBeNull();
    expect(decisionAuthority(JPICE, [], true)).toBeNull();
  });

  it('lets an ISSC admin decide (audited) only while the seat is vacant', () => {
    expect(decisionAuthority(CSC_CEA, [admin], false)).toBe('admin_override');
    expect(decisionAuthority(CSC_CEA, [ceaGovernor], false)).toBeNull();
  });

  it('an admin on another organization is not a system admin', () => {
    expect(decisionAuthority(JPICE, [member(CSC_CAT, 'admin')], false)).toBeNull();
  });
});
