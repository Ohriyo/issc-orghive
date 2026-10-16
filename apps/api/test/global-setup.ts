// Creates and migrates the repository-test database once per test run.
// Uses `migrate deploy` (never `migrate reset`); tests clear tables with TRUNCATE.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import pg from 'pg';

export default async function setup() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy it from apps/api/.env.example and run `docker compose up -d`.',
    );
  }

  const target = new URL(url);
  const dbName = target.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error(`Refusing to use "${dbName}" as a test database: its name must end in _test.`);
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
