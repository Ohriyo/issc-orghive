import type { Request, RequestHandler } from 'express';
import {
  normalizePath,
  requestScope,
  routeGroup,
  type Metrics,
} from '#src/lib/metrics';

/**
 * Long-lived or unmeasured responses: the leaderboard's event stream stays open for minutes
 * and would swamp every percentile, and liveness probes are not traffic.
 */
function skipped(path: string): boolean {
  return path === '/health' || path === '/api/v1/health' || path.endsWith('/stream');
}

/**
 * The path a matched route was mounted under. Express clears `req.baseUrl` when a thrown
 * error leaves the routers, so it is then read off the URL: every mount here is a literal
 * prefix (/api/v1, /api/v1/system…), and the route's own segments come last.
 */
function mountOf(req: Request, routePath: string): string {
  if (typeof req.baseUrl === 'string') return req.baseUrl;
  const segments = req.originalUrl.split('?')[0]!.split('/');
  const own = routePath.split('/').length - 1;
  return segments.slice(0, Math.max(1, segments.length - own)).join('/');
}

/** "GET /api/v1/documents/:documentId": the matched route, or the normalized path. */
export function routeOf(req: Request): string {
  const matched = req.route as { path?: unknown } | undefined;
  const path =
    matched && typeof matched.path === 'string'
      ? `${mountOf(req, matched.path)}${matched.path}`
      : normalizePath(req.originalUrl);
  return `${req.method} ${path}`;
}

/** Times every response and opens the scope slow database queries are attributed to. */
export function metricsMiddleware(metrics: Pick<Metrics, 'recordRequest'>): RequestHandler {
  return (req, res, next) => {
    const path = req.originalUrl.split('?')[0]!;
    if (skipped(path)) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    res.once('finish', () => {
      metrics.recordRequest({
        method: req.method,
        route: routeOf(req),
        group: routeGroup(path),
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    requestScope.run({ method: req.method, route: () => routeOf(req) }, next);
  };
}
