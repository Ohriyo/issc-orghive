import { PROJECT_TASK_DOCUMENT_TYPES } from '@orghive/shared';
import { createDb, type Db } from '#src/repositories/prisma';

let db: Db | undefined;

/** Client for the test database. Global setup has already created and migrated it. */
export function testDb(): Db {
  if (!process.env.DATABASE_URL_TEST) throw new Error('DATABASE_URL_TEST is not set');
  db ??= createDb(process.env.DATABASE_URL_TEST);
  return db;
}

export async function resetDb(client: Db) {
  await client.$executeRawUnsafe(`
    TRUNCATE semestral_reports, notifications, appeal_attachments, appeals, org_freezes,
      project_tasks, projects,
      upload_intents, document_versions, documents, document_types,
      announcements, audit_logs, refresh_tokens, password_reset_tokens, recovery_codes,
      officer_terms, password_reveals, account_requests, users,
      organizations, colleges
    RESTART IDENTITY CASCADE`);
}

/** The document types project task files are archived as (the migration seeds them). */
export async function createTaskDocumentTypes(client: Db) {
  for (const type of Object.values(PROJECT_TASK_DOCUMENT_TYPES)) {
    await client.documentType.upsert({ where: { slug: type.slug }, create: type, update: {} });
  }
}

export const TERM_START = new Date('2026-08-01');
export const TERM_END = new Date('2027-07-31');

/**
 * An organization's shared account, with its officer-in-charge for the current term. Locked
 * or deactivated accounts act for nobody.
 */
export async function createAccount(
  client: Db,
  email: string,
  organizationId: string,
  {
    passwordHash = 'x',
    locked = false,
    disabled = false,
    mustChangePassword = false,
  }: {
    passwordHash?: string;
    locked?: boolean;
    disabled?: boolean;
    mustChangePassword?: boolean;
  } = {},
) {
  const user = await client.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash,
      organizationId,
      mustChangePassword,
      lockedAt: locked ? new Date() : null,
      disabledAt: disabled ? new Date() : null,
    },
  });
  await client.officerTerm.create({
    data: {
      userId: user.id,
      organizationId,
      officerName: `${user.name} officer`,
      officerPosition: 'President',
      officerEmail: `officer.${email}`,
      termStart: TERM_START,
      termEnd: TERM_END,
    },
  });
  return user;
}

export interface TestDocumentInput {
  organizationId: string;
  typeId: string;
  title: string;
  status: 'scanning' | 'available' | 'quarantined' | 'archived';
  createdById: string;
  academicYear?: string;
  deleted?: boolean;
  /** Defaults to public, so status alone decides what the public sees. */
  visibility?: 'public' | 'governing' | 'private';
}

/** The scan state of version 1 that each document status implies. */
const SCAN_FOR_STATUS = {
  scanning: 'pending',
  available: 'clean',
  quarantined: 'infected',
  archived: 'clean',
} as const;

/** A document with version 1 as its current version, scanned as its status implies. */
export async function createTestDocument(client: Db, input: TestDocumentInput) {
  const { deleted, visibility = 'public', academicYear = '2026-2027', ...data } = input;
  const created = await client.document.create({
    data: {
      ...data,
      academicYear,
      visibility,
      deletedAt: deleted ? new Date() : null,
    },
  });
  const scanStatus = SCAN_FOR_STATUS[input.status];
  const version = await client.documentVersion.create({
    data: {
      documentId: created.id,
      version: 1,
      storageKey: `test/${created.id}.pdf`,
      originalFilename: `${created.id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      sha256: scanStatus === 'pending' ? null : 'x'.repeat(64),
      scanStatus,
      uploadedById: input.createdById,
    },
  });
  return client.document.update({
    where: { id: created.id },
    data: { currentVersionId: version.id },
  });
}

/**
 * A small world: the ISSC, CSC-CEA with JPICE and PSME, and CSC-CAT.
 * JPICE has an available document at each visibility, one in every other state and a
 * deleted one, all uploaded by its officer; PSME and CSC-CEA have a few.
 */
export async function buildWorld(client: Db) {
  const cea = await client.college.create({
    data: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  });
  const cat = await client.college.create({
    data: { code: 'CAT', slug: 'cat', name: 'College of Agriculture and Technology' },
  });

  const issc = await client.organization.create({
    data: {
      type: 'ISSC',
      slug: 'issc',
      acronym: 'ISSC',
      name: 'Institutional Supreme Student Council',
    },
  });
  const cscCea = await client.organization.create({
    data: {
      type: 'CSC',
      slug: 'csc-cea',
      acronym: 'CSC-CEA',
      name: 'CSC of CEA',
      description: 'The CSC-CEA serves all CEA-tizens.',
      parentId: issc.id,
      collegeId: cea.id,
    },
  });
  const cscCat = await client.organization.create({
    data: {
      type: 'CSC',
      slug: 'csc-cat',
      acronym: 'CSC-CAT',
      name: 'CSC of CAT',
      parentId: issc.id,
      collegeId: cat.id,
    },
  });
  const jpice = await client.organization.create({
    data: {
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: 'Junior Philippine Institute of Civil Engineers',
      parentId: cscCea.id,
      collegeId: cea.id,
    },
  });
  const psme = await client.organization.create({
    data: {
      type: 'SBO',
      slug: 'psme',
      acronym: 'PSME',
      name: 'Philippine Society of Mechanical Engineers',
      parentId: cscCea.id,
      collegeId: cea.id,
    },
  });

  // One shared account per organization (docs/DOMAIN_RULES.md, "Accounts"). The names are
  // the old roles, so tests still read as "the officer uploads, the governor decides".
  const officer = await createAccount(client, 'jpice@test.local', jpice.id);
  const governor = await createAccount(client, 'csc-cea@test.local', cscCea.id);
  const isscAccount = await createAccount(client, 'issc@test.local', issc.id);
  const psmeAccount = await createAccount(client, 'psme@test.local', psme.id);
  const cscCatAccount = await createAccount(client, 'csc-cat@test.local', cscCat.id);
  // Signed in, but acting for no organization (like the super admin): sees what the public sees.
  const outsider = await client.user.create({
    data: { email: 'outsider@test.local', name: 'outsider', passwordHash: 'x' },
  });

  const proposal = await client.documentType.create({
    data: { slug: 'activity-proposal', name: 'Activity proposal' },
  });
  const report = await client.documentType.create({
    data: { slug: 'accomplishment-report', name: 'Accomplishment report' },
  });

  const uploaderOf = new Map([
    [jpice.id, officer.id],
    [psme.id, psmeAccount.id],
    [cscCea.id, governor.id],
    [cscCat.id, cscCatAccount.id],
    [issc.id, isscAccount.id],
  ]);
  const doc = (
    organizationId: string,
    title: string,
    status: TestDocumentInput['status'],
    extra: Partial<TestDocumentInput> = {},
  ) =>
    createTestDocument(client, {
      organizationId,
      title,
      status,
      typeId: proposal.id,
      // Uploaded by the organization's own shared account.
      createdById: uploaderOf.get(organizationId)!,
      ...extra,
    });

  const docs = {
    jpicePublic: await doc(jpice.id, 'JPICE accomplishment report', 'available', {
      typeId: report.id,
      academicYear: '2025-2026',
    }),
    jpiceGoverning: await doc(jpice.id, 'JPICE bridge competition proposal', 'available', {
      visibility: 'governing',
    }),
    jpicePrivate: await doc(jpice.id, 'JPICE draft resolution', 'available', {
      visibility: 'private',
    }),
    jpiceScanning: await doc(jpice.id, 'JPICE week narrative report', 'scanning', {
      typeId: report.id,
    }),
    jpiceQuarantined: await doc(jpice.id, 'JPICE refused upload', 'quarantined'),
    jpiceArchived: await doc(jpice.id, 'JPICE archived proposal', 'archived'),
    jpiceDeleted: await doc(jpice.id, 'JPICE deleted bridge proposal', 'available', {
      deleted: true,
    }),
    psmePublic: await doc(psme.id, 'PSME bridge seminar report', 'available', {
      typeId: report.id,
    }),
    psmePrivate: await doc(psme.id, 'PSME plant visit proposal', 'available', {
      visibility: 'private',
    }),
    cscCeaPublic: await doc(cscCea.id, 'CEA Days proposal', 'available'),
  };

  return {
    colleges: { cea, cat },
    orgs: { issc, cscCea, cscCat, jpice, psme },
    users: {
      officer,
      governor,
      outsider,
      issc: isscAccount,
      psme: psmeAccount,
      cscCat: cscCatAccount,
    },
    types: { proposal, report },
    docs,
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
