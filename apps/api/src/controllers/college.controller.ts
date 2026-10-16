import type { RequestHandler } from 'express';
import { slugParamsSchema } from '@orghive/shared';
import type { CollegeService } from '#src/services/college.service';

export function createCollegeController(colleges: CollegeService) {
  const list: RequestHandler = async (_req, res) => {
    res.json(await colleges.list());
  };

  const getBySlug: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await colleges.getBySlug(slug));
  };

  return { list, getBySlug };
}
