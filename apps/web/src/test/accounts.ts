import type { AuthResponse, AuthUser, DocumentCounts } from '@orghive/shared';

/*
 * Shared organization accounts for tests (docs/DOMAIN_RULES.md, "Accounts"): every
 * organization signs in with one account, and the account's organization decides what it may
 * do. `role` names the kind of account a test signs in as.
 */

export const TEST_ORGS = {
  jpice: {
    id: '0195f3c0-0000-7000-8000-0000000000a1',
    type: 'SBO',
    slug: 'jpice',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
    parentId: '0195f3c0-0000-7000-8000-0000000000c1',
  },
  cscCea: {
    id: '0195f3c0-0000-7000-8000-0000000000c1',
    type: 'CSC',
    slug: 'csc-cea',
    acronym: 'CSC-CEA',
    name: 'Collegiate Student Council of CEA',
    parentId: '0195f3c0-0000-7000-8000-0000000000f1',
  },
  issc: {
    id: '0195f3c0-0000-7000-8000-0000000000f1',
    type: 'ISSC',
    slug: 'issc',
    acronym: 'ISSC',
    name: 'Institutional Supreme Student Council',
    parentId: null,
  },
} satisfies Record<string, NonNullable<AuthUser['organization']>>;

/**
 * - `own`: the organization's own account (it uploads, edits and appeals);
 * - `governing`: its college CSC (reads governing files, decides appeals);
 * - `issc`: the ISSC account (the admin);
 * - `none`: an account acting for no organization.
 */
export type TestAccount = 'own' | 'governing' | 'issc' | 'none';

export function accountUser(
  account: TestAccount = 'own',
  org: NonNullable<AuthUser['organization']> = TEST_ORGS.jpice,
  overrides: Partial<AuthUser> = {},
): AuthUser {
  const organization =
    account === 'own'
      ? org
      : account === 'governing'
        ? TEST_ORGS.cscCea
        : account === 'issc'
          ? TEST_ORGS.issc
          : null;
  return {
    id: '0195f3c0-0000-7000-8000-000000000001',
    name: organization?.acronym ?? 'No organization',
    email: organization ? `${organization.slug}@orghive.test` : 'none@orghive.test',
    mustChangePassword: false,
    organization,
    officerInCharge: organization
      ? { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' }
      : null,
    systemRole: 'NONE',
    mfaSetupRequired: false,
    ...overrides,
  };
}

export function accountSession(
  account: TestAccount = 'own',
  org?: NonNullable<AuthUser['organization']>,
  overrides: Partial<AuthUser> = {},
): AuthResponse {
  return { accessToken: 'test-token', expiresIn: 900, user: accountUser(account, org, overrides) };
}

export const NO_COUNTS: DocumentCounts = {
  public: 0,
  governing: 0,
  private: 0,
  scanning: 0,
  quarantined: 0,
  archived: 0,
};
