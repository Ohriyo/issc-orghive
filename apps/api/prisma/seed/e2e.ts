// The full-stack e2e suite's data, on top of the normal seed (apps/web/e2e-full).
// Run with: tsx prisma/seed/e2e.ts, against the e2e database only (it refuses any other).
//
// 1. The seeded accounts sign in with SEED_PASSWORD without being asked to change it.
// 2. JPICE has a project created 20 days ago with its event 10 days ahead: the proposal was due
//    6 days ago (14 Manila days after creation), so the next compliance check blocks it. The
//    suite then appeals and the CSC-CEA account approves.
import { existsSync } from 'node:fs';
import { addDays, manilaDate } from '@orghive/shared';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createDb } from '#src/repositories/prisma';
import { planProject } from '#src/services/project-rules';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL ?? '';
if (!/\/orghive_e2e(\?|$)/.test(url)) {
  console.error('e2e seed: DATABASE_URL must point at the orghive_e2e database');
  process.exit(1);
}

export const E2E_PROJECT_NAME = 'Inter-Year Bridge Design Competition (e2e)';

const db = createDb(url);
try {
  const { count } = await db.user.updateMany({
    where: { email: { endsWith: '@orghive.local' } },
    data: { mustChangePassword: false },
  });

  const jpice = await db.organization.findUniqueOrThrow({ where: { slug: 'jpice' } });
  const account = await db.user.findUniqueOrThrow({ where: { email: 'jpice@orghive.local' } });
  const createdAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  const fields = {
    organizationId: jpice.id,
    name: E2E_PROJECT_NAME,
    targetDate: addDays(manilaDate(new Date()), 10),
    location: 'CEA Building, Room 101',
    beneficiaries: 'Civil engineering students',
    description: 'Teams build and load-test balsa truss bridges.',
    nomRequired: false,
    momRequired: false,
    createdById: account.id,
    createdAt,
  };
  const existing = await db.project.findFirst({
    where: { organizationId: jpice.id, name: E2E_PROJECT_NAME },
  });
  if (!existing) {
    const plan = planProject(
      {
        ...fields,
        proposalDueOverride: null,
        postEventDueOverride: null,
        filed: new Set(),
        exemptFromCompliance: false,
      },
      createdAt,
    );
    await createProjectRepository(db).create(fields, plan);
  }
  console.log(`e2e seed: ${count} accounts ready, JPICE project with a missed proposal deadline`);
} finally {
  await db.$disconnect();
}
