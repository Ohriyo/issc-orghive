import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from '../db';

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

describe('document visibility levels (approved documents)', () => {
  async function approvedWith(visibility: 'members' | 'private') {
    return createTestDocument(db, {
      organizationId: world.orgs.jpice.id,
      typeId: world.types.report.id,
      title: `JPICE ${visibility} report`,
      status: 'approved',
      createdById: world.users.officer.id,
      visibility,
    });
  }

  it('shows members-only documents to any signed-in user, not the public', async () => {
    const doc = await approvedWith('members');
    expect(await documents.findById(PUBLIC_VIEWER, doc.id)).toBeNull();
    expect(await documents.findById(userViewer(), doc.id)).not.toBeNull();
  });

  it('shows private documents only to the owning organization, its approvers and admins', async () => {
    const doc = await approvedWith('private');
    expect(await documents.findById(PUBLIC_VIEWER, doc.id)).toBeNull();
    expect(await documents.findById(userViewer(), doc.id)).toBeNull();
    expect(
      await documents.findById(userViewer({ memberOrgIds: [world.orgs.psme.id] }), doc.id),
    ).toBeNull();
    expect(
      await documents.findById(userViewer({ memberOrgIds: [world.orgs.jpice.id] }), doc.id),
    ).not.toBeNull();
    expect(
      await documents.findById(userViewer({ reviewableOrgIds: [world.orgs.jpice.id] }), doc.id),
    ).not.toBeNull();
    expect(await documents.findById(userViewer({ isAdmin: true }), doc.id)).not.toBeNull();
  });

  it('never widens access to unapproved documents, whatever their visibility', async () => {
    // jpiceDraft is public visibility but a draft.
    expect(await documents.findById(userViewer(), world.docs.jpiceDraft.id)).toBeNull();
    expect(
      await documents.findById(
        userViewer({ reviewableOrgIds: [world.orgs.jpice.id] }),
        world.docs.jpiceDraft.id,
      ),
    ).toBeNull();
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
    const added = await documents.addVersion(member(), world.docs.jpiceDraft.id, input);
    expect(added?.version).toBe(2);
    expect(
      await db.documentVersion.count({ where: { documentId: world.docs.jpiceDraft.id } }),
    ).toBe(2);
    // Not current until the worker finds it clean.
    const doc = await documents.findById(member(), world.docs.jpiceDraft.id);
    expect(doc?.currentVersion?.version).toBe(1);
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

  it('creates a metadata-only draft without a version', async () => {
    const created = await documents.create({
      organizationId: world.orgs.jpice.id,
      typeId: world.types.proposal.id,
      title: 'Metadata only',
      academicYear: '2026-2027',
      visibility: 'private',
      createdById: world.users.officer.id,
    });
    expect(created).toMatchObject({ status: 'draft', visibility: 'private', currentVersion: null });
  });

  it('updates metadata only while the document is in an allowed status', async () => {
    const id = world.docs.jpiceDraft.id;
    expect(await documents.update(PUBLIC_VIEWER, id, { title: 'X' }, ['draft'])).toBeNull();
    expect(await documents.update(member(), id, { title: 'Renamed' }, ['rejected'])).toBeNull();
    const updated = await documents.update(member(), id, { title: 'Renamed' }, ['draft']);
    expect(updated?.title).toBe('Renamed');
  });

  it('changes status only from the given statuses', async () => {
    const id = world.docs.jpiceApproved.id;
    expect(await documents.setStatus(member(), id, 'pending', { from: ['draft'] })).toBe(false);
    expect(await documents.setStatus(member(), id, 'archived', { from: ['approved'] })).toBe(true);
  });

  it('records a decision on the current version and moves a pending document once', async () => {
    const approver = userViewer({
      userId: world.users.governor.id,
      reviewableOrgIds: [world.orgs.jpice.id],
    });
    const id = world.docs.jpicePending.id;
    const input = { decision: 'approved' as const, approverId: world.users.governor.id };
    expect(await documents.decide(userViewer(), id, input)).toBe(false);
    expect(await documents.decide(approver, id, input)).toBe(true);
    expect(await documents.decide(approver, id, input)).toBe(false); // no longer pending

    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('approved');
    const approvals = await db.approval.findMany({ where: { documentId: id } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ versionId: doc.currentVersionId, decision: 'approved' });
  });

  it('resolves the owning organization, but not for deleted documents', async () => {
    expect(await documents.organizationOf(world.docs.jpiceDraft.id)).toEqual({
      id: world.orgs.jpice.id,
      slug: 'jpice',
    });
    expect(await documents.organizationOf(world.docs.jpiceDeleted.id)).toBeNull();
    expect(await documents.organizationOf(crypto.randomUUID())).toBeNull();
  });
});

describe('documentRepository processing', () => {
  const member = () => userViewer({ memberOrgIds: [world.orgs.jpice.id] });
  const NOW = new Date('2026-10-16T00:00:00Z');

  async function pendingVersion(documentId: string) {
    const added = await documents.addVersion(member(), documentId, {
      storageKey: `uploads/test/${crypto.randomUUID()}`,
      originalFilename: 'v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      uploadedById: world.users.officer.id,
    });
    return added!;
  }

  it('makes a clean re-upload current and sends the document back to review', async () => {
    const id = world.docs.jpiceApproved.id;
    const v2 = await pendingVersion(id);
    const result = await documents.markClean(
      v2.id,
      { sha256: 'a'.repeat(64), thumbnailKey: 'thumbnails/x.webp', contentText: 'girder words' },
      NOW,
    );
    expect(result).toEqual({ becameCurrent: true });
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({
      currentVersionId: v2.id,
      status: 'pending',
      contentText: 'girder words',
    });
    expect(await titles(member(), { search: 'girder' })).toEqual(['JPICE accomplishment report']);
  });

  it('refuses a re-upload without touching the document', async () => {
    const id = world.docs.jpiceApproved.id;
    const v2 = await pendingVersion(id);
    const result = await documents.markRefused(
      v2.id,
      { scanStatus: 'infected', reason: 'ClamAV: Eicar', quarantineKey: 'quarantine/x' },
      NOW,
    );
    expect(result).toEqual({ rejectedDocument: false });
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('approved');
    expect(doc.currentVersionId).not.toBe(v2.id);
    const version = await db.documentVersion.findUniqueOrThrow({ where: { id: v2.id } });
    expect(version).toMatchObject({ scanStatus: 'infected', storageKey: 'quarantine/x' });
  });

  it('rejects the document when its current version is refused', async () => {
    const doc = await db.document.findUniqueOrThrow({ where: { id: world.docs.jpicePending.id } });
    const result = await documents.markRefused(
      doc.currentVersionId!,
      {
        scanStatus: 'invalid',
        reason: 'Content is application/pdf',
        quarantineKey: 'quarantine/y',
      },
      NOW,
    );
    expect(result).toEqual({ rejectedDocument: true });
    expect((await db.document.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe(
      'rejected',
    );
  });

  it('only approves a pending document whose current file is clean', async () => {
    const id = world.docs.jpicePending.id;
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    await db.documentVersion.update({
      where: { id: doc.currentVersionId! },
      data: { scanStatus: 'pending' },
    });
    const approver = userViewer({ reviewableOrgIds: [world.orgs.jpice.id] });
    const input = { decision: 'approved' as const, approverId: world.users.governor.id };
    expect(await documents.decide(approver, id, input)).toBe(false);
  });

  it('lists versions newest first and finds stale pending ones', async () => {
    const id = world.docs.jpiceDraft.id;
    const v2 = await pendingVersion(id);
    const list = await documents.listVersions(member(), id);
    expect(list?.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(list?.organizationId).toBe(world.orgs.jpice.id);
    expect(await documents.listVersions(PUBLIC_VIEWER, id)).toBeNull();
    expect(await documents.findVersion(member(), id, v2.id)).toMatchObject({ version: 2 });
    expect(await documents.findVersion(PUBLIC_VIEWER, id, v2.id)).toBeNull();
    expect(await documents.findStalePending(new Date(Date.now() + 60_000))).toContain(v2.id);
  });
});
