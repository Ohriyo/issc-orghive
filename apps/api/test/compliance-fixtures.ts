import { pino } from 'pino';
import type { ProjectTaskType } from '@orghive/shared';
import type { Storage } from '#src/lib/storage';
import { createAppealRepository } from '#src/repositories/appeal.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import type { Db } from '#src/repositories/prisma';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createAppealService } from '#src/services/appeal.service';
import { createCompliance } from '#src/services/compliance.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createNotificationService } from '#src/services/notification.service';
import { createAttachmentProcessing } from '#src/services/processing.service';
import { createProjectService } from '#src/services/project.service';
import { planProject } from '#src/services/project-rules';
import { createProjectSync } from '#src/services/project-sync.service';
import { createRecipients } from '#src/services/recipients.service';
import { createUploadService } from '#src/services/upload.service';
import { memoryCache } from '#src/lib/cache';
import {
  buildWorld,
  createTaskDocumentTypes,
  createTestDocument,
  resetDb,
  TERM_END,
  TERM_START,
} from './db';

export type Person =
  | 'officer'
  | 'adviser'
  | 'governor'
  | 'cscOfficer'
  | 'catGovernor'
  | 'catSboOfficer'
  | 'psmeOfficer'
  | 'isscPresident'
  | 'isscAdviser'
  | 'admin'
  | 'outsider';

/**
 * The test world plus everyone section 3 involves: JPICE (an SBO under CSC-CEA) with an
 * officer and an adviser, the CSC-CEA Governor and a plain CSC officer, CSC-CAT with its
 * Governor and an SBO of its own (CAT-SBO), the ISSC President, adviser and an admin.
 */
export async function buildComplianceWorld(db: Db) {
  await resetDb(db);
  const world = await buildWorld(db);
  await createTaskDocumentTypes(db);
  const catSbo = await db.organization.create({
    data: {
      type: 'SBO',
      slug: 'cat-sbo',
      acronym: 'CATSBO',
      name: 'CAT student body',
      parentId: world.orgs.cscCat.id,
      collegeId: world.colleges.cat.id,
    },
  });
  const orgs = { ...world.orgs, catSbo };
  const ids = {
    officer: world.users.officer.id,
    governor: world.users.governor.id,
    outsider: world.users.outsider.id,
  } as Record<Person, string>;

  const people: [
    Exclude<Person, 'officer' | 'governor' | 'outsider'>,
    string,
    'officer' | 'adviser' | 'admin',
    boolean,
  ][] = [
    ['adviser', orgs.jpice.id, 'adviser', false],
    ['cscOfficer', orgs.cscCea.id, 'officer', false],
    ['catGovernor', orgs.cscCat.id, 'officer', true],
    ['catSboOfficer', orgs.catSbo.id, 'officer', true],
    ['psmeOfficer', orgs.psme.id, 'officer', true],
    ['isscPresident', orgs.issc.id, 'officer', true],
    ['isscAdviser', orgs.issc.id, 'adviser', false],
    ['admin', orgs.issc.id, 'admin', false],
  ];
  for (const [key, organizationId, role, isHead] of people) {
    const user = await db.user.create({
      data: { email: `${key}@appeals.test`, name: key, passwordHash: 'x' },
    });
    await db.membership.create({
      data: {
        userId: user.id,
        organizationId,
        role,
        isHead,
        termStart: TERM_START,
        termEnd: role === 'admin' ? null : TERM_END,
      },
    });
    ids[key] = user.id;
  }
  return { world, orgs, ids };
}

/** Storage stand-in: an upload "exists" once its intent exists, as declared. */
export function fakeStorage(db: Db): Storage {
  return {
    presignPut: (key) => Promise.resolve({ url: `https://storage.test/${key}?put`, headers: {} }),
    presignGet: (key) => Promise.resolve(`https://storage.test/${key}?get`),
    head: async (key) => {
      const intent = await db.uploadIntent.findUnique({ where: { key } });
      return intent ? { sizeBytes: intent.sizeBytes, contentType: intent.contentType } : null;
    },
    read: async (key) => {
      const a = await db.appealAttachment.findUnique({ where: { storageKey: key } });
      return Buffer.alloc(a?.sizeBytes ?? 0);
    },
    put: () => Promise.resolve(),
    move: () => Promise.resolve(),
    delete: () => Promise.resolve(),
  };
}

/** Every section 3 service, wired to the test database with in-memory queues. */
export function buildComplianceServices(db: Db) {
  const queued = { emails: [] as string[], scans: [] as string[], versions: [] as string[] };
  const storage = fakeStorage(db);
  const audit = createAuditLogRepository(db);
  const memberships = createMembershipRepository(db);
  const organizations = createOrganizationRepository(db);
  const projects = createProjectRepository(db);
  const freezes = createOrgFreezeRepository(db);
  const appealRepo = createAppealRepository(db);
  const documentRepo = createDocumentRepository(db);
  const documentTypes = createDocumentTypeRepository(db);
  const viewers = createDocumentViewerService({ memberships });
  const uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
  const notifications = createNotificationService({
    notifications: createNotificationRepository(db),
    queue: {
      enqueueEmails: (ids) => {
        queued.emails.push(...ids);
        return Promise.resolve();
      },
    },
    logger: pino({ level: 'silent' }),
  });
  const recipients = createRecipients({ memberships, organizations });
  const sync = createProjectSync({
    projects,
    compliance: createCompliance({ freezes, recipients, notifications, audit }),
  });
  const documents = createDocumentService({
    documents: documentRepo,
    documentTypes,
    organizations,
    viewers,
    uploads,
    queue: {
      enqueueProcessing: (id) => {
        queued.versions.push(id);
        return Promise.resolve();
      },
    },
    storage,
    audit,
    cache: memoryCache(),
  });
  const projectService = createProjectService({
    projects,
    sync,
    freezes,
    documents,
    documentReads: documentRepo,
    documentTypes,
    uploads,
    viewers,
    audit,
  });
  const appeals = createAppealService({
    appeals: appealRepo,
    projects,
    freezes,
    sync,
    memberships,
    recipients,
    notifications,
    uploads,
    queue: {
      enqueueAttachmentScan: (id) => {
        queued.scans.push(id);
        return Promise.resolve();
      },
    },
    storage,
    audit,
  });
  const verdict = { clean: true };
  const attachments = createAttachmentProcessing({
    appeals: appealRepo,
    storage,
    scanner: {
      scan: () =>
        Promise.resolve(verdict.clean ? { clean: true } : { clean: false, signature: 'Eicar' }),
    } as never,
    tools: { detectMimeType: () => Promise.resolve('application/pdf') },
    audit,
    logger: pino({ level: 'silent' }),
  });
  return {
    queued,
    storage,
    uploads,
    sync,
    projectService,
    appeals,
    notifications,
    attachments,
    verdict,
    repos: { projects, freezes, appealRepo, memberships },
  };
}

/**
 * A project of `organizationId` created at `createdAt` (Manila deadlines follow from it),
 * whose `filed` tasks already have a clean file.
 */
export async function seedProject(
  db: Db,
  input: {
    organizationId: string;
    createdById: string;
    createdAt: Date;
    targetDate: string;
    name?: string;
    filed?: ProjectTaskType[];
  },
) {
  const projects = createProjectRepository(db);
  const fields = {
    organizationId: input.organizationId,
    name: input.name ?? 'Bridge design competition',
    targetDate: input.targetDate,
    location: 'CEA Building',
    beneficiaries: 'CE students',
    description: 'A truss bridge competition.',
    nomRequired: false,
    momRequired: false,
    createdById: input.createdById,
    createdAt: input.createdAt,
  };
  const plan = planProject(
    { ...fields, proposalDueOverride: null, postEventDueOverride: null, filed: new Set() },
    input.createdAt,
  );
  const project = await projects.create(fields, plan);
  const type = await db.documentType.findUniqueOrThrow({ where: { slug: 'project-proposal' } });
  for (const task of input.filed ?? []) {
    const doc = await createTestDocument(db, {
      organizationId: input.organizationId,
      typeId: type.id,
      title: `${task} file`,
      status: 'available',
      createdById: input.createdById,
    });
    await projects.linkDocument(project.id, task, doc.id);
  }
  return project;
}

/** An appeal attachment uploaded by `userId` (the browser PUT assumed done), still pending. */
export async function seedAttachment(
  services: ReturnType<typeof buildComplianceServices>,
  org: { id: string; slug: string },
  userId: string,
) {
  const target = await services.appeals.attachmentUploadUrl({ userId }, org, {
    filename: 'adviser-letter.pdf',
    contentType: 'application/pdf',
    sizeBytes: 2048,
  });
  return services.appeals.addAttachment({ userId }, org, target.uploadKey);
}
