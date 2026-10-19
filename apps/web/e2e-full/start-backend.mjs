#!/usr/bin/env node
/**
 * The API and the worker for the full-stack suite, as one process for Playwright's webServer
 * (it waits on the API's /health; the worker serves no HTTP, so it cannot be waited on alone).
 * If either stops, both stop, so a crashed worker fails the run instead of hanging scans.
 */
import { spawn, spawnSync } from 'node:child_process';
import { API_DIR, e2eEnv } from './env.mjs';

const env = e2eEnv();
const shell = process.platform === 'win32';
const children = ['src/server.ts', 'src/worker.ts'].map((entry) =>
  spawn(shell ? `pnpm exec tsx ${entry}` : 'pnpm', shell ? [] : ['exec', 'tsx', entry], {
    cwd: API_DIR,
    env,
    stdio: 'inherit',
    shell,
  }),
);

/** On Windows a shell child's own children survive a plain kill: end the whole tree. */
function kill(child) {
  if (child.exitCode !== null) return;
  if (shell) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill();
}

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child);
  process.exitCode = code;
}

for (const child of children) child.on('exit', (code) => stopAll(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stopAll(0));
