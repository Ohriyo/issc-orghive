import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const collegeSelect = {
  id: true,
  code: true,
  slug: true,
  name: true,
  motto: true,
  description: true,
  organizations: {
    where: { type: 'CSC', deletedAt: null },
    select: {
      id: true,
      type: true,
      slug: true,
      acronym: true,
      name: true,
      description: true,
      logoKey: true,
      logoWidths: true,
    },
  },
} satisfies Prisma.CollegeSelect;

export type CollegeRecord = Prisma.CollegeGetPayload<{ select: typeof collegeSelect }>;

export function createCollegeRepository(db: Db) {
  return {
    /** Every college with its CSC, in name order. */
    list(): Promise<CollegeRecord[]> {
      return db.college.findMany({ orderBy: { name: 'asc' }, select: collegeSelect });
    },

    findBySlug(slug: string): Promise<CollegeRecord | null> {
      return db.college.findUnique({ where: { slug }, select: collegeSelect });
    },
  };
}

export type CollegeRepository = ReturnType<typeof createCollegeRepository>;
