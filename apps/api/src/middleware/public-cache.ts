import type { RequestHandler } from 'express';

/**
 * Cache-Control for public, non-user-specific GETs. Express adds a weak ETag to
 * every res.json() body and answers a matching If-None-Match with 304.
 */
export const publicCache: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  next();
};
