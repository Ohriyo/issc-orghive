import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Same .env the API uses. CI sets DATABASE_URL directly, so the file is optional.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/seed.ts',
  },
  datasource: {
    // `prisma generate` does not need a database, so this may be empty there.
    url: process.env.DATABASE_URL ?? '',
  },
});
