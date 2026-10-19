import { Prisma } from '#src/generated/prisma/client';
import type { AccountRequestStatus } from '#src/generated/prisma/client';
import type { Db } from './prisma';

/*
 * Account requests (docs/DOMAIN_RULES.md, "Accounts"). The database allows one open request
 * per organization (a partial unique index); a second one surfaces as DuplicateRequestError.
 */

export class DuplicateRequestError extends Error {
  constructor() {
    super('An open account request already exists for this organization');
  }
}

const REQUEST_SELECT = {
  id: true,
  organizationId: true,
  accountEmail: true,
  officerName: true,
  officerPosition: true,
  officerEmail: true,
  note: true,
  status: true,
  declineReason: true,
  decidedAt: true,
  createdAccountId: true,
  createdAt: true,
  requestedById: true,
  requestedBy: { select: { name: true, email: true } },
  organization: {
    select: {
      slug: true,
      acronym: true,
      name: true,
      type: true,
      college: { select: { slug: true, code: true } },
      _count: { select: { accounts: { where: { disabledAt: null } } } },
    },
  },
} satisfies Prisma.AccountRequestSelect;

export type AccountRequestRecord = Prisma.AccountRequestGetPayload<{
  select: typeof REQUEST_SELECT;
}>;

export interface NewAccountRequest {
  organizationId: string;
  requestedById: string;
  accountEmail: string;
  officer: { name: string; position: string; email: string };
  note: string | null;
}

export function createAccountRequestRepository(db: Db) {
  return {
    async create(input: NewAccountRequest): Promise<string> {
      try {
        const { id } = await db.accountRequest.create({
          data: {
            organizationId: input.organizationId,
            requestedById: input.requestedById,
            accountEmail: input.accountEmail,
            officerName: input.officer.name,
            officerPosition: input.officer.position,
            officerEmail: input.officer.email,
            note: input.note,
          },
          select: { id: true },
        });
        return id;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DuplicateRequestError();
        }
        throw err;
      }
    },

    find(id: string): Promise<AccountRequestRecord | null> {
      return db.accountRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
    },

    /** Oldest first for open requests (a queue); newest first otherwise. */
    list(status: AccountRequestStatus | 'all'): Promise<AccountRequestRecord[]> {
      return db.accountRequest.findMany({
        where: status === 'all' ? {} : { status },
        orderBy: { createdAt: status === 'requested' ? 'asc' : 'desc' },
        take: 200,
        select: REQUEST_SELECT,
      });
    },

    openCount(): Promise<number> {
      return db.accountRequest.count({ where: { status: 'requested' } });
    },

    /** requested -> declined. False when it was not open any more. */
    async decline(id: string, reason: string, decidedById: string, at: Date): Promise<boolean> {
      const { count } = await db.accountRequest.updateMany({
        where: { id, status: 'requested' },
        data: { status: 'declined', declineReason: reason, decidedById, decidedAt: at },
      });
      return count === 1;
    },

    /** requested -> created, naming the account. False when it was not open any more. */
    async markCreated(
      id: string,
      accountId: string,
      decidedById: string,
      at: Date,
    ): Promise<boolean> {
      const { count } = await db.accountRequest.updateMany({
        where: { id, status: 'requested' },
        data: { status: 'created', createdAccountId: accountId, decidedById, decidedAt: at },
      });
      return count === 1;
    },
  };
}

export type AccountRequestRepository = ReturnType<typeof createAccountRequestRepository>;
