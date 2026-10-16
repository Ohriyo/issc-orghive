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

export function createMembershipRepository(db: Db) {
  return {
    /**
     * Memberships that grant something on `at`: the term has started and not ended, the
     * user is not disabled and the organization is not deleted. Past terms grant nothing.
     */
    findActiveForUser(userId: string, at: Date = new Date()): Promise<ActiveMembership[]> {
      const day = dayOf(at);
      return db.membership.findMany({
        where: {
          userId,
          user: { disabledAt: null },
          organization: { deletedAt: null },
          termStart: { lte: day },
          OR: [{ termEnd: null }, { termEnd: { gte: day } }],
        },
        select: activeMembershipSelect,
      });
    },
  };
}

export type MembershipRepository = ReturnType<typeof createMembershipRepository>;
