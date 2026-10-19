import {
  ErrorCode,
  systemUserListQuerySchema,
  type CreateAccountRequest,
  type CreateAccountResponse,
  type OfficerInChargeInput,
  type OrganizationType,
  type PasswordDelivery,
  type PasswordResetResponse,
  type RevealEntry,
  type RevealPurpose,
  type SetLockRequest,
  type SystemAuditEntry,
  type SystemUser,
  type SystemUserDetail,
  type SystemUserListQuery,
  type SystemUserListResponse,
  type UpdateAccountRequest,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { generateTemporaryPassword } from '#src/lib/temporary-password';
import {
  DuplicateAccountError,
  type AccountAdminRepository,
  type AccountRecord,
} from '#src/repositories/account-admin.repository';
import type { AccountRepository } from '#src/repositories/account.repository';
import type { AccountRequestRepository } from '#src/repositories/account-request.repository';
import type {
  AdminOrganizationRepository,
  AdminOrgRecord,
} from '#src/repositories/admin-organization.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SystemAuditRecord, SystemRepository } from '#src/repositories/system.repository';
import { accountEmailRefusal, passwordRecipientOf } from '#src/services/account-rules';
import type { AdminOrganizationService } from '#src/services/admin-organization.service';
import type { RequestContext } from '#src/services/auth.service';
import type { RevealService } from '#src/services/reveal.service';

/** Who acts in the console: the super admin, with the request's IP and user agent. */
export interface ConsoleActor {
  userId: string;
  ctx: RequestContext;
}

export interface AccountAdminServiceDeps {
  accounts: AccountAdminRepository;
  /** Finds the ISSC account, which receives every other account's temporary password. */
  accountReads: Pick<AccountRepository, 'findOrganizationAccount'>;
  orgReads: Pick<AdminOrganizationRepository, 'findOrganization' | 'issc'>;
  organizations: Pick<AdminOrganizationService, 'createOrganization'>;
  audits: Pick<SystemRepository, 'listAuditLogs'>;
  /** The ISSC's account requests a creation can fulfil. */
  requests: Pick<AccountRequestRepository, 'find' | 'markCreated'>;
  reveals: Pick<RevealService, 'deliver'>;
  passwords: { hash(password: string): Promise<string> };
  audit: Pick<AuditLogRepository, 'record'>;
  /** ACCOUNT_EMAIL_DOMAINS; empty allows any domain. */
  emailDomains: string[];
  now?: () => Date;
}

export function toSystemUser(record: AccountRecord): SystemUser {
  const term = record.officerTerms[0];
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    systemRole: record.systemRole,
    mfaEnabledAt: record.mfaEnabledAt?.toISOString() ?? null,
    disabledAt: record.disabledAt?.toISOString() ?? null,
    lockedAt: record.lockedAt?.toISOString() ?? null,
    lockReason: record.lockReason,
    mustChangePassword: record.mustChangePassword,
    lastLoginAt: record.lastLoginAt?.toISOString() ?? null,
    organization: record.organization && {
      slug: record.organization.slug,
      acronym: record.organization.acronym,
      name: record.organization.name,
      type: record.organization.type,
      college: record.organization.college?.code ?? null,
    },
    officerInCharge: term
      ? { name: term.officerName, position: term.officerPosition, email: term.officerEmail }
      : null,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toAuditEntry(record: SystemAuditRecord): SystemAuditEntry {
  const metadata = record.metadata;
  return {
    id: record.id,
    createdAt: record.createdAt.toISOString(),
    action: record.action,
    actor: record.actor,
    entityType: record.entityType,
    entityId: record.entityId,
    organizationId: record.organizationId,
    ip: record.ip,
    userAgent: record.userAgent,
    actingAs: record.actingAs,
    metadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : null,
  };
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayFrom = (iso: string | null | undefined) =>
  iso === undefined ? undefined : iso === null ? null : new Date(`${iso}T00:00:00Z`);

/** What the audit log keeps about an account before and after a change. */
function snapshot(account: SystemUser) {
  return { email: account.email, officerInCharge: account.officerInCharge };
}

/**
 * The super admin's management of organization accounts (docs/DOMAIN_RULES.md, "Accounts").
 * Every organization has one shared account. Temporary passwords are generated here, stored
 * only as hashes, and handed out through passwordRecipientOf: the ISSC account's one-time
 * Reveal, or (for the ISSC account itself) this one response. Every change is audited.
 */
export function createAccountAdminService(deps: AccountAdminServiceDeps) {
  const { accounts, audit } = deps;
  const now = deps.now ?? (() => new Date());

  function checkDomain(email: string) {
    const refusal = accountEmailRefusal(email, deps.emailDomains);
    if (refusal) throw new AppError(400, ErrorCode.VALIDATION_ERROR, `email: ${refusal}`);
  }

  async function load(userId: string): Promise<AccountRecord> {
    const record = await accounts.find(userId);
    if (!record) throw AppError.notFound('Account not found');
    return record;
  }

  /** Organization accounts only: super admins are managed with their command. */
  async function loadOrgAccount(userId: string) {
    const record = await load(userId);
    if (!record.organization) {
      throw AppError.conflict(
        'Super admin accounts are managed with the create-super-admin command, not here',
      );
    }
    return { record, organization: record.organization };
  }

  function duplicate(err: unknown): never {
    if (err instanceof DuplicateAccountError) {
      throw AppError.conflict(
        err.field === 'email'
          ? 'Another account already uses this email'
          : 'This organization already has an active account',
      );
    }
    throw err;
  }

  /** The ISSC account, which receives every other organization's temporary password. */
  async function isscRecipient(): Promise<string> {
    const issc = await deps.orgReads.issc();
    const account = issc ? await deps.accountReads.findOrganizationAccount(issc.id) : null;
    if (!account) {
      throw AppError.conflict(
        'Create the ISSC account first: its one-time Reveal receives the other organizations’ temporary passwords',
      );
    }
    return account.id;
  }

  /** Hands a fresh temporary password over, per passwordRecipientOf. */
  async function deliver(
    actor: ConsoleActor,
    organization: { type: OrganizationType; acronym: string; name: string },
    entry: Omit<RevealEntry, 'organization'>,
    purpose: RevealPurpose,
    recipientId: string | null,
    requested = false,
  ): Promise<PasswordDelivery> {
    if (recipientId === null) {
      return { kind: 'shown_once', temporaryPassword: entry.temporaryPassword };
    }
    const officer = entry.officerInCharge;
    const { expiresAt } = await deps.reveals.deliver({
      recipientId,
      purpose,
      issuedById: actor.userId,
      entries: [
        {
          ...entry,
          organization: {
            acronym: organization.acronym,
            name: organization.name,
            type: organization.type,
          },
        },
      ],
      title: requested
        ? `The account you requested for ${organization.acronym} is ready`
        : purpose === 'account_created'
          ? `New account for ${organization.acronym}`
          : `New temporary password for ${organization.acronym}`,
      body: `Reveal ${organization.acronym}’s temporary password once, within 7 days, and hand it to ${
        officer ? officer.name : 'its officer in charge'
      }. It must be changed at the first sign-in. This message never contains the password.`,
    });
    return { kind: 'reveal', expiresAt: expiresAt.toISOString() };
  }

  /** Where the password for `org` goes: the ISSC account's id, or null (shown once). */
  async function recipientFor(org: { type: OrganizationType }): Promise<string | null> {
    return passwordRecipientOf(org) === 'shown_once' ? null : isscRecipient();
  }

  async function resolveOrganization(
    actor: ConsoleActor,
    input: CreateAccountRequest['organization'],
  ): Promise<AdminOrgRecord> {
    if (input.kind === 'existing') {
      const org = await deps.orgReads.findOrganization(input.slug);
      if (!org) throw AppError.notFound('Organization not found');
      if (org._count.accounts > 0) {
        throw AppError.conflict(`${org.acronym} already has an active account`);
      }
      return org;
    }
    const { kind: _kind, ...create } = input;
    const created = await deps.organizations.createOrganization(
      { userId: actor.userId, ip: actor.ctx.ip },
      create,
    );
    return (await deps.orgReads.findOrganization(created.slug))!;
  }

  function officerOf(input: OfficerInChargeInput) {
    return { name: input.name, position: input.position, email: input.email };
  }

  return {
    async list(query: SystemUserListQuery): Promise<SystemUserListResponse> {
      const { page, pageSize, ...filters } = systemUserListQuerySchema.parse(query);
      const { rows, total } = await accounts.list({ ...filters, page, pageSize }, now());
      return { items: rows.map(toSystemUser), total, page, pageSize };
    },

    async detail(userId: string): Promise<SystemUserDetail> {
      const record = await load(userId);
      const at = now();
      const [terms, logins, sessions, acted, actedOn] = await Promise.all([
        accounts.terms(userId),
        accounts.logins(userId),
        accounts.sessions(userId, at),
        deps.audits.listAuditLogs({ actorId: userId }, 20),
        deps.audits.listAuditLogs({ entityType: 'user', entityId: userId }, 20),
      ]);
      const audit = [...new Map([...acted, ...actedOn].map((row) => [row.id, row])).values()]
        .sort((a, b) => (a.id < b.id ? 1 : -1))
        .slice(0, 20);
      return {
        account: toSystemUser(record),
        terms: terms.map((t) => ({
          officerName: t.officerName,
          officerPosition: t.officerPosition,
          officerEmail: t.officerEmail,
          termStart: isoDay(t.termStart),
          termEnd: t.termEnd ? isoDay(t.termEnd) : null,
          endedAt: t.endedAt?.toISOString() ?? null,
        })),
        logins: logins.map((l) => ({
          at: l.createdAt.toISOString(),
          succeeded: l.action === 'login',
          ip: l.ip,
          userAgent: l.userAgent,
        })),
        sessions: sessions.map((s) => ({
          id: s.id,
          startedAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ip: s.ip,
        })),
        audit: audit.map(toAuditEntry),
      };
    },

    /**
     * An organization's account: an existing organization without one, or a new CSC or SBO
     * made with it (it shows in its college's lists and carousel at once). 409 when the
     * email is taken or the organization has an account.
     */
    async create(actor: ConsoleActor, input: CreateAccountRequest): Promise<CreateAccountResponse> {
      checkDomain(input.email);
      if (await accounts.emailTaken(input.email)) {
        throw AppError.conflict('Another account already uses this email');
      }
      // Who receives the password is checked before anything is created.
      const newType = input.organization.kind === 'new' ? input.organization.type : null;
      const existing =
        input.organization.kind === 'existing'
          ? await deps.orgReads.findOrganization(input.organization.slug)
          : null;
      if (input.organization.kind === 'existing' && !existing) {
        throw AppError.notFound('Organization not found');
      }
      if (input.requestId) {
        const request = await deps.requests.find(input.requestId);
        if (!request) throw AppError.notFound('Account request not found');
        if (request.status !== 'requested') {
          throw AppError.conflict('This account request was already decided');
        }
        if (input.organization.kind !== 'existing' || request.organizationId !== existing!.id) {
          throw AppError.conflict('This account request is for another organization');
        }
      }
      const recipientId = await recipientFor({ type: newType ?? existing!.type });

      const org = await resolveOrganization(actor, input.organization);
      const temporaryPassword = generateTemporaryPassword();
      const at = now();
      const userId = await accounts
        .create(
          {
            organizationId: org.id,
            email: input.email,
            name: org.acronym,
            passwordHash: await deps.passwords.hash(temporaryPassword),
            officer: officerOf(input.officerInCharge),
            termStart: at,
            termEnd: dayFrom(input.termEnd) ?? null,
          },
          at,
        )
        .catch(duplicate);
      if (input.requestId) {
        await deps.requests.markCreated(input.requestId, userId, actor.userId, at);
      }

      const delivery = await deliver(
        actor,
        org,
        {
          email: input.email,
          temporaryPassword,
          officerInCharge: officerOf(input.officerInCharge),
        },
        'account_created',
        recipientId,
        input.requestId !== undefined,
      );
      await audit.record({
        action: 'account_create',
        actorId: actor.userId,
        entityType: 'user',
        entityId: userId,
        organizationId: org.id,
        metadata: {
          organization: org.slug,
          newOrganization: input.organization.kind === 'new',
          delivery: delivery.kind,
          ...(input.requestId && { requestId: input.requestId }),
        },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return { account: toSystemUser(await load(userId)), delivery };
    },

    /** Corrections to the email or officer in charge. Audited with before and after. */
    async update(
      actor: ConsoleActor,
      userId: string,
      patch: UpdateAccountRequest,
    ): Promise<SystemUser> {
      const { record } = await loadOrgAccount(userId);
      if (patch.email !== undefined) checkDomain(patch.email);
      const before = toSystemUser(record);
      await accounts
        .update(
          userId,
          {
            email: patch.email,
            officer: patch.officerInCharge && officerOf(patch.officerInCharge),
            termEnd: dayFrom(patch.termEnd),
          },
          now(),
        )
        .catch(duplicate);
      const after = toSystemUser(await load(userId));
      await audit.record({
        action: 'account_update',
        actorId: actor.userId,
        entityType: 'user',
        entityId: userId,
        organizationId: record.organizationId,
        metadata: { before: snapshot(before), after: snapshot(after) },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return after;
    },

    /**
     * A forgotten password: a new temporary one, delivered like a new account's. Every
     * session ends and the next sign-in must change it.
     */
    async resetPassword(actor: ConsoleActor, userId: string): Promise<PasswordResetResponse> {
      const { record, organization } = await loadOrgAccount(userId);
      if (record.disabledAt) throw AppError.conflict('Reactivate this account first');
      const recipientId = await recipientFor(organization);
      const temporaryPassword = generateTemporaryPassword();
      await accounts.setTemporaryPassword(
        userId,
        await deps.passwords.hash(temporaryPassword),
        now(),
      );
      const current = toSystemUser(record);
      const delivery = await deliver(
        actor,
        organization,
        { email: record.email, temporaryPassword, officerInCharge: current.officerInCharge },
        'password_reset',
        recipientId,
      );
      await audit.record({
        action: 'password_reset_issued',
        actorId: actor.userId,
        entityType: 'user',
        entityId: userId,
        organizationId: record.organizationId,
        metadata: { delivery: delivery.kind },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return { account: toSystemUser(await load(userId)), delivery };
    },

    /** Ends every session of the account at once. Never your own. */
    async signOut(actor: ConsoleActor, userId: string): Promise<SystemUser> {
      if (userId === actor.userId) {
        throw AppError.conflict('Sign yourself out from the account menu instead');
      }
      const record = await load(userId);
      await accounts.revokeSessions(userId, now());
      await audit.record({
        action: 'sessions_revoke',
        actorId: actor.userId,
        entityType: 'user',
        entityId: userId,
        organizationId: record.organizationId,
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return toSystemUser(await load(userId));
    },

    /** A temporary hold (security, end of term). Locking ends every session. */
    async setLock(actor: ConsoleActor, userId: string, input: SetLockRequest): Promise<SystemUser> {
      const { record } = await loadOrgAccount(userId);
      if (input.locked && record.lockedAt)
        throw AppError.conflict('This account is already locked');
      if (!input.locked && !record.lockedAt) throw AppError.conflict('This account is not locked');
      await accounts.setLock(userId, input.locked ? input.reason! : null, now());
      await audit.record({
        action: input.locked ? 'account_lock' : 'account_unlock',
        actorId: actor.userId,
        entityType: 'user',
        entityId: userId,
        organizationId: record.organizationId,
        metadata: input.locked ? { reason: input.reason } : { previousReason: record.lockReason },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return toSystemUser(await load(userId));
    },
  };
}

export type AccountAdminService = ReturnType<typeof createAccountAdminService>;
