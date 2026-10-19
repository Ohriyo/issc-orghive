#!/usr/bin/env node
/**
 * Runs Lighthouse CI (lighthouserc.cjs) against the real stack: the API and worker on the
 * orghive_e2e database (start-backend.mjs) and the production build on `vite preview` :5174,
 * which proxies /api to them. Prepare the database first (prepare.mjs, or a full-stack run).
 */
import { spawn, spawnSync } from 'node:child_process';
import { API_PORT, definedEnv, WEB_DIR, WEB_PORT } from './env.mjs';

const isWindows = process.platform === 'win32';
const children = [];

function start(command, env) {
  const child = spawn(command, {
    cwd: WEB_DIR,
    env: definedEnv(env),
    stdio: 'inherit',
    shell: true,
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  }
}

async function waitFor(url, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// Explicitly production: measuring a development build (unminified React) is meaningless.
const webEnv = { ...process.env, NODE_ENV: 'production' };
const build = spawnSync('pnpm exec vite build', {
  cwd: WEB_DIR,
  env: webEnv,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

let code = 1;
try {
  start('node e2e-full/start-backend.mjs', process.env);
  start(`pnpm exec vite preview --port ${WEB_PORT} --strictPort`, {
    ...webEnv,
    ORGHIVE_API_PROXY: `http://localhost:${API_PORT}`,
  });
  await waitFor(`http://localhost:${API_PORT}/health`);
  await waitFor(`http://localhost:${WEB_PORT}/`);
  const lhci = spawnSync('pnpm exec lhci autorun --config=lighthouserc.cjs', {
    cwd: WEB_DIR,
    stdio: 'inherit',
    shell: true,
  });
  code = lhci.status ?? 1;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  stopAll();
}
process.exit(code);
