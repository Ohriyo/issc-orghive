import { writeFileSync } from 'node:fs';
import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers';

/*
 * Every route the API serves needs a session, unless it is on the PUBLIC list below
 * (CLAUDE.md, "Security rules"). The routes are not listed by hand: building the app records
 * each router's mounts and routes, so a new route is checked the day it is added, and one
 * that forgets requireAuth fails here.
 */

interface RecordedRoute {
  router: object;
  path: string;
  route: { methods: Record<string, boolean> };
}
interface Mount {
  parent: object;
  child: object;
  path: string;
}

function recordRoutes(build: () => unknown): { method: string; path: string }[] {
  const routes: RecordedRoute[] = [];
  const mounts: Mount[] = [];
  const proto = Router.prototype as unknown as {
    use: (...args: unknown[]) => unknown;
    route: (path: string) => RecordedRoute['route'];
  };
  const { use, route } = proto;
  proto.use = function (this: object, ...args: unknown[]) {
    const path = typeof args[0] === 'string' ? args[0] : '/';
    for (const fn of args.flat(Infinity)) {
      // A mounted router is a function that carries its own stack.
      if (typeof fn === 'function' && 'stack' in fn) mounts.push({ parent: this, child: fn, path });
    }
    return use.apply(this, args);
  };
  proto.route = function (this: object, path: string) {
    const recorded = route.call(this, path);
    routes.push({ router: this, path, route: recorded });
    return recorded;
  };
  try {
    build();
  } finally {
    proto.use = use;
    proto.route = route;
  }

  const join = (a: string, b: string) => `${a.replace(/\/$/, '')}/${b.replace(/^\//, '')}`;
  /** Every full prefix a router is reachable under (a router can be mounted twice). */
  function prefixesOf(router: object): string[] {
    const parents = mounts.filter((m) => m.child === router);
    if (parents.length === 0) return [''];
    return parents.flatMap((m) => prefixesOf(m.parent).map((p) => join(p, m.path)));
  }
  return routes.flatMap((r) =>
    prefixesOf(r.router).flatMap((prefix) =>
      Object.keys(r.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => ({ method, path: join(prefix, r.path).replace(/\/$/, '') || '/' })),
    ),
  );
}

/** Routes anyone may call signed out, with why. Everything else must answer 401. */
const PUBLIC: Record<string, string> = {
  'get /health': 'liveness probe',
  'get /api/v1/health': 'liveness probe',
  'post /api/v1/auth/login': 'signing in',
  'post /api/v1/auth/mfa/verify':
    'super admin code step; the challenge token is checked by the service',
  'post /api/v1/auth/refresh': 'refresh cookie, checked by the service',
  'post /api/v1/auth/logout': 'clears the refresh cookie',
  'post /api/v1/auth/forgot-password': 'password reset request',
  'post /api/v1/auth/reset-password': 'reset token, checked by the service',
  'get /api/v1/colleges': 'public browsing',
  'get /api/v1/colleges/:slug': 'public browsing',
  'get /api/v1/organizations/:slug': 'public browsing',
  'get /api/v1/organizations/:slug/documents': 'Paperworks; visibility filter in the repository',
  'get /api/v1/documents/:documentId': 'public files; visibility filter in the repository',
  'get /api/v1/documents/:documentId/versions': 'public files; visibility filter',
  'get /api/v1/documents/:documentId/versions/:versionId/download-url':
    'public files; visibility filter, 5-minute signed URL',
  'get /api/v1/document-types': 'upload and filter choices',
  'get /api/v1/search': 'public search; visibility filter in the repository',
  'get /api/v1/announcements': 'updates are public (DOMAIN_RULES.md)',
  'get /api/v1/announcements/:announcementId': 'updates are public (DOMAIN_RULES.md)',
};

const UUID = '0199f0a0-0000-7000-8000-000000000001';

/** A concrete URL for a route pattern: params become valid values, so auth runs first. */
function concrete(path: string): string {
  return path
    .replace(/:(\w+)/g, (_m, name: string) =>
      /id$/i.test(name) ? UUID : name === 'slug' ? 'jpice' : 'x',
    )
    .replace(/\*\w*/g, 'x');
}

const routes = recordRoutes(() => buildTestApp());
// ROUTE_INVENTORY=<file> writes the list out, to review what the API serves.
if (process.env.ROUTE_INVENTORY) {
  writeFileSync(
    process.env.ROUTE_INVENTORY,
    routes.map((r) => `${r.method.toUpperCase()} ${r.path}`).join('\n'),
  );
}

describe('route inventory', () => {
  it('finds the routes (guards against the recorder silently breaking)', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes).toContainEqual({ method: 'get', path: '/api/v1/me/dashboard' });
  });

  it('every public exception still exists', () => {
    const known = new Set(routes.map((r) => `${r.method} ${r.path}`));
    expect(Object.keys(PUBLIC).filter((key) => !known.has(key))).toEqual([]);
  });
});

describe('every non-public route needs a session (401)', () => {
  const app = buildTestApp();
  const guarded = routes.filter((r) => !(`${r.method} ${r.path}` in PUBLIC));
  it.each(guarded.map((r) => [r.method.toUpperCase(), r.path] as const))(
    '%s %s',
    async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get'](concrete(path)).send({});
      expect(res.status, `${method} ${path} answered ${res.status} without a session`).toBe(401);
    },
  );
});
