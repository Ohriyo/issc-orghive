import type { Job, Queue } from 'bullmq';
import type { QueueJob, QueueJobState, QueueSummary } from '@orghive/shared';

/**
 * The BullMQ side of /system/queues: counts, job lists and the few actions the super admin
 * may take. The service (queue-admin.service.ts) decides what is allowed and audits it; this
 * port only talks to Redis, so unit tests use a fake.
 */
export interface QueueAdmin {
  /** The queues this API can see, in a stable order. */
  names(): string[];
  summary(queue: string): Promise<QueueSummary>;
  jobs(queue: string, state: QueueJobState, start: number, end: number): Promise<QueueJob[]>;
  /** Null when the job no longer exists. */
  jobState(queue: string, jobId: string): Promise<{ state: string; name: string } | null>;
  retry(queue: string, jobId: string): Promise<void>;
  remove(queue: string, jobId: string): Promise<void>;
  pause(queue: string): Promise<void>;
  resume(queue: string): Promise<void>;
}

/** A failure message is kept to this length: enough for the cause, never a whole stack. */
const REASON_MAX = 2000;

const isoOrNull = (ms: number | undefined) => (ms ? new Date(ms).toISOString() : null);

function toQueueJob(job: Job): QueueJob {
  const data: unknown = job.data;
  return {
    id: job.id ?? '',
    name: job.name,
    data:
      data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {},
    attemptsMade: job.attemptsMade,
    maxAttempts: job.opts.attempts ?? null,
    failedReason: job.failedReason ? job.failedReason.slice(0, REASON_MAX) : null,
    queuedAt: new Date(job.timestamp).toISOString(),
    startedAt: isoOrNull(job.processedOn),
    finishedAt: isoOrNull(job.finishedOn),
  };
}

export function createBullQueueAdmin(
  queues: readonly { name: string; queue: Queue }[],
): QueueAdmin {
  const byName = new Map(queues.map(({ name, queue }) => [name, queue]));
  const queueOf = (name: string): Queue => {
    const queue = byName.get(name);
    if (!queue) throw new Error(`Unknown queue ${name}`);
    return queue;
  };
  const jobOf = async (name: string, jobId: string): Promise<Job> => {
    const job = (await queueOf(name).getJob(jobId)) as Job | undefined;
    if (!job) throw new Error(`Job ${jobId} not found in ${name}`);
    return job;
  };

  return {
    names: () => [...byName.keys()],

    async summary(name) {
      const queue = queueOf(name);
      const [counts, paused] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        queue.isPaused(),
      ]);
      return {
        name,
        paused,
        // BullMQ 6: a paused queue keeps its jobs in waiting; its workers just take none.
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      };
    },

    async jobs(name, state, start, end) {
      // Newest first for finished jobs; oldest first for those still to run.
      const asc = state === 'waiting' || state === 'delayed';
      const jobs = (await queueOf(name).getJobs([state], start, end, asc)) as Job[];
      return jobs.filter(Boolean).map(toQueueJob);
    },

    async jobState(name, jobId) {
      const job = (await queueOf(name).getJob(jobId)) as Job | undefined;
      if (!job) return null;
      return { state: await job.getState(), name: job.name };
    },

    async retry(name, jobId) {
      await (await jobOf(name, jobId)).retry('failed');
    },

    async remove(name, jobId) {
      await (await jobOf(name, jobId)).remove();
    },

    pause: (name) => queueOf(name).pause(),
    resume: (name) => queueOf(name).resume(),
  };
}

/** In-memory QueueAdmin for tests: jobs per queue, with their state. */
export function memoryQueueAdmin(
  seed: Record<string, (QueueJob & { state: QueueJobState })[]> = {},
): QueueAdmin & {
  paused: Set<string>;
  jobsOf: (queue: string) => (QueueJob & { state: QueueJobState })[];
} {
  const store = new Map(Object.entries(seed).map(([name, jobs]) => [name, [...jobs]]));
  const paused = new Set<string>();
  const list = (name: string) => {
    const jobs = store.get(name);
    if (!jobs) throw new Error(`Unknown queue ${name}`);
    return jobs;
  };
  const count = (name: string, state: QueueJobState) =>
    list(name).filter((job) => job.state === state).length;
  return {
    paused,
    jobsOf: list,
    names: () => [...store.keys()],
    summary: (name) =>
      Promise.resolve({
        name,
        paused: paused.has(name),
        waiting: count(name, 'waiting'),
        active: count(name, 'active'),
        delayed: count(name, 'delayed'),
        failed: count(name, 'failed'),
        completed: count(name, 'completed'),
      }),
    jobs: (name, state, start, end) =>
      Promise.resolve(
        list(name)
          .filter((job) => job.state === state)
          .slice(start, end + 1)
          .map(({ state: _state, ...job }) => job),
      ),
    jobState: (name, jobId) => {
      const job = list(name).find((j) => j.id === jobId);
      return Promise.resolve(job ? { state: job.state, name: job.name } : null);
    },
    retry: (name, jobId) => {
      const job = list(name).find((j) => j.id === jobId);
      if (job) job.state = 'waiting';
      return Promise.resolve();
    },
    remove: (name, jobId) => {
      store.set(
        name,
        list(name).filter((j) => j.id !== jobId),
      );
      return Promise.resolve();
    },
    pause: (name) => {
      paused.add(name);
      return Promise.resolve();
    },
    resume: (name) => {
      paused.delete(name);
      return Promise.resolve();
    },
  };
}
