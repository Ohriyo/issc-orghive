import { describe, expect, it } from 'vitest';
import {
  appealDeciderOf,
  decisionAuthority,
  type AppellantOrg,
  type DeciderOrg,
} from '#src/services/appeal-rules';

const ISSC: AppellantOrg = { id: 'issc', type: 'ISSC', parentId: null };
const CSC_CEA: AppellantOrg = { id: 'csc-cea', type: 'CSC', parentId: 'issc' };
const JPICE: AppellantOrg = { id: 'jpice', type: 'SBO', parentId: 'csc-cea' };
const account = (org: AppellantOrg): DeciderOrg => ({ id: org.id, type: org.type });
const CSC_CAT: DeciderOrg = { id: 'csc-cat', type: 'CSC' };

describe('appealDeciderOf', () => {
  it('sends an SBO to its college CSC account and a CSC to the ISSC account', () => {
    expect(appealDeciderOf(JPICE)).toEqual({ organizationId: 'csc-cea' });
    expect(appealDeciderOf(CSC_CEA)).toEqual({ organizationId: 'issc' });
  });

  it('names nobody for the ISSC, which never appeals', () => {
    expect(appealDeciderOf(ISSC)).toBeNull();
  });

  it('refuses an SBO or CSC without a parent', () => {
    expect(() => appealDeciderOf({ id: 'x', type: 'SBO', parentId: null })).toThrow(/parent/);
  });
});

describe('decisionAuthority', () => {
  it('is the seat for the parent organization account only', () => {
    expect(decisionAuthority(JPICE, account(CSC_CEA), false)).toBe('seat');
    expect(decisionAuthority(CSC_CEA, account(ISSC), false)).toBe('seat');
    expect(decisionAuthority(JPICE, CSC_CAT, false)).toBeNull();
    expect(decisionAuthority(JPICE, account(JPICE), false)).toBeNull();
  });

  it('lets the ISSC account decide only while the deciding seat is vacant (audited)', () => {
    expect(decisionAuthority(JPICE, account(ISSC), false)).toBeNull();
    expect(decisionAuthority(JPICE, account(ISSC), true)).toBe('admin_override');
    expect(decisionAuthority(JPICE, CSC_CAT, true)).toBeNull();
  });

  it('gives nobody authority over the ISSC, and nothing to an account without an organization', () => {
    expect(decisionAuthority(ISSC, account(ISSC), true)).toBeNull();
    expect(decisionAuthority(JPICE, null, true)).toBeNull();
  });
});
