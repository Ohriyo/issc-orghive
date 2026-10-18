import { pino } from 'pino';
import { createApp, type AppServices } from '#src/app';
import type { Config } from '#src/config';
import type { RateLimitStoreFactory } from '#src/middleware/rate-limit';

export const TEST_WEB_ORIGIN = 'http://localhost:5173';
export const TEST_ASSET_BASE_URL = 'https://cdn.test.local/orghive';

/** Services a test did not wire up fail loudly instead of touching a real database. */
function unwired(name: string): never {
  throw new Error(`${name} is not wired in this test; pass it to buildTestApp()`);
}

const unwiredServices: AppServices = {
  auth: new Proxy({} as AppServices['auth'], {
    get: (_t, key) => () => unwired(`auth.${String(key)}`),
  }),
  tokens: { verify: () => unwired('tokens') },
  colleges: { list: () => unwired('colleges'), getBySlug: () => unwired('colleges') },
  organizations: { getBySlug: () => unwired('organizations') },
  documents: new Proxy({} as AppServices['documents'], {
    get: (_t, key) => () => unwired(`documents.${String(key)}`),
  }),
  uploads: new Proxy({} as AppServices['uploads'], {
    get: (_t, key) => () => unwired(`uploads.${String(key)}`),
  }),
  access: new Proxy({} as AppServices['access'], {
    get: (_t, key) => () => unwired(`access.${String(key)}`),
  }),
  dashboard: { forUser: () => unwired('dashboard') },
  projects: new Proxy({} as AppServices['projects'], {
    get: (_t, key) => () => unwired(`projects.${String(key)}`),
  }),
  appeals: new Proxy({} as AppServices['appeals'], {
    get: (_t, key) => () => unwired(`appeals.${String(key)}`),
  }),
  notifications: new Proxy({} as AppServices['notifications'], {
    get: (_t, key) => () => unwired(`notifications.${String(key)}`),
  }),
  reports: new Proxy({} as AppServices['reports'], {
    get: (_t, key) => () => unwired(`reports.${String(key)}`),
  }),
  search: { search: () => unwired('search') },
};

export function buildTestApp(
  services: Partial<AppServices> = {},
  config: Partial<Pick<Config, 'NODE_ENV' | 'TRUST_PROXY'>> = {},
  rateLimitStore?: RateLimitStoreFactory,
) {
  return createApp({
    config: { WEB_ORIGIN: TEST_WEB_ORIGIN, NODE_ENV: 'test', TRUST_PROXY: false, ...config },
    logger: pino({ level: 'silent' }),
    services: { ...unwiredServices, ...services },
    rateLimitStore,
  });
}
