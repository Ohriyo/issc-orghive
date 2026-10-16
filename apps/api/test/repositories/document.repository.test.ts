import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { buildWorld, resetDb, testDb, type World } from '../db';

const db = testDb();
const documents = createDocumentRepository(db);
let world: World;

function userViewer(
  overrides: Partial<Extract<DocumentViewer, { kind: 'user' }>> = {},
): DocumentViewer {
  return {
    kind: 'user',
    userId: world.users.outsider.id,
    isAdmin: false,
    memberOrgIds: [],
    reviewableOrgIds: [],
    ...overrides,
  };
}

async function titles(viewer: DocumentViewer, filters = {}) {
  const { items } = await documents.list(viewer, { limit: 100, ...filters });
  return items.map((d) => d.title).sort();
}

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

describe('document visibility', () => {
  it('shows the public only approved, undeleted documents', async () => {
    expect(await titles(PUBLIC_VIEWER)).toEqual([
      'JPICE accomplishment report',
      'PSME bridge seminar report',
    ]);
  });

  it('shows a signed-in non-member the same as the public', async () => {
    expect(await titles(userViewer())).toEqual(await titles(PUBLIC_VIEWER));
  });

  it("shows members every status of their own organization, but only others' approved ones", async () => {
    const viewer = userViewer({ memberOrgIds: [world.orgs.jpice.id] });
    expect(await titles(viewer)).toEqual([
      'JPICE accomplishment report',
      'JPICE archived proposal',
      'JPICE bridge competition proposal',
      'JPICE draft resolution',
      'JPICE week narrative report',
      'PSME bridge seminar report',
    ]);
  });

  it('shows approvers the pending documents they review, not drafts or rejections', async () => {
    const viewer = userViewer({
      userId: world.users.governor.id,
      memberOrgIds: [world.orgs.cscCea.id],
      reviewableOrgIds: [world.orgs.jpice.id, world.orgs.psme.id],
    });
    const seen = await titles(viewer);
    expect(seen).toContain('JPICE bridge competition proposal');
    expect(seen).toContain('PSME plant visit proposal');
    expect(seen).toContain('CEA Days proposal'); // own organization
    expect(seen).not.toContain('JPICE draft resolution');
    expect(seen).not.toContain('JPICE week narrative report');
  });

  it('shows admins everything except deleted documents', async () => {
    const seen = await titles(userViewer({ isAdmin: true }));
    expect(seen).toHaveLength(8);
    expect(seen).not.toContain('JPICE deleted bridge proposal');
  });

  it('hides documents of a deleted organization, even from admins', async () => {
    await db.organization.update({
      where: { id: world.orgs.psme.id },
      data: { deletedAt: new Date() },
    });
    expect(await titles(userViewer({ isAdmin: true }))).not.toContain('PSME bridge seminar report');
  });

  it('returns null from findById for a document the viewer may not see', async () => {
    expect(await documents.findById(PUBLIC_VIEWER, world.docs.jpiceDraft.id)).toBeNull();
    const own = await documents.findById(
      userViewer({ memberOrgIds: [world.orgs.jpice.id] }),
      world.docs.jpiceDraft.id,
    );
    expect(own?.title).toBe('JPICE draft resolution');
    expect(own?.currentVersion?.version).toBe(1);
  });
});

describe('documentRepository.list', () => {
  it('filters by organization, type and academic year', async () => {
    const admin = userViewer({ isAdmin: true });
    expect(await titles(admin, { organizationId: world.orgs.psme.id })).toEqual([
      'PSME bridge seminar report',
      'PSME plant visit proposal',
    ]);
    expect(
      await titles(admin, { typeId: world.types.report.id, academicYear: '2025-2026' }),
    ).toEqual(['JPICE accomplishment report']);
  });

  it('pages newest first with a cursor', async () => {
    const admin = userViewer({ isAdmin: true });
    const first = await documents.list(admin, { limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    const second = await documents.list(admin, { limit: 5, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((d) => d.id);
    expect(new Set(all).size).toBe(8);
    expect(all).toEqual([...all].sort().reverse());
  });

  it('searches titles and still applies the visibility filter', async () => {
    expect(await titles(PUBLIC_VIEWER, { search: 'bridge' })).toEqual([
      'PSME bridge seminar report',
    ]);
    expect(
      await titles(userViewer({ memberOrgIds: [world.orgs.jpice.id] }), { search: 'bridge' }),
    ).toEqual(['JPICE bridge competition proposal', 'PSME bridge seminar report']);
    expect(await titles(PUBLIC_VIEWER, { search: 'nonexistentword' })).toEqual([]);
  });
});

describe('documentRepository writes', () => {
  const member = () => userViewer({ memberOrgIds: [world.orgs.jpice.id] });

  it('creates a document with version 1 as its current version', async () => {
    const created = await documents.create({
      organizationId: world.orgs.jpice.id,
      typeId: world.types.proposal.id,
      title: 'New proposal',
      academicYear: '2026-2027',
      createdById: world.users.officer.id,
      firstVersion: {
        storageKey: 'test/new.pdf',
        originalFilename: 'new.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'y'.repeat(64),
        uploadedById: world.users.officer.id,
      },
    });
    expect(created.status).toBe('draft');
    expect(created.currentVersion).toMatchObject({ version: 1, scanStatus: 'pending' });
  });

  it('adds a new version instead of overwriting, only for viewers who can see it', async () => {
    const input = {
      storageKey: 'test/v2.pdf',
      originalFilename: 'v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      sha256: 'z'.repeat(64),
      uploadedById: world.users.officer.id,
    };
    expect(await documents.addVersion(PUBLIC_VIEWER, world.docs.jpiceDraft.id, input)).toBeNull();
    const updated = await documents.addVersion(member(), world.docs.jpiceDraft.id, input);
    expect(updated?.currentVersion?.version).toBe(2);
    expect(
      await db.documentVersion.count({ where: { documentId: world.docs.jpiceDraft.id } }),
    ).toBe(2);
  });

  it('changes status only on visible documents', async () => {
    expect(await documents.setStatus(PUBLIC_VIEWER, world.docs.jpiceDraft.id, 'pending')).toBe(
      false,
    );
    expect(await documents.setStatus(member(), world.docs.jpiceDraft.id, 'pending')).toBe(true);
    const doc = await db.document.findUniqueOrThrow({ where: { id: world.docs.jpiceDraft.id } });
    expect(doc.status).toBe('pending');
    expect(doc.submittedAt).not.toBeNull();
  });

  it('soft-deletes so the document disappears for everyone', async () => {
    expect(await documents.softDelete(PUBLIC_VIEWER, world.docs.jpiceDraft.id)).toBe(false);
    expect(await documents.softDelete(member(), world.docs.jpiceApproved.id)).toBe(true);
    expect(
      await documents.findById(userViewer({ isAdmin: true }), world.docs.jpiceApproved.id),
    ).toBeNull();
    expect(await db.document.count({ where: { id: world.docs.jpiceApproved.id } })).toBe(1);
  });
});
