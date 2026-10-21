// CI check (docs/DEPLOYMENT.md, "Demo data"): after the normal seed, the database must hold
// no demo rows. Exits 1, listing them, if any is_demo row exists.
//
//   pnpm --filter api db:seed && pnpm --filter api check:no-demo
import { z } from 'zod';
import { createDemoDataRepository, totalOf } from '#src/repositories/demo-data.repository';
import { createDb } from '#src/repositories/prisma';

const env = z.object({ DATABASE_URL: z.url() }).safeParse(process.env);
if (!env.success) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const db = createDb(env.data.DATABASE_URL);
try {
  const counts = await createDemoDataRepository(db).counts();
  const total = totalOf(counts);
  if (total > 0) {
    const kinds = Object.entries(counts).filter(([, n]) => n > 0);
    console.error(`Found ${total} demo rows: ${kinds.map(([k, n]) => `${k} ${n}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('No demo data: every is_demo count is 0.');
  }
} finally {
  await db.$disconnect();
}
