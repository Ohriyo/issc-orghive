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
    TRUNCATE approvals, document_versions, documents, document_types, announcements,
      audit_logs, refresh_tokens, password_reset_tokens, memberships, users, organizations, colleges
    RESTART IDENTITY CASCADE`);
}

export const TERM_START = new Date('2026-08-01');
export const TERM_END = new Date('2027-07-31');

export interface TestDocumentInput {
  organizationId: string;
  typeId: string;
  title: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'archived';
  createdById: string;
  academicYear?: string;
  deleted?: boolean;
  /** Defaults to public, so status alone decides what the public sees. */
  visibility?: 'public' | 'members' | 'private';
}

/** A document with a clean version 1 as its current version. */
export async function createTestDocument(client: Db, input: TestDocumentInput) {
  const { deleted, visibility = 'public', academicYear = '2026-2027', ...data } = input;
  const created = await client.document.create({
    data: {
      ...data,
      academicYear,
      visibility,
      submittedAt: input.status === 'draft' ? null : new Date(),
      deletedAt: deleted ? new Date() : null,
    },
  });
  const version = await client.documentVersion.create({
    data: {
      documentId: created.id,
      version: 1,
      storageKey: `test/${created.id}.pdf`,
      originalFilename: `${created.id}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'x'.repeat(64),
      scanStatus: 'clean',
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
 * JPICE has one document in every status plus a deleted one; PSME and CSC-CEA have a few.
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

  const user = (email: string) =>
    client.user.create({ data: { email, name: email, passwordHash: 'x' } });
  const officer = await user('officer@test.local');
  const governor = await user('governor@test.local');
  const outsider = await user('outsider@test.local');

  await client.membership.create({
    data: {
      userId: officer.id,
      organizationId: jpice.id,
      role: 'officer',
      isHead: true,
      termStart: TERM_START,
      termEnd: TERM_END,
    },
  });
  await client.membership.create({
    data: {
      userId: governor.id,
      organizationId: cscCea.id,
      role: 'officer',
      isHead: true,
      title: 'Governor',
      termStart: TERM_START,
      termEnd: TERM_END,
    },
  });

  const proposal = await client.documentType.create({
    data: { slug: 'activity-proposal', name: 'Activity proposal' },
  });
  const report = await client.documentType.create({
    data: { slug: 'accomplishment-report', name: 'Accomplishment report' },
  });

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
      createdById: officer.id,
      ...extra,
    });

  const docs = {
    jpiceDraft: await doc(jpice.id, 'JPICE draft resolution', 'draft'),
    jpicePending: await doc(jpice.id, 'JPICE bridge competition proposal', 'pending'),
    jpiceApproved: await doc(jpice.id, 'JPICE accomplishment report', 'approved', {
      typeId: report.id,
      academicYear: '2025-2026',
    }),
    jpiceRejected: await doc(jpice.id, 'JPICE week narrative report', 'rejected', {
      typeId: report.id,
    }),
    jpiceArchived: await doc(jpice.id, 'JPICE archived proposal', 'archived'),
    jpiceDeleted: await doc(jpice.id, 'JPICE deleted bridge proposal', 'approved', {
      deleted: true,
    }),
    psmePending: await doc(psme.id, 'PSME plant visit proposal', 'pending'),
    psmeApproved: await doc(psme.id, 'PSME bridge seminar report', 'approved', {
      typeId: report.id,
    }),
    cscCeaPending: await doc(cscCea.id, 'CEA Days proposal', 'pending'),
  };

  return {
    colleges: { cea, cat },
    orgs: { issc, cscCea, cscCat, jpice, psme },
    users: { officer, governor, outsider },
    types: { proposal, report },
    docs,
  };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;
