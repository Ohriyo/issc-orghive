import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  QUEUE_JOBS_PAGE_SIZE,
  type QueueJob,
  type QueueJobState,
} from '@orghive/shared';
import { memoryQueueAdmin } from '#src/lib/queue-admin';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import { createQueueAdminService } from '#src/services/queue-admin.service';

const T0 = new Date('2026-11-12T01:00:00Z');
const actor = { userId: 'dev', ctx: { ip: '203.0.113.9', userAgent: 'vitest' } };

const job = (id: string, state: QueueJobState): QueueJob & { state: QueueJobState } => ({
  id,
  name: 'process-version',
  data: { versionId: `v-${id}` },
  attemptsMade: state === 'failed' ? 3 : 0,
  maxAttempts: 3,
  failedReason: state === 'failed' ? 'ClamAV unreachable' : null,
  queuedAt: T0.toISOString(),
  startedAt: null,
  finishedAt: null,
  state,
});

function setup() {
  const queues = memoryQueueAdmin({
    documents: [job('1', 'failed'), job('2', 'waiting'), job('3', 'failed'), job('4', 'active')],
    previews: [],
  });
  const audit: AuditEntry[] = [];
  const service = createQueueAdminService({
    queues,
    audit: {
      record: (entry) => {
        audit.push(entry);
        return Promise.resolve();
      },
    },
    now: () => T0,
  });
  return { service, queues, audit };
}

describe('queueAdmin.list and jobs', () => {
  it('counts every queue', async () => {
    const { service } = setup();
    expect(await service.list()).toEqual({
      queues: [
        {
          name: 'documents',
          paused: false,
          waiting: 1,
          active: 1,
          delayed: 0,
          failed: 2,
          completed: 0,
        },
        {
          name: 'previews',
          paused: false,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        },
      ],
      generatedAt: T0.toISOString(),
    });
  });

  it('lists one state of one queue, a page at a time', async () => {
    const { service } = setup();
    const failed = await service.jobs('documents', { state: 'failed', page: 0 });
    expect(failed).toMatchObject({
      state: 'failed',
      page: 0,
      pageSize: QUEUE_JOBS_PAGE_SIZE,
      total: 2,
    });
    expect(failed.items.map((j) => j.id)).toEqual(['1', '3']);
    expect((await service.jobs('documents', { state: 'failed', page: 1 })).items).toEqual([]);
  });

  it('refuses a queue it does not know', async () => {
    const { service } = setup();
    await expect(service.jobs('nope', { state: 'failed', page: 0 })).rejects.toMatchObject({
      status: 404,
      code: ErrorCode.NOT_FOUND,
    });
  });
});

describe('queueAdmin.retry and remove', () => {
  it('retries a failed job and audits it', async () => {
    const { service, queues, audit } = setup();
    await service.retry(actor, 'documents', '1');
    expect(queues.jobsOf('documents').find((j) => j.id === '1')?.state).toBe('waiting');
    expect(audit).toEqual([
      expect.objectContaining({
        action: 'queue_job_retry',
        actorId: 'dev',
        entityType: 'queue',
        entityId: 'documents',
        metadata: { queue: 'documents', jobId: '1', name: 'process-version' },
        ip: '203.0.113.9',
      }),
    ]);
  });

  it('removes a failed job and audits it', async () => {
    const { service, queues, audit } = setup();
    await service.remove(actor, 'documents', '3');
    expect(queues.jobsOf('documents').map((j) => j.id)).toEqual(['1', '2', '4']);
    expect(audit[0]).toMatchObject({ action: 'queue_job_remove', metadata: { jobId: '3' } });
  });

  it('leaves waiting, running and missing jobs alone', async () => {
    const { service, audit } = setup();
    await expect(service.retry(actor, 'documents', '2')).rejects.toMatchObject({ status: 409 });
    await expect(service.remove(actor, 'documents', '4')).rejects.toMatchObject({ status: 409 });
    await expect(service.retry(actor, 'documents', '99')).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(actor, 'nope', '1')).rejects.toMatchObject({ status: 404 });
    expect(audit).toEqual([]);
  });
});

describe('queueAdmin.pause and resume', () => {
  it('pauses and resumes once each, audited; repeating changes nothing', async () => {
    const { service, queues, audit } = setup();
    expect(await service.pause(actor, 'previews')).toMatchObject({
      name: 'previews',
      paused: true,
    });
    expect(queues.paused.has('previews')).toBe(true);
    await service.pause(actor, 'previews');
    expect(await service.resume(actor, 'previews')).toMatchObject({ paused: false });
    await service.resume(actor, 'previews');
    expect(audit.map((e) => e.action)).toEqual(['queue_pause', 'queue_resume']);
    await expect(service.pause(actor, 'nope')).rejects.toMatchObject({ status: 404 });
  });
});
