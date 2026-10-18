import type { RequestHandler } from 'express';
import { searchQuerySchema } from '@orghive/shared';
import { maybeAuthOf } from '#src/middleware/require-auth';
import type { SearchService } from '#src/services/search.service';

export function createSearchController(search: SearchService) {
  const find: RequestHandler = async (req, res) => {
    const query = searchQuerySchema.parse(req.query);
    res.json(await search.search(maybeAuthOf(res)?.userId, query));
  };

  return { find };
}
