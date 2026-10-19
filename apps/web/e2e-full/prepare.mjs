#!/usr/bin/env node
/**
 * Before the full-stack suite: a clean orghive_e2e database (migrated, seeded, plus the e2e
 * seed) and an empty Redis index 2. Then the suite starts the API, worker and web app.
 * Services come from `docker compose up -d` (postgres, redis, minio, clamav, mailpit).
 */
import { spawnSync } from 'node:child_process';
import { API_DIR, e2eEnv } from './env.mjs';

const env = e2eEnv();

function step(label, command, args) {
  console.log(`e2e-full: ${label}`);
  // pnpm is a .cmd shim on Windows, which needs a shell; its arguments here are fixed.
  const viaShell = process.platform === 'win32' && command === 'pnpm';
  const result = viaShell
    ? spawnSync([command, ...args].join(' '), { cwd: API_DIR, env, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd: API_DIR, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`e2e-full: ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

step('reset the e2e database', 'pnpm', ['exec', 'prisma', 'migrate', 'reset', '--force']);
step('seed', 'pnpm', ['exec', 'tsx', 'prisma/seed/seed.ts']);
step('e2e seed', 'pnpm', ['exec', 'tsx', 'prisma/seed/e2e.ts']);

// ioredis is the API's dependency, so this runs from its package.
step('empty Redis index 2', 'node', [
  '--input-type=module',
  '-e',
  "import { Redis } from 'ioredis'; const r = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 }); await r.flushdb(); r.disconnect();",
]);
console.log('e2e-full: ready');
