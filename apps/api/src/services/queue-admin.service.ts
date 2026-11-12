import {
  QUEUE_JOBS_PAGE_SIZE,
  type QueueJobList,
  type QueueJobsQuery,
  type QueueList,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { QueueAdmin } from '#src/lib/queue-admin';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { ConsoleActor } from '#src/services/account-admin.service';

export interface QueueAdminServiceDeps {
  queues: QueueAdmin;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

/**
 * /system/queues: the background queues the worker drains. The super admin lists each
 * queue's jobs, retries or removes a failed one, and pauses or resumes a whole queue (a
 * step-up, in the route). Only failed jobs are retried or removed: a waiting or running
 * one belongs to the worker. Every change is audited.
 */
export function createQueueAdminService({
  queues,
  audit,
  now = () => new Date(),
}: QueueAdminServiceDeps) {
  function assertKnown(queue: string) {
    if (!queues.names().includes(queue))
      throw AppError.notFound('There is no queue with that name');
  }

  /** The failed job, or why it cannot be touched. */
  async function failedJob(queue: string, jobId: string) {
    assertKnown(queue);
    const job = await queues.jobState(queue, jobId);
    if (!job)
      throw AppError.notFound('This job no longer exists. It may have been removed or retried.');
    if (job.state !== 'failed') {
      throw AppError.conflict(
        `Only failed jobs can be retried or removed; this one is ${job.state}.`,
      );
    }
    return job;
  }

  async function record(
    action: 'queue_job_retry' | 'queue_job_remove' | 'queue_pause' | 'queue_resume',
    actor: ConsoleActor,
    metadata: Record<string, string>,
  ) {
    await audit.record({
      action,
      actorId: actor.userId,
      entityType: 'queue',
      entityId: metadata.queue,
      metadata,
      ip: actor.ctx.ip,
      userAgent: actor.ctx.userAgent,
    });
  }

  async function setPaused(actor: ConsoleActor, queue: string, paused: boolean) {
    assertKnown(queue);
    const before = await queues.summary(queue);
    if (before.paused !== paused) {
      await (paused ? queues.pause(queue) : queues.resume(queue));
      await record(paused ? 'queue_pause' : 'queue_resume', actor, { queue });
    }
    return queues.summary(queue);
  }

  return {
    async list(): Promise<QueueList> {
      const summaries = await Promise.all(queues.names().map((name) => queues.summary(name)));
      return { queues: summaries, generatedAt: now().toISOString() };
    },

    async jobs(queue: string, { state, page }: QueueJobsQuery): Promise<QueueJobList> {
      assertKnown(queue);
      const start = page * QUEUE_JOBS_PAGE_SIZE;
      const [summary, items] = await Promise.all([
        queues.summary(queue),
        queues.jobs(queue, state, start, start + QUEUE_JOBS_PAGE_SIZE - 1),
      ]);
      return {
        queue: summary,
        state,
        page,
        pageSize: QUEUE_JOBS_PAGE_SIZE,
        total: summary[state],
        items,
      };
    },

    /** Runs a failed job again, from the start. */
    async retry(actor: ConsoleActor, queue: string, jobId: string): Promise<void> {
      const job = await failedJob(queue, jobId);
      await queues.retry(queue, jobId);
      await record('queue_job_retry', actor, { queue, jobId, name: job.name });
    },

    /** Deletes a failed job and its error. Whatever it was for is not done. */
    async remove(actor: ConsoleActor, queue: string, jobId: string): Promise<void> {
      const job = await failedJob(queue, jobId);
      await queues.remove(queue, jobId);
      await record('queue_job_remove', actor, { queue, jobId, name: job.name });
    },

    /** Workers take no new jobs from it; running ones finish. Unchanged when already paused. */
    pause: (actor: ConsoleActor, queue: string) => setPaused(actor, queue, true),
    resume: (actor: ConsoleActor, queue: string) => setPaused(actor, queue, false),
  };
}

export type QueueAdminService = ReturnType<typeof createQueueAdminService>;
