import type { SemesterKey } from '@orghive/shared';
import { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const organizationSelect = { id: true, name: true, acronym: true, type: true } as const;

const disqualificationSelect = {
  id: true,
  academicYear: true,
  semester: true,
  reason: true,
  actingAs: true,
  createdAt: true,
  liftedAt: true,
  liftReason: true,
  liftActingAs: true,
  organization: { select: organizationSelect },
} as const;

export type DisqualificationRecord = Prisma.LeaderboardDisqualificationGetPayload<{
  select: typeof disqualificationSelect;
}>;

export interface LiftInput {
  reason: string;
  actingAs: string;
  byId: string;
  at: Date;
}

/** The ISSC account's disqualifications from a semester's leaderboard (spec 5B). */
export function createDisqualificationRepository(db: Db) {
  return {
    /** Every disqualification of a semester, the standing ones first, newest first within. */
    list(key: SemesterKey): Promise<DisqualificationRecord[]> {
      return db.leaderboardDisqualification.findMany({
        where: key,
        orderBy: [{ liftedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
        select: disqualificationSelect,
      });
    },

    findById(id: string): Promise<DisqualificationRecord | null> {
      return db.leaderboardDisqualification.findUnique({
        where: { id },
        select: disqualificationSelect,
      });
    },

    /** Who can be disqualified: ranked organizations only, never the ISSC (spec 5A). */
    rankedOrganizations(): Promise<DisqualificationRecord['organization'][]> {
      return db.organization.findMany({
        where: { type: { in: ['SBO', 'CSC'] }, deletedAt: null },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
        select: organizationSelect,
      });
    },

    /** The standing reason for an organization and semester, or null. */
    async reasonFor(organizationId: string, key: SemesterKey): Promise<string | null> {
      const row = await db.leaderboardDisqualification.findFirst({
        where: { organizationId, ...key, liftedAt: null },
        select: { reason: true },
      });
      return row?.reason ?? null;
    },

    /** Null when the organization already has a standing one (the partial unique index). */
    async create(data: {
      organizationId: string;
      academicYear: string;
      semester: SemesterKey['semester'];
      reason: string;
      actingAs: string;
      createdById: string;
    }): Promise<DisqualificationRecord | null> {
      try {
        return await db.leaderboardDisqualification.create({
          data,
          select: disqualificationSelect,
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return null;
        }
        throw err;
      }
    },

    /** False when it was lifted already. */
    async lift(id: string, input: LiftInput): Promise<boolean> {
      const { count } = await db.leaderboardDisqualification.updateMany({
        where: { id, liftedAt: null },
        data: {
          liftedAt: input.at,
          liftReason: input.reason,
          liftActingAs: input.actingAs,
          liftedById: input.byId,
        },
      });
      return count === 1;
    },
  };
}

export type DisqualificationRepository = ReturnType<typeof createDisqualificationRepository>;
