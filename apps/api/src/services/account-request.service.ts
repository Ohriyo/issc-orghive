import {
  ErrorCode,
  type AccountRequestSummary,
  type DeclineAccountRequest,
  type RequestAccountRequest,
  type SystemAccountRequest,
  type SystemAccountRequestList,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { Mailer } from '#src/lib/mailer';
import type { Logger } from '#src/logger';
import {
  DuplicateRequestError,
  type AccountRequestRecord,
  type AccountRequestRepository,
} from '#src/repositories/account-request.repository';
import type { AdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import { accountEmailRefusal } from '#src/services/account-rules';
import type { ConsoleActor } from '#src/services/account-admin.service';
import type { NotificationService } from '#src/services/notification.service';

export interface AccountRequestServiceDeps {
  requests: AccountRequestRepository;
  orgReads: Pick<AdminOrganizationRepository, 'findOrganization'>;
  superAdmins: Pick<SystemRepository, 'activeSuperAdminEmails'>;
  mailer: Mailer;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  logger: Pick<Logger, 'error'>;
  /** Links in the super admins' email. */
  webOrigin: string;
  emailDomains: string[];
  now?: () => Date;
}

export function toSystemAccountRequest(r: AccountRequestRecord): SystemAccountRequest {
  return {
    id: r.id,
    status: r.status,
    organization: {
      slug: r.organization.slug,
      acronym: r.organization.acronym,
      name: r.organization.name,
      type: r.organization.type,
      collegeSlug: r.organization.college?.slug ?? null,
      college: r.organization.college?.code ?? null,
      hasAccount: r.organization._count.accounts > 0,
    },
    accountEmail: r.accountEmail,
    officerInCharge: { name: r.officerName, position: r.officerPosition, email: r.officerEmail },
    note: r.note,
    requestedAt: r.createdAt.toISOString(),
    requestedBy: r.requestedBy,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    declineReason: r.declineReason,
    createdAccountId: r.createdAccountId,
  };
}

/**
 * Account requests (docs/DOMAIN_RULES.md, "Accounts"): the ISSC account asks for an
 * organization's account from /admin; every super admin is emailed; the super admin creates it
 * (account-admin.service, with the request's id) or declines it with a reason, which the ISSC
 * account is told. One open request per organization, none once it has an account. Audited.
 */
export function createAccountRequestService(deps: AccountRequestServiceDeps) {
  const { requests, audit } = deps;
  const now = deps.now ?? (() => new Date());

  async function load(id: string): Promise<AccountRequestRecord> {
    const found = await requests.find(id);
    if (!found) throw AppError.notFound('Account request not found');
    return found;
  }

  /** Not awaited by the caller's response: a slow mail relay never fails the request. */
  function alertSuperAdmins(record: { id: string; acronym: string; email: string }) {
    void (async () => {
      const recipients = await deps.superAdmins.activeSuperAdminEmails();
      const url = new URL('/system/account-requests', deps.webOrigin).toString();
      const text = [
        `The ISSC asked for an Orghive account for ${record.acronym} (${record.email}).`,
        '',
        `Review it in the system console: ${url}`,
      ].join('\n');
      for (const to of recipients) {
        await deps.mailer.send({
          to,
          subject: `Orghive: account requested for ${record.acronym}`,
          text,
          html: `<p>The ISSC asked for an Orghive account for ${escapeHtml(record.acronym)} (${escapeHtml(record.email)}).</p><p><a href="${escapeHtml(url)}">Review it in the system console</a></p>`,
        });
      }
    })().catch((err: unknown) => deps.logger.error({ err }, 'Account request email failed'));
  }

  return {
    /**
     * The ISSC account asks for `slug`'s account. 409 when it has an active account or an
     * open request already.
     */
    async request(
      actor: ConsoleActor,
      slug: string,
      input: RequestAccountRequest,
    ): Promise<AccountRequestSummary> {
      const org = await deps.orgReads.findOrganization(slug);
      if (!org) throw AppError.notFound('Organization not found');
      if (org._count.accounts > 0) {
        throw AppError.conflict(`${org.acronym} already has an account`);
      }
      const refusal = accountEmailRefusal(input.accountEmail, deps.emailDomains);
      if (refusal) throw new AppError(400, ErrorCode.VALIDATION_ERROR, `accountEmail: ${refusal}`);
      let id: string;
      try {
        id = await requests.create({
          organizationId: org.id,
          requestedById: actor.userId,
          accountEmail: input.accountEmail,
          officer: input.officerInCharge,
          note: input.note || null,
        });
      } catch (err) {
        if (err instanceof DuplicateRequestError) {
          throw AppError.conflict(`An account for ${org.acronym} was already requested`);
        }
        throw err;
      }
      await audit.record({
        action: 'account_request',
        actorId: actor.userId,
        entityType: 'account_request',
        entityId: id,
        organizationId: org.id,
        metadata: { accountEmail: input.accountEmail },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      alertSuperAdmins({ id, acronym: org.acronym, email: input.accountEmail });
      const created = await load(id);
      return {
        id,
        status: created.status,
        requestedAt: created.createdAt.toISOString(),
        decidedAt: null,
        declineReason: null,
      };
    },

    async list(status: SystemAccountRequest['status'] | 'all'): Promise<SystemAccountRequestList> {
      const [rows, openCount] = await Promise.all([requests.list(status), requests.openCount()]);
      return { items: rows.map(toSystemAccountRequest), openCount };
    },

    async count(): Promise<{ open: number }> {
      return { open: await requests.openCount() };
    },

    async get(id: string): Promise<SystemAccountRequest> {
      return toSystemAccountRequest(await load(id));
    },

    /** Declines an open request; the ISSC account is told why. */
    async decline(
      actor: ConsoleActor,
      id: string,
      { reason }: DeclineAccountRequest,
    ): Promise<SystemAccountRequest> {
      const record = await load(id);
      if (!(await requests.decline(id, reason, actor.userId, now()))) {
        throw AppError.conflict('This request was already decided');
      }
      if (record.requestedById) {
        await deps.notifications.notify({
          userIds: [record.requestedById],
          kind: 'account_request_declined',
          title: `Account request for ${record.organization.acronym} declined`,
          body: `The super admin declined the account you asked for (${record.accountEmail}): ${reason}`,
          link: '/admin/organizations',
        });
      }
      await audit.record({
        action: 'account_request_decline',
        actorId: actor.userId,
        entityType: 'account_request',
        entityId: id,
        organizationId: record.organizationId,
        metadata: { reason },
        ip: actor.ctx.ip,
        userAgent: actor.ctx.userAgent,
      });
      return toSystemAccountRequest(await load(id));
    },
  };
}

export type AccountRequestService = ReturnType<typeof createAccountRequestService>;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
