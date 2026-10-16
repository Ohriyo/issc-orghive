import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#src/generated/prisma/client';

export type Db = PrismaClient;

/** One client per process. Repositories receive it, so tests can pass a test-database client. */
export function createDb(databaseUrl: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
