// One-time backfill: queues the watermarked view-only pages of every clean version that has
// none yet (files uploaded before previews existed). The worker renders them one at a time;
// until a file's pages are ready its viewer shows "Preparing preview…". Safe to run again:
// each version has one job, and finished versions are no longer pending.
//
//   pnpm --filter api pages:backfill
import { z } from 'zod';
import { createBullPreviewQueue, createQueueConnection } from '#src/lib/queue';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDb } from '#src/repositories/prisma';
import { queuePendingPreviews } from '#src/services/preview.service';

const env = z.object({ DATABASE_URL: z.url(), REDIS_URL: z.url() }).safeParse(process.env);
if (!env.success) {
  console.error(
    env.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
  );
  process.exit(1);
}

const db = createDb(env.data.DATABASE_URL);
const connection = createQueueConnection(env.data.REDIS_URL);
const queue = createBullPreviewQueue(connection);
try {
  const queued = await queuePendingPreviews({ documents: createDocumentRepository(db), queue });
  console.log(
    queued === 0
      ? 'Every clean file already has its preview.'
      : `Queued ${queued} file${queued === 1 ? '' : 's'} for preview rendering. Keep the worker running (pnpm dev).`,
  );
} finally {
  await queue.queue.close();
  await connection.quit();
  await db.$disconnect();
}
