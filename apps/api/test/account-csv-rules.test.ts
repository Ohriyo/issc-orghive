import { describe, expect, it } from 'vitest';
import type { AccountCsvRow } from '@orghive/shared';
import {
  matchOrganization,
  planBulkCreate,
  planEndOfTerm,
  type ImportOrganization,
} from '#src/services/account-csv-rules';

const org = (
  slug: string,
  acronym: string,
  type: ImportOrganization['type'],
  account: string | null,
  college: string | null = 'CEA',
): ImportOrganization => ({
  id: `id-${slug}`,
  slug,
  acronym,
  name: `${acronym} full name`,
  type,
  collegeCode: college,
  collegeSlug: college?.toLowerCase() ?? null,
  account: account ? { id: `user-${slug}`, email: account } : null,
});

const ORGS = [
  org('issc', 'ISSC', 'ISSC', 'issc@nwssu.test', null),
  org('csc-cea', 'CSC-CEA', 'CSC', 'csc-cea@nwssu.test'),
  org('jpice', 'JPICE', 'SBO', 'jpice@nwssu.test'),
  org('iecep', 'IECEP', 'SBO', null),
  org('psme', 'PSME', 'SBO', null),
  org('ssc', 'SSC', 'SBO', null, 'CAT'),
  org('ssc-ccis', 'SSC', 'SBO', null, 'CCIS'),
];

let line = 1;
const row = (overrides: Partial<AccountCsvRow>): AccountCsvRow => ({
  line: ++line,
  organization: 'IECEP',
  college: '',
  officerName: 'Rosa Lim',
  officerPosition: 'President',
  officerEmail: 'rosa@nwssu.test',
  accountEmail: '',
  ...overrides,
});

describe('matchOrganization', () => {
  it('finds by acronym, slug or name, in any case; a college tells same acronyms apart', () => {
    expect(matchOrganization(row({ organization: 'iecep' }), ORGS)).toEqual({ org: ORGS[3] });
    expect(matchOrganization(row({ organization: 'CSC-CEA' }), ORGS)).toEqual({ org: ORGS[1] });
    expect(matchOrganization(row({ organization: 'PSME full name' }), ORGS)).toEqual({
      org: ORGS[4],
    });
    expect(matchOrganization(row({ organization: 'SSC' }), ORGS)).toMatchObject({
      error: expect.stringMatching(/matches several/) as unknown,
    });
    expect(matchOrganization(row({ organization: 'SSC', college: 'ccis' }), ORGS)).toEqual({
      org: ORGS[6],
    });
    expect(matchOrganization(row({ organization: 'JPICE', college: 'CAT' }), ORGS)).toEqual({
      error: 'JPICE is not in college "CAT"',
    });
    expect(matchOrganization(row({ organization: 'Nope' }), ORGS)).toEqual({
      error: 'No organization "Nope"',
    });
  });
});

describe('planBulkCreate', () => {
  const plan = (rows: AccountCsvRow[], domains: string[] = [], taken: string[] = []) =>
    planBulkCreate(rows, ORGS, { domains, takenEmails: new Set(taken) });

  it('creates rows for organizations without an account, skips the others', () => {
    const { results, accounts } = plan([
      row({ organization: 'IECEP', accountEmail: 'iecep@nwssu.test' }),
      row({ organization: 'JPICE', accountEmail: 'jpice2@nwssu.test' }),
    ]);
    expect(results.map((r) => r.action)).toEqual(['create', 'skip']);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      accountEmail: 'iecep@nwssu.test',
      officer: { name: 'Rosa Lim' },
    });
  });

  it('defaults the sign-in email to <slug>@<first domain>', () => {
    const { accounts, results } = plan([row({ organization: 'PSME' })], ['nwssu.edu.ph']);
    expect(results[0]!.action).toBe('create');
    expect(accounts[0]!.accountEmail).toBe('psme@nwssu.edu.ph');
    expect(plan([row({ organization: 'PSME' })]).results[0]!.messages).toEqual([
      'Add an account email (or set ACCOUNT_EMAIL_DOMAINS for a default)',
    ]);
  });

  it('lists every reason a row cannot be created', () => {
    const { results } = plan(
      [
        row({ organization: 'ISSC', accountEmail: 'x@nwssu.edu.ph' }),
        row({ organization: 'IECEP', accountEmail: 'taken@nwssu.edu.ph' }),
        row({ organization: 'PSME', accountEmail: 'psme@gmail.com', officerEmail: 'bad' }),
        row({ organization: 'IECEP', accountEmail: 'iecep@nwssu.edu.ph', officerName: '' }),
      ],
      ['nwssu.edu.ph'],
      ['taken@nwssu.edu.ph'],
    );
    expect(results.map((r) => r.action)).toEqual(['error', 'error', 'error', 'error']);
    expect(results[0]!.messages).toContain('Create the ISSC account from the form, not a file');
    expect(results[1]!.messages).toEqual(['taken@nwssu.edu.ph already has an account']);
    expect(results[2]!.messages).toEqual([
      'Account email: Use an address at nwssu.edu.ph',
      'Contact email: Enter a valid email',
    ]);
    expect(results[3]!.messages).toEqual([
      'Officer name: Enter a name',
      'IECEP is listed twice in this file',
    ]);
  });

  it('refuses an email used twice in the file', () => {
    const { results } = plan([
      row({ organization: 'IECEP', accountEmail: 'same@nwssu.test' }),
      row({ organization: 'PSME', accountEmail: 'same@nwssu.test' }),
    ]);
    expect(results.map((r) => r.action)).toEqual(['create', 'error']);
    expect(results[1]!.messages).toEqual(['same@nwssu.test is used twice in this file']);
  });
});

describe('planEndOfTerm', () => {
  it('assigns the listed accounts and locks the rest; the ISSC must be listed', () => {
    const plan = planEndOfTerm(
      [row({ organization: 'ISSC' }), row({ organization: 'JPICE', officerName: 'Ana Cruz' })],
      ORGS,
    );
    expect(plan.results.map((r) => r.action)).toEqual(['assign', 'assign']);
    expect(plan.assignments.map((a) => a.account.email)).toEqual([
      'issc@nwssu.test',
      'jpice@nwssu.test',
    ]);
    expect(plan.toLock.map((o) => o.acronym)).toEqual(['CSC-CEA']);
    expect(plan.problems).toEqual([]);

    const withoutIssc = planEndOfTerm([row({ organization: 'JPICE' })], ORGS);
    expect(withoutIssc.problems).toEqual([
      'Add the ISSC to the file: its account receives everyone else’s new password.',
    ]);
  });

  it('refuses organizations without an account and repeated rows', () => {
    const plan = planEndOfTerm(
      [
        row({ organization: 'ISSC' }),
        row({ organization: 'IECEP' }),
        row({ organization: 'issc' }),
      ],
      ORGS,
    );
    expect(plan.results.map((r) => r.action)).toEqual(['assign', 'error', 'error']);
    expect(plan.results[1]!.messages).toEqual(['IECEP has no account yet; create it first']);
    expect(plan.results[2]!.messages).toEqual(['ISSC is listed twice in this file']);
  });

  it('cannot run without an ISSC account', () => {
    const noIssc = ORGS.map((o) => (o.type === 'ISSC' ? { ...o, account: null } : o));
    expect(planEndOfTerm([row({ organization: 'JPICE' })], noIssc).problems).toEqual([
      'There is no ISSC account to receive the new passwords. Create it first.',
    ]);
  });
});
