import type { Db } from './prisma';
import { dayOf } from './account.repository';
import { DuplicateAccountError } from './account-admin.repository';
import { Prisma } from '#src/generated/prisma/client';

/*
 * The CSV imports' reads and writes (docs/DOMAIN_RULES.md, "Accounts"). Each import is saved
 * in one transaction: all of it, or nothing.
 */

/** Up to 500 accounts in one transaction: more time than Prisma's 5-second default. */
const IMPORT_TRANSACTION = { timeout: 60_000, maxWait: 10_000 };

export interface NewImportedAccount {
  organizationId: string;
  email: string;
  name: string;
  passwordHash: string;
  officer: { name: string; position: string; email: string };
}

export interface Reassignment {
  userId: string;
  organizationId: string;
  passwordHash: string;
  officer: { name: string; position: string; email: string };
}

export function createAccountImportRepository(db: Db) {
  return {
    /** Every organization, with its active (not deactivated) account if it has one. */
    async organizations() {
      const rows = await db.organization.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          slug: true,
          acronym: true,
          name: true,
          type: true,
          college: { select: { code: true, slug: true } },
          accounts: { where: { disabledAt: null }, select: { id: true, email: true }, take: 1 },
        },
      });
      return rows.map((o) => ({
        id: o.id,
        slug: o.slug,
        acronym: o.acronym,
        name: o.name,
        type: o.type,
        collegeCode: o.college?.code ?? null,
        collegeSlug: o.college?.slug ?? null,
        account: o.accounts[0] ?? null,
      }));
    },

    /** Which of `emails` already sign in to an account. */
    async takenEmails(emails: string[]): Promise<Set<string>> {
      if (emails.length === 0) return new Set();
      const rows = await db.user.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      });
      return new Set(rows.map((r) => r.email));
    },

    /** Creates every account and its first officer term; ids in the input's order. */
    async createAccounts(accounts: NewImportedAccount[], now: Date): Promise<string[]> {
      try {
        return await db.$transaction(async (tx) => {
          const ids: string[] = [];
          for (const a of accounts) {
            const { id } = await tx.user.create({
              data: {
                organizationId: a.organizationId,
                email: a.email,
                name: a.name,
                passwordHash: a.passwordHash,
                mustChangePassword: true,
              },
              select: { id: true },
            });
            await tx.officerTerm.create({
              data: {
                userId: id,
                organizationId: a.organizationId,
                officerName: a.officer.name,
                officerPosition: a.officer.position,
                officerEmail: a.officer.email,
                termStart: dayOf(now),
              },
            });
            ids.push(id);
          }
          return ids;
        }, IMPORT_TRANSACTION);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DuplicateAccountError('email');
        }
        throw err;
      }
    },

    /**
     * The end of term, in one transaction: every active organization account's open term
     * ends and every session ends; each reassigned account gets its new officer term, a new
     * temporary password and no lock; the others are locked until assigned.
     */
    async endOfTerm(input: {
      reassign: Reassignment[];
      lock: string[];
      lockReason: string;
      termEnd: Date | null;
      now: Date;
    }): Promise<void> {
      const { now } = input;
      // Real time, compared with access tokens' issue time (session-guard.ts).
      const revokedAt = new Date();
      await db.$transaction(async (tx) => {
        const active = await tx.user.findMany({
          where: { organizationId: { not: null }, disabledAt: null },
          select: { id: true },
        });
        const ids = active.map((a) => a.id);
        await tx.officerTerm.updateMany({
          where: { userId: { in: ids }, endedAt: null },
          data: { endedAt: now },
        });
        await tx.refreshToken.updateMany({
          where: { userId: { in: ids }, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.user.updateMany({
          where: { id: { in: ids } },
          data: { sessionsRevokedAt: revokedAt },
        });
        for (const r of input.reassign) {
          await tx.user.update({
            where: { id: r.userId },
            data: {
              passwordHash: r.passwordHash,
              mustChangePassword: true,
              lockedAt: null,
              lockReason: null,
            },
          });
          await tx.officerTerm.create({
            data: {
              userId: r.userId,
              organizationId: r.organizationId,
              officerName: r.officer.name,
              officerPosition: r.officer.position,
              officerEmail: r.officer.email,
              termStart: dayOf(now),
              termEnd: input.termEnd,
            },
          });
        }
        if (input.lock.length > 0) {
          await tx.user.updateMany({
            where: { id: { in: input.lock } },
            data: { lockedAt: now, lockReason: input.lockReason },
          });
        }
      }, IMPORT_TRANSACTION);
    },
  };
}

export type AccountImportRepository = ReturnType<typeof createAccountImportRepository>;
