import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

/*
 * Shared organization accounts (docs/DOMAIN_RULES.md, "Accounts"): every organization, the
 * ISSC included, has one account (users.organization_id), and only the developer's
 * SUPER_ADMIN belongs to none. Who answers for an account during a term is in officer_terms.
 */

/** Start of the given day in UTC, to compare against DATE columns. */
export function dayOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

const organizationSelect = {
  id: true,
  type: true,
  parentId: true,
  slug: true,
  acronym: true,
  name: true,
  logoKey: true,
  logoWidths: true,
} satisfies Prisma.OrganizationSelect;

export type AccountOrganization = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

/** A shared account that may act for its organization right now. */
export interface Account {
  userId: string;
  organization: AccountOrganization;
}

/**
 * An account acts for its organization while it is not deactivated or locked and the
 * organization is not deleted. The one place this rule lives.
 */
const ACTIVE_ACCOUNT = {
  disabledAt: null,
  lockedAt: null,
  organization: { deletedAt: null },
} satisfies Prisma.UserWhereInput;

const termSelect = {
  officerName: true,
  officerPosition: true,
  officerEmail: true,
  termEnd: true,
} satisfies Prisma.OfficerTermSelect;

export type CurrentTerm = Prisma.OfficerTermGetPayload<{ select: typeof termSelect }>;

const endingTermSelect = {
  id: true,
  userId: true,
  officerName: true,
  officerPosition: true,
  termEnd: true,
  organization: { select: { acronym: true, name: true } },
} satisfies Prisma.OfficerTermSelect;

export type EndingTerm = Prisma.OfficerTermGetPayload<{ select: typeof endingTermSelect }>;

export function createAccountRepository(db: Db) {
  return {
    /** The account's organization, when it may act for it; null otherwise. */
    async findAccount(userId: string): Promise<Account | null> {
      const user = await db.user.findFirst({
        where: { id: userId, ...ACTIVE_ACCOUNT },
        select: { id: true, organization: { select: organizationSelect } },
      });
      return user?.organization ? { userId: user.id, organization: user.organization } : null;
    },

    /** The organization's active account: who is notified, who decides its appeals. */
    findOrganizationAccount(
      organizationId: string,
    ): Promise<{ id: string; email: string; name: string } | null> {
      return db.user.findFirst({
        where: { organizationId, ...ACTIVE_ACCOUNT },
        select: { id: true, email: true, name: true },
      });
    },

    /**
     * Active accounts under a council (docs/DOMAIN_RULES.md, "Notifications"): `everyone` for
     * the ISSC, or a CSC with the SBOs whose parent it is.
     */
    async findAccountIdsUnder(scope: 'everyone' | { councilId: string }): Promise<string[]> {
      const rows = await db.user.findMany({
        where: {
          ...ACTIVE_ACCOUNT,
          organizationId: { not: null },
          ...(scope !== 'everyone' && {
            organization: {
              deletedAt: null,
              OR: [{ id: scope.councilId }, { parentId: scope.councilId, type: 'SBO' }],
            },
          }),
        },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    },

    /** The account's open term: its officer-in-charge. */
    findCurrentTerm(userId: string): Promise<CurrentTerm | null> {
      return db.officerTerm.findFirst({
        where: { userId, endedAt: null },
        select: termSelect,
      });
    },

    /**
     * Open terms of active accounts that end between `from` and `to` (inclusive, DATE values
     * at UTC midnight), for the term-ending notice.
     */
    findTermsEndingBetween(from: Date, to: Date): Promise<EndingTerm[]> {
      return db.officerTerm.findMany({
        where: {
          endedAt: null,
          user: { disabledAt: null },
          organization: { deletedAt: null },
          termStart: { lte: from },
          termEnd: { gte: from, lte: to },
        },
        orderBy: { termEnd: 'asc' },
        select: endingTermSelect,
      });
    },
  };
}

export type AccountRepository = ReturnType<typeof createAccountRepository>;
