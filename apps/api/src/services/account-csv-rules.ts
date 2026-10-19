import {
  accountEmailOfRow,
  officerOfRow,
  type AccountCsvRow,
  type AccountCsvRowResult,
  type OfficerInChargeInput,
  type OrganizationType,
} from '@orghive/shared';
import { accountEmailRefusal } from './account-rules';

/*
 * The CSV imports' rules, in one pure place (docs/DOMAIN_RULES.md, "Accounts"): which rows of
 * a bulk creation or an end of term apply, which are skipped, and why the others cannot.
 * The services only apply the plan.
 */

/** An organization as the imports see it, with its active account if it has one. */
export interface ImportOrganization {
  id: string;
  slug: string;
  acronym: string;
  name: string;
  type: OrganizationType;
  collegeCode: string | null;
  collegeSlug: string | null;
  account: { id: string; email: string } | null;
}

const norm = (value: string) => value.trim().toLowerCase();

/**
 * The organization a row names, by acronym, slug or full name (any case). When the row
 * also names a college, it must be the organization's.
 */
export function matchOrganization(
  row: AccountCsvRow,
  orgs: ImportOrganization[],
): { org: ImportOrganization } | { error: string } {
  const wanted = norm(row.organization);
  if (!wanted) return { error: 'Name the organization' };
  const found = orgs.filter(
    (o) => norm(o.acronym) === wanted || norm(o.slug) === wanted || norm(o.name) === wanted,
  );
  if (found.length === 0) return { error: `No organization "${row.organization}"` };
  const college = norm(row.college);
  const inCollege = college
    ? found.filter(
        (o) => norm(o.collegeCode ?? '') === college || norm(o.collegeSlug ?? '') === college,
      )
    : found;
  if (inCollege.length === 0) {
    return { error: `${found[0]!.acronym} is not in college "${row.college}"` };
  }
  if (inCollege.length > 1)
    return { error: `"${row.organization}" matches several; add the college` };
  return { org: inCollege[0]! };
}

function officerErrors(
  row: AccountCsvRow,
): { officer: OfficerInChargeInput } | { errors: string[] } {
  const parsed = officerOfRow(row);
  if (parsed.success) return { officer: parsed.data };
  return {
    errors: parsed.error.issues.map((issue) => {
      const field =
        issue.path[0] === 'name'
          ? 'Officer name'
          : issue.path[0] === 'position'
            ? 'Position'
            : 'Contact email';
      return `${field}: ${issue.message}`;
    }),
  };
}

export interface PlannedAccount {
  line: number;
  org: ImportOrganization;
  accountEmail: string;
  officer: OfficerInChargeInput;
}

/**
 * Bulk creation: CSC and SBO rows only. An organization that already has an account is
 * skipped. The sign-in email is the row's "account email", or <slug>@<first allowed
 * domain> when the row leaves it blank. Emails taken already, or twice in the file, are
 * errors, as is a second row for one organization.
 */
export function planBulkCreate(
  rows: AccountCsvRow[],
  orgs: ImportOrganization[],
  { domains, takenEmails }: { domains: string[]; takenEmails: Set<string> },
): { results: AccountCsvRowResult[]; accounts: PlannedAccount[] } {
  const results: AccountCsvRowResult[] = [];
  const accounts: PlannedAccount[] = [];
  const seenOrgs = new Set<string>();
  const seenEmails = new Set<string>();

  for (const row of rows) {
    const messages: string[] = [];
    const match = matchOrganization(row, orgs);
    const org = 'org' in match ? match.org : null;
    if (!org) messages.push((match as { error: string }).error);
    if (org?.type === 'ISSC') messages.push('Create the ISSC account from the form, not a file');

    const rawEmail = row.accountEmail || (org && domains[0] ? `${org.slug}@${domains[0]}` : '');
    let accountEmail: string | null = null;
    if (!rawEmail) {
      messages.push('Add an account email (or set ACCOUNT_EMAIL_DOMAINS for a default)');
    } else {
      const email = accountEmailOfRow(rawEmail);
      if (!email.success) {
        messages.push(`Account email: ${email.error.issues[0]?.message ?? 'invalid'}`);
      } else {
        accountEmail = email.data;
        const refusal = accountEmailRefusal(accountEmail, domains);
        if (refusal) messages.push(`Account email: ${refusal}`);
        else if (takenEmails.has(accountEmail))
          messages.push(`${accountEmail} already has an account`);
        else if (seenEmails.has(accountEmail))
          messages.push(`${accountEmail} is used twice in this file`);
      }
    }
    const officer = officerErrors(row);
    if ('errors' in officer) messages.push(...officer.errors);
    if (org && seenOrgs.has(org.id)) messages.push(`${org.acronym} is listed twice in this file`);

    const base = {
      line: row.line,
      organization: org?.acronym ?? row.organization,
      accountEmail,
      officerName: row.officerName,
    };
    if (messages.length > 0) {
      results.push({ ...base, action: 'error', messages });
    } else if (org!.account) {
      results.push({
        ...base,
        action: 'skip',
        messages: [`${org!.acronym} already has an account`],
      });
    } else {
      results.push({ ...base, action: 'create', messages: [] });
      accounts.push({
        line: row.line,
        org: org!,
        accountEmail: accountEmail!,
        officer: (officer as { officer: OfficerInChargeInput }).officer,
      });
    }
    if (org) seenOrgs.add(org.id);
    if (accountEmail) seenEmails.add(accountEmail);
  }
  return { results, accounts };
}

export interface PlannedAssignment {
  line: number;
  org: ImportOrganization;
  account: { id: string; email: string };
  officer: OfficerInChargeInput;
}

/**
 * The end of term: every row names an organization that has an account, once, with its
 * incoming officer in charge. Accounts not in the file are locked until assigned. The ISSC
 * must be in the file: its account receives everyone else's new password.
 */
export function planEndOfTerm(
  rows: AccountCsvRow[],
  orgs: ImportOrganization[],
): {
  results: AccountCsvRowResult[];
  assignments: PlannedAssignment[];
  toLock: ImportOrganization[];
  problems: string[];
} {
  const results: AccountCsvRowResult[] = [];
  const assignments: PlannedAssignment[] = [];
  const assigned = new Set<string>();

  for (const row of rows) {
    const messages: string[] = [];
    const match = matchOrganization(row, orgs);
    const org = 'org' in match ? match.org : null;
    if (!org) messages.push((match as { error: string }).error);
    else if (!org.account) messages.push(`${org.acronym} has no account yet; create it first`);
    else if (assigned.has(org.id)) messages.push(`${org.acronym} is listed twice in this file`);
    const officer = officerErrors(row);
    if ('errors' in officer) messages.push(...officer.errors);

    const base = {
      line: row.line,
      organization: org?.acronym ?? row.organization,
      accountEmail: org?.account?.email ?? null,
      officerName: row.officerName,
    };
    if (messages.length > 0) {
      results.push({ ...base, action: 'error', messages });
    } else {
      results.push({ ...base, action: 'assign', messages: [] });
      assignments.push({
        line: row.line,
        org: org!,
        account: org!.account!,
        officer: (officer as { officer: OfficerInChargeInput }).officer,
      });
    }
    if (org) assigned.add(org.id);
  }

  const toLock = orgs.filter((o) => o.account && !assigned.has(o.id));
  const problems: string[] = [];
  const issc = orgs.find((o) => o.type === 'ISSC');
  if (!issc?.account) {
    problems.push('There is no ISSC account to receive the new passwords. Create it first.');
  } else if (!assignments.some((a) => a.org.id === issc.id)) {
    problems.push('Add the ISSC to the file: its account receives everyone else’s new password.');
  }
  return { results, assignments, toLock, problems };
}
