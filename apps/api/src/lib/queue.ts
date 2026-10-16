import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

/** BullMQ queue the API fills and the worker (src/worker.ts) drains. */
export const DOCUMENT_QUEUE = 'document-processing';

export type DocumentJob =
  /** Check, scan and process one uploaded version. */
  | { name: 'process-version'; data: { versionId: string } }
  /** Delete uploads whose URL expired without being claimed by a document. */
  | { name: 'sweep-uploads'; data: Record<string, never> };

/** What the API needs from the queue; tests pass a fake. */
export interface JobQueue {
  enqueueProcessing(versionId: string): Promise<void>;
}

/** BullMQ requires maxRetriesPerRequest: null on connections that block (workers). */
export function createQueueConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}

export function createBullQueue(connection: Redis): JobQueue & { queue: Queue } {
  const queue = new Queue(DOCUMENT_QUEUE, { connection });
  return {
    queue,
    async enqueueProcessing(versionId) {
      await queue.add(
        'process-version',
        { versionId },
        {
          // One job per version, even if a request is retried.
          jobId: `version-${versionId}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
        },
      );
    },
  };
}
