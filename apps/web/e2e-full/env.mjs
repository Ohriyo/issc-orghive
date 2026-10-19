/**
 * The full-stack e2e environment: the developer's apps/api/.env (CI sets the same variables
 * directly), moved onto its own database, Redis index and ports, so a run never touches
 * the dev data or a running `pnpm dev`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const WEB_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const API_DIR = resolve(WEB_DIR, '..', 'api');
export const API_PORT = 4100;
export const WEB_PORT = 5174;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
/** Seeded accounts all sign in with this (SEED_PASSWORD; CI sets it). */
export const PASSWORD_ENV = 'SEED_PASSWORD';

// Read, not loaded into process.env: the API's NODE_ENV=development there must never leak into
// anything else this process starts (a `vite build` under it bundles development React).
const envFile = resolve(API_DIR, '.env');
const apiDotEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};

function withPath(url, path) {
  const u = new URL(url);
  u.pathname = path;
  return u.toString();
}

/** Only the variables that are set (child processes take strings only). */
export function definedEnv(vars) {
  return Object.fromEntries(Object.entries(vars).filter(([, value]) => value !== undefined));
}

/** The environment the API, worker and seeds run with. */
export function e2eEnv() {
  // Variables already set (CI sets them directly) win over apps/api/.env, as with --env-file.
  const base = { ...apiDotEnv, ...process.env };
  if (!base.DATABASE_URL || !base.REDIS_URL) {
    throw new Error('Set DATABASE_URL and REDIS_URL (apps/api/.env locally, env vars in CI)');
  }
  return definedEnv({
    ...base,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    WEB_ORIGIN,
    DATABASE_URL: withPath(base.DATABASE_URL, '/orghive_e2e'),
    // Index 2: its own rate limits, caches and queues.
    REDIS_URL: withPath(base.REDIS_URL, '/2'),
    LOG_LEVEL: 'warn',
  });
}
