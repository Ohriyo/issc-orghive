import type { Request, RequestHandler, Response } from 'express';
import {
  AUDIT_EXPORT_TRUNCATED_HEADER,
  emailTestRequestSchema,
  flushCacheRequestSchema,
  queueJobParamsSchema,
  queueJobsQuerySchema,
  queueParamsSchema,
  securityCenterQuerySchema,
  systemAuditExportQuerySchema,
} from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { ConsoleActor } from '#src/services/account-admin.service';
import type { CacheAdminService } from '#src/services/cache-admin.service';
import type { EmailTestService } from '#src/services/email-test.service';
import type { QueueAdminService } from '#src/services/queue-admin.service';
import type { SecurityCenterService } from '#src/services/security-center.service';
import type { SystemService } from '#src/services/system.service';

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

function actorOf(req: Request, res: Response): ConsoleActor {
  return { userId: authOf(res).userId, ctx: requestContext(req) };
}

export interface SystemToolsControllerDeps {
  queues: QueueAdminService;
  security: Pick<SecurityCenterService, 'read'>;
  cache: CacheAdminService;
  email: Pick<EmailTestService, 'send'>;
  system: Pick<SystemService, 'exportAuditLogs'>;
}

/** /system tools: queues, the security center, cache, test email and the audit export. */
export function createSystemToolsController({
  queues,
  security,
  cache,
  email,
  system,
}: SystemToolsControllerDeps) {
  const listQueues: RequestHandler = async (_req, res) => {
    res.json(await queues.list());
  };

  const listJobs: RequestHandler = async (req, res) => {
    const { queue } = queueParamsSchema.parse(req.params);
    res.json(await queues.jobs(queue, queueJobsQuerySchema.parse(req.query)));
  };

  const retryJob: RequestHandler = async (req, res) => {
    const { queue, jobId } = queueJobParamsSchema.parse(req.params);
    await queues.retry(actorOf(req, res), queue, jobId);
    res.status(204).end();
  };

  const removeJob: RequestHandler = async (req, res) => {
    const { queue, jobId } = queueJobParamsSchema.parse(req.params);
    await queues.remove(actorOf(req, res), queue, jobId);
    res.status(204).end();
  };

  const pauseQueue: RequestHandler = async (req, res) => {
    const { queue } = queueParamsSchema.parse(req.params);
    res.json(await queues.pause(actorOf(req, res), queue));
  };

  const resumeQueue: RequestHandler = async (req, res) => {
    const { queue } = queueParamsSchema.parse(req.params);
    res.json(await queues.resume(actorOf(req, res), queue));
  };

  const securityCenter: RequestHandler = async (req, res) => {
    const { range } = securityCenterQuerySchema.parse(req.query);
    res.json(await security.read(range));
  };

  const cacheStats: RequestHandler = async (_req, res) => {
    res.json(await cache.stats());
  };

  const flushCache: RequestHandler = async (req, res) => {
    const { namespace } = flushCacheRequestSchema.parse(req.body);
    res.json(await cache.flush(actorOf(req, res), namespace));
  };

  const sendTestEmail: RequestHandler = async (req, res) => {
    const { to } = emailTestRequestSchema.parse(req.body);
    res.json(await email.send(actorOf(req, res), to));
  };

  const exportAuditLogs: RequestHandler = async (req, res) => {
    const filters = systemAuditExportQuerySchema.parse(req.query);
    const { csv, truncated } = await system.exportAuditLogs(actorOf(req, res), filters);
    const day = new Date().toISOString().slice(0, 10);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orghive-audit-${day}.csv"`,
        'Access-Control-Expose-Headers': AUDIT_EXPORT_TRUNCATED_HEADER,
        [AUDIT_EXPORT_TRUNCATED_HEADER]: truncated ? '1' : '0',
      })
      // A byte-order mark, so Excel reads the UTF-8 names correctly.
      .send(BYTE_ORDER_MARK + csv);
  };

  return {
    listQueues,
    listJobs,
    retryJob,
    removeJob,
    pauseQueue,
    resumeQueue,
    securityCenter,
    cacheStats,
    flushCache,
    sendTestEmail,
    exportAuditLogs,
  };
}
