import { randomUUID } from 'node:crypto';
import {
  ErrorCode,
  readAccountCsv,
  type AccountCsvRowResult,
  type BulkAccountsResult,
  type EndOfTermResult,
  type RevealEntry,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { generateTemporaryPassword } from '#src/lib/temporary-password';
import { DuplicateAccountError } from '#src/repositories/account-admin.repository';
import type { AccountImportRepository } from '#src/repositories/account-import.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { ConsoleActor } from '#src/services/account-admin.service';
import {
  planBulkCreate,
  planEndOfTerm,
  type ImportOrganization,
} from '#src/services/account-csv-rules';
import type { RevealService } from '#src/services/reveal.service';

export interface AccountImportServiceDeps {
  imports: AccountImportRepository;
  reveals: Pick<RevealService, 'deliver'>;
  passwords: { hash(password: string): Promise<string> };
  audit: Pick<AuditLogRepository, 'record'>;
  emailDomains: string[];
  now?: () => Date;
}

const BULK_COLUMNS = ['organization', 'officerName', 'officerPosition', 'officerEmail'] as const;
const LOCK_REASON = 'End of term: no incoming officer in charge assigned yet';

function count<T extends string>(rows: AccountCsvRowResult[], action: T) {
  return rows.filter((r) => r.action === action).length;
}

/**
 * The /system CSV imports (docs/DOMAIN_RULES.md, "Accounts"): creating many organizations'
 * accounts at once, and the end of term. A preview changes nothing; the run re-checks the
 * same file and saves it in one transaction. Every new temporary password goes to the ISSC
 * account's one-time Reveal as one handover list; at the end of term the ISSC account's own
 * is shown once to the super admin instead. Every account change is audited under the run's id.
 */
export function createAccountImportService(deps: AccountImportServiceDeps) {
  const { imports, audit } = deps;
  const now = deps.now ?? (() => new Date());

  function read(csv: string) {
    const table = readAccountCsv(csv, [...BULK_COLUMNS]);
    if (!table.ok) throw new AppError(400, ErrorCode.VALIDATION_ERROR, `csv: ${table.error}`);
    return table.rows;
  }

  async function bulkPlan(csv: string) {
    const rows = read(csv);
    const orgs: ImportOrganization[] = await imports.organizations();
    const candidates = rows
      .map((r) => r.accountEmail.toLowerCase())
      .concat(deps.emailDomains[0] ? orgs.map((o) => `${o.slug}@${deps.emailDomains[0]}`) : [])
      .filter(Boolean);
    const plan = planBulkCreate(rows, orgs, {
      domains: deps.emailDomains,
      takenEmails: await imports.takenEmails(candidates),
    });
    const issc = orgs.find((o) => o.type === 'ISSC');
    const problems = issc?.account
      ? []
      : ['There is no ISSC account to receive the temporary passwords. Create it first.'];
    return { ...plan, problems, isscAccountId: issc?.account?.id ?? null };
  }

  async function endPlan(csv: string) {
    const rows = read(csv);
    const orgs = await imports.organizations();
    return planEndOfTerm(rows, orgs);
  }

  return {
    async previewBulk(csv: string): Promise<BulkAccountsResult> {
      const plan = await bulkPlan(csv);
      return {
        runId: null,
        problems: plan.problems,
        rows: plan.results,
        counts: {
          create: count(plan.results, 'create'),
          skip: count(plan.results, 'skip'),
          error: count(plan.results, 'error'),
        },
        revealExpiresAt: null,
      };
    },

    /**
     * Creates the accounts of the rows that can be: rows with errors and organizations that
     * have an account are left out (the report lists them). One transaction, one handover.
     */
    async bulkCreate(actor: ConsoleActor, csv: string): Promise<BulkAccountsResult> {
      const plan = await bulkPlan(csv);
      if (plan.problems.length > 0) throw AppError.conflict(plan.problems[0]!);
      if (plan.accounts.length === 0) {
        throw AppError.conflict('No row can be created. Check the preview for why.');
      }
      const runId = randomUUID();
      const at = now();
      const passwords = plan.accounts.map(() => generateTemporaryPassword());
      const hashes = await Promise.all(passwords.map((p) => deps.passwords.hash(p)));
      const ids = await imports
        .createAccounts(
          plan.accounts.map((a, i) => ({
            organizationId: a.org.id,
            email: a.accountEmail,
            name: a.org.acronym,
            passwordHash: hashes[i]!,
            officer: a.officer,
          })),
          at,
        )
        .catch((err: unknown) => {
          if (err instanceof DuplicateAccountError) {
            throw AppError.conflict('An account was created meanwhile. Preview the file again.');
          }
          throw err;
        });

      const entries: RevealEntry[] = plan.accounts.map((a, i) => ({
        organization: { acronym: a.org.acronym, name: a.org.name, type: a.org.type },
        email: a.accountEmail,
        temporaryPassword: passwords[i]!,
        officerInCharge: a.officer,
      }));
      const { expiresAt } = await deps.reveals.deliver({
        recipientId: plan.isscAccountId!,
        purpose: 'bulk_created',
        entries,
        issuedById: actor.userId,
        title: `Handover list: ${entries.length} new ${entries.length === 1 ? 'account' : 'accounts'}`,
        body: `Reveal the temporary passwords once, within 7 days, and hand each to its officer in charge. Each must be changed at the first sign-in. This message never contains a password.`,
      });
      for (const [i, a] of plan.accounts.entries()) {
        await audit.record({
          action: 'account_create',
          actorId: actor.userId,
          entityType: 'user',
          entityId: ids[i]!,
          organizationId: a.org.id,
          metadata: { organization: a.org.slug, delivery: 'reveal', bulkRunId: runId },
          ip: actor.ctx.ip,
          userAgent: actor.ctx.userAgent,
        });
      }
      return {
        runId,
        problems: [],
        rows: plan.results,
        counts: {
          create: count(plan.results, 'create'),
          skip: count(plan.results, 'skip'),
          error: count(plan.results, 'error'),
        },
        revealExpiresAt: expiresAt.toISOString(),
      };
    },

    async previewEndOfTerm(csv: string): Promise<EndOfTermResult> {
      const plan = await endPlan(csv);
      return {
        runId: null,
        problems: plan.problems,
        rows: plan.results,
        toLock: plan.toLock.map((o) => ({ organization: o.acronym, email: o.account!.email })),
        counts: {
          assign: count(plan.results, 'assign'),
          lock: plan.toLock.length,
          error: count(plan.results, 'error'),
        },
        isscTemporaryPassword: null,
        revealExpiresAt: null,
      };
    },

    /**
     * The end of term. Refused (409) while the file has any error or problem: it changes
     * every account at once, so it runs only as previewed.
     */
    async endOfTerm(
      actor: ConsoleActor,
      csv: string,
      termEnd: string | null,
    ): Promise<EndOfTermResult> {
      const plan = await endPlan(csv);
      if (plan.problems.length > 0) throw AppError.conflict(plan.problems[0]!);
      if (plan.results.some((r) => r.action === 'error')) {
        throw AppError.conflict('Fix the rows with errors first, then preview again.');
      }
      const runId = randomUUID();
      const at = now();
      const passwords = plan.assignments.map(() => generateTemporaryPassword());
      const hashes = await Promise.all(passwords.map((p) => deps.passwords.hash(p)));
      await imports.endOfTerm({
        reassign: plan.assignments.map((a, i) => ({
          userId: a.account.id,
          organizationId: a.org.id,
          passwordHash: hashes[i]!,
          officer: a.officer,
        })),
        lock: plan.toLock.map((o) => o.account!.id),
        lockReason: LOCK_REASON,
        termEnd: termEnd ? new Date(`${termEnd}T00:00:00Z`) : null,
        now: at,
      });

      const isscIndex = plan.assignments.findIndex((a) => a.org.type === 'ISSC');
      const isscAccount = plan.assignments[isscIndex]!.account;
      const others = plan.assignments
        .map((a, i) => ({ a, password: passwords[i]! }))
        .filter(({ a }) => a.org.type !== 'ISSC');
      let revealExpiresAt: string | null = null;
      if (others.length > 0) {
        const { expiresAt } = await deps.reveals.deliver({
          recipientId: isscAccount.id,
          purpose: 'end_of_term',
          entries: others.map(({ a, password }) => ({
            organization: { acronym: a.org.acronym, name: a.org.name, type: a.org.type },
            email: a.account.email,
            temporaryPassword: password,
            officerInCharge: a.officer,
          })),
          issuedById: actor.userId,
          title: `End of term: ${others.length} new ${others.length === 1 ? 'password' : 'passwords'} to hand over`,
          body: 'Reveal the incoming officers’ temporary passwords once, within 7 days, and hand each to its officer in charge. Each must be changed at the first sign-in. This message never contains a password.',
        });
        revealExpiresAt = expiresAt.toISOString();
      }

      for (const a of plan.assignments) {
        await audit.record({
          action: 'end_of_term',
          actorId: actor.userId,
          entityType: 'user',
          entityId: a.account.id,
          organizationId: a.org.id,
          metadata: { runId, change: 'assigned', officer: a.officer.name },
          ip: actor.ctx.ip,
          userAgent: actor.ctx.userAgent,
        });
      }
      for (const o of plan.toLock) {
        await audit.record({
          action: 'end_of_term',
          actorId: actor.userId,
          entityType: 'user',
          entityId: o.account!.id,
          organizationId: o.id,
          metadata: { runId, change: 'locked' },
          ip: actor.ctx.ip,
          userAgent: actor.ctx.userAgent,
        });
      }
      await audit.record({
        action: 'end_of_term',
        actorId: actor.userId,
        entityType: 'system',
        metadata: { runId, assigned: plan.assignments.length, locked: plan.toLock.length },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });

      return {
        runId,
        problems: [],
        rows: plan.results,
        toLock: plan.toLock.map((o) => ({ organization: o.acronym, email: o.account!.email })),
        counts: { assign: plan.assignments.length, lock: plan.toLock.length, error: 0 },
        isscTemporaryPassword: passwords[isscIndex]!,
        revealExpiresAt,
      };
    },
  };
}

export type AccountImportService = ReturnType<typeof createAccountImportService>;
