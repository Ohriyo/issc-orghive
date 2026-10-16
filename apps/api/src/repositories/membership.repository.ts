import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const activeMembershipSelect = {
  id: true,
  role: true,
  isHead: true,
  title: true,
  organization: { select: { id: true, type: true, parentId: true } },
} satisfies Prisma.MembershipSelect;

export type ActiveMembership = Prisma.MembershipGetPayload<{
  select: typeof activeMembershipSelect;
}>;

/** Start of the given day in UTC, to compare against DATE columns. */
function dayOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

const membershipDetailSelect = {
  id: true,
  role: true,
  isHead: true,
  title: true,
  termEnd: true,
  organization: {
    select: {
      id: true,
      type: true,
      slug: true,
      acronym: true,
      name: true,
      logoKey: true,
      logoWidths: true,
    },
  },
} satisfies Prisma.MembershipSelect;

export type MembershipDetail = Prisma.MembershipGetPayload<{
  select: typeof membershipDetailSelect;
}>;

/** The same "grants something today" rule as findActiveForUser. */
function activeWhere(userId: string, at: Date): Prisma.MembershipWhereInput {
  const day = dayOf(at);
  return {
    userId,
    user: { disabledAt: null },
    organization: { deletedAt: null },
    termStart: { lte: day },
    OR: [{ termEnd: null }, { termEnd: { gte: day } }],
  };
}

export function createMembershipRepository(db: Db) {
  return {
    /** Active memberships with their organization's display fields, for the dashboard. */
    findActiveDetailsForUser(userId: string, at: Date = new Date()): Promise<MembershipDetail[]> {
      return db.membership.findMany({
        where: activeWhere(userId, at),
        orderBy: [{ organization: { acronym: 'asc' } }, { role: 'asc' }],
        select: membershipDetailSelect,
      });
    },

    /**
     * Memberships that grant something on `at`: the term has started and not ended, the
     * user is not disabled and the organization is not deleted. Past terms grant nothing.
     */
    findActiveForUser(userId: string, at: Date = new Date()): Promise<ActiveMembership[]> {
      return db.membership.findMany({
        where: activeWhere(userId, at),
        select: activeMembershipSelect,
      });
    },
  };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;
