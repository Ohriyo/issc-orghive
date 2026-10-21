// The full-stack e2e suite's data, on top of the normal seed (apps/web/e2e-full).
// Run with: tsx prisma/seed/e2e.ts, against the e2e database only (it refuses any other).
//
// 1. The seeded accounts sign in with SEED_PASSWORD without being asked to change it.
// 2. JPICE has a project created 20 days ago with its event 10 days ahead: the proposal was due
//    6 days ago (14 Manila days after creation), so the next compliance check blocks it. The
//    suite then appeals and the CSC-CEA account approves.
// 3. The leaderboard (6-leaderboard.flow.ts): IECEP, PSME and UAPSA each have a project done
//    today, all on time, so they hold the SBO Top 3 by profit. JPICE and JIIEE each have a
//    project whose event is today with its proposal in: filing their ACR and Financial Report
//    in the suite moves them onto the podium.
import { existsSync } from 'node:fs';
import { academicYearOf, addDays, manilaDate } from '@orghive/shared';
import type { ProjectTaskType } from '@orghive/shared';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createDb, type Db } from '#src/repositories/prisma';
import { planProject } from '#src/services/project-rules';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL ?? '';
if (!/\/orghive_e2e(\?|$)/.test(url)) {
  console.error('e2e seed: DATABASE_URL must point at the orghive_e2e database');
  process.exit(1);
}

export const E2E_PROJECT_NAME = 'Inter-Year Bridge Design Competition (e2e)';

/** Projects the leaderboard flow completes: their event is today, their proposal is in. */
export const LEADERBOARD_PROJECTS = {
  jpice: 'Leaderboard Fun Run (e2e)',
  jiiee: 'Leaderboard Relay (e2e)',
} as const;

/** Already on the SBO podium, with these net profits (centavos), in this order. */
const RANKED_SBOS = [
  ['iecep', 300_000],
  ['psme', 200_000],
  ['uapsa', 100_000],
] as const;

const TASK_DOCUMENT_TYPES: Partial<Record<ProjectTaskType, string>> = {
  PROPOSAL: 'project-proposal',
  ACR: 'activity-completion-report',
  FINANCIAL_REPORT: 'financial-report',
};

/**
 * A project of `slug` created 5 days ago with its event today, whose `filed` tasks have a
 * clean, private file submitted an hour ago (on time). Skipped when it exists already.
 */
async function seedDoneProject(
  db: Db,
  slug: string,
  name: string,
  filed: ProjectTaskType[],
): Promise<string> {
  const org = await db.organization.findUniqueOrThrow({ where: { slug } });
  const account = await db.user.findUniqueOrThrow({ where: { email: `${slug}@orghive.local` } });
  const existing = await db.project.findFirst({ where: { organizationId: org.id, name } });
  if (existing) return existing.id;

  const now = new Date();
  const createdAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const fields = {
    organizationId: org.id,
    name,
    // Today in Manila: the event day has come, and it falls in the current semester.
    targetDate: manilaDate(now),
    location: 'University gymnasium',
    beneficiaries: 'Students',
    description: 'A project for the leaderboard flow.',
    nomRequired: false,
    momRequired: false,
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
    createdById: account.id,
    createdAt,
  };
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
  const projects = createProjectRepository(db);
  const project = await projects.create(fields, plan);
  const submittedAt = new Date(now.getTime() - 60 * 60 * 1000);
  for (const type of filed) {
    const docType = await db.documentType.findUniqueOrThrow({
      where: { slug: TASK_DOCUMENT_TYPES[type]! },
    });
    const document = await db.document.create({
      data: {
        organizationId: org.id,
        typeId: docType.id,
        title: `${name}: ${type}`,
        status: 'available',
        visibility: 'private',
        academicYear: academicYearOf(fields.targetDate),
        createdById: account.id,
      },
    });
    const version = await db.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        storageKey: `files/e2e/${document.id}.pdf`,
        originalFilename: `${type.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1000,
        sha256: 'e'.repeat(64),
        scanStatus: 'clean',
        uploadedById: account.id,
      },
    });
    await db.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    await projects.linkDocument(project.id, type, document.id);
    await db.projectTask.update({
      where: { projectId_type: { projectId: project.id, type } },
      data: { status: 'submitted', submittedAt },
    });
  }
  return project.id;
}

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
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
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
  const figures = createFinancialFiguresRepository(db);
  for (const [slug, net] of RANKED_SBOS) {
    const id = await seedDoneProject(db, slug, `${slug.toUpperCase()} Outreach (e2e)`, [
      'PROPOSAL',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
    await figures.save(id, { incomeCentavos: net, expensesCentavos: 0 });
  }
  for (const [slug, name] of Object.entries(LEADERBOARD_PROJECTS)) {
    await seedDoneProject(db, slug, name, ['PROPOSAL']);
  }

  console.log(
    `e2e seed: ${count} accounts ready, JPICE project with a missed proposal deadline, leaderboard projects`,
  );
} finally {
  await db.$disconnect();
}
