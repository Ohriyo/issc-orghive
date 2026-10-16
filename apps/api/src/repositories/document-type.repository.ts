import type { Db } from './prisma';

export function createDocumentTypeRepository(db: Db) {
  return {
    list(): Promise<{ id: string; slug: string; name: string }[]> {
      return db.documentType.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, slug: true, name: true },
      });
    },

    findById(id: string): Promise<{ id: string; slug: string; name: string } | null> {
      return db.documentType.findUnique({
        where: { id },
        select: { id: true, slug: true, name: true },
      });
    },
  };
}

export type DocumentTypeRepository = ReturnType<typeof createDocumentTypeRepository>;
