#!/usr/bin/env node
/**
 * Runs the visual regression checks (visual.spec.ts) in the Playwright Docker image, so the
 * baselines render the same on every machine and in CI. Extra arguments go to Playwright,
 * e.g. `--update-snapshots`.
 *
 * Inside the image already (CI sets ORGHIVE_VISUAL=1), it runs Playwright directly.
 * Elsewhere it starts the image with the repository mounted. Linux gets its own node_modules
 * (named volumes), so the host's Windows or macOS binaries are never mixed in.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(webDir, '..', '..');
const args = process.argv.slice(2);

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32' && command !== 'docker',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

if (process.env.ORGHIVE_VISUAL) {
  run(
    'pnpm',
    [
      'exec',
      'playwright',
      'test',
      '-c',
      'e2e/playwright.config.ts',
      '--project',
      'visual',
      ...args,
    ],
    { ORGHIVE_VISUAL: '1' },
  );
}

const pkg = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8'));
const version = (pkg.devDependencies['@playwright/test'] ?? '').replace(/^[^\d]*/, '');
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const modules = [
  'node_modules',
  'apps/web/node_modules',
  'apps/api/node_modules',
  'packages/shared/node_modules',
];

const script = [
  'corepack enable',
  'pnpm config set store-dir /pnpm-store',
  'pnpm install --frozen-lockfile --ignore-scripts',
  `cd apps/web && ORGHIVE_VISUAL=1 CI=1 pnpm exec playwright test -c e2e/playwright.config.ts --project visual ${args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
].join(' && ');

console.log(`Visual checks in ${image}`);
run('docker', [
  'run',
  '--rm',
  '--ipc=host',
  '-v',
  `${repoDir}:/repo`,
  ...modules.flatMap((m) => ['-v', `orghive-visual-${m.replace(/\//g, '-')}:/repo/${m}`]),
  '-v',
  'orghive-visual-pnpm-store:/pnpm-store',
  '-w',
  '/repo',
  image,
  'bash',
  '-c',
  script,
]);
