import type { RequestHandler } from 'express';
import { removeDemoDataRequestSchema } from '@orghive/shared';
import { authOf } from '#src/middleware/require-auth';
import { requestContext } from '#src/middleware/require-super-admin';
import type { DemoDataService } from '#src/services/demo-data.service';

/** GET /demo-status (public) and /system/demo-data (super admin, already checked). */
export function createDemoDataController(
  demo: Pick<DemoDataService, 'preview' | 'remove' | 'status'>,
) {
  const status: RequestHandler = async (_req, res) => {
    res.json(await demo.status());
  };

  const preview: RequestHandler = async (_req, res) => {
    res.json(await demo.preview());
  };

  const remove: RequestHandler = async (req, res) => {
    const { expectedTotal } = removeDemoDataRequestSchema.parse(req.body);
    const ctx = requestContext(req);
    res.json(
      await demo.remove(
        { userId: authOf(res).userId, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
        expectedTotal,
      ),
    );
  };

  return { status, preview, remove };
}
