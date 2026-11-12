import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#src/generated/prisma/client';

export type Db = PrismaClient;

export interface DbOptions {
  /**
   * Every query's duration and SQL text (placeholders only: Prisma's `params` are never
   * passed on), for slow-query tracking. Called inside the caller's async context.
   */
  onQuery?: (query: { durationMs: number; sql: string }) => void;
}

/** One client per process. Repositories receive it, so tests can pass a test-database client. */
export function createDb(databaseUrl: string, options: DbOptions = {}): Db {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const { onQuery } = options;
  if (!onQuery) return new PrismaClient({ adapter });

  const db = new PrismaClient({ adapter, log: [{ emit: 'event', level: 'query' }] });
  db.$on('query', (event) => onQuery({ durationMs: event.duration, sql: event.query }));
  return db;
}
