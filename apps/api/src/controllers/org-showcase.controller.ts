import type { RequestHandler } from 'express';
import { slugParamsSchema } from '@orghive/shared';
import type { OrgShowcaseService } from '#src/services/org-showcase.service';

export function createOrgShowcaseController(showcase: OrgShowcaseService) {
  /** GET /organizations/:slug/showcase: the same for every viewer. */
  const read: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await showcase.read(slug));
  };
  return { read };
}
