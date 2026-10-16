import type { RequestHandler } from 'express';

/**
 * Cache-Control for public, non-user-specific GETs. Express adds a weak ETag to
 * every res.json() body and answers a matching If-None-Match with 304.
 */
export const publicCache: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  next();
};

/**
 * For GETs whose body depends on who is signed in: public caching only for signed-out
 * requests, `private, no-store` as soon as an Authorization header is sent.
 */
export const viewerCache: RequestHandler = (req, res, next) => {
  res.vary('Authorization');
  if (req.get('authorization') !== undefined) {
    res.set('Cache-Control', 'private, no-store');
    next();
    return;
  }
  publicCache(req, res, next);
};
