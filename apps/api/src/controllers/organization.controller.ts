import type { RequestHandler } from 'express';
import { slugParamsSchema } from '@orghive/shared';
import type { OrganizationService } from '#src/services/organization.service';

export function createOrganizationController(organizations: OrganizationService) {
  const getBySlug: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await organizations.getBySlug(slug));
  };

  return { getBySlug };
}
