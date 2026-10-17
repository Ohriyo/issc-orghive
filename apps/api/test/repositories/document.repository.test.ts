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
    officerOrgIds: [],
    ...overrides,
  };
}

/** An active member of the organization who is not an officer (an adviser, say). */
const memberOf = (orgId: string) => userViewer({ memberOrgIds: [orgId] });
/** An officer of the organization who did not upload the world's documents. */
const officerOf = (orgId: string) => userViewer({ memberOrgIds: [orgId], officerOrgIds: [orgId] });
/** JPICE's officer, who uploaded every JPICE document in the world. */
const uploader = () =>
  userViewer({
    userId: world.users.officer.id,
    memberOrgIds: [world.orgs.jpice.id],
    officerOrgIds: [world.orgs.jpice.id],
  });
const admin = () => userViewer({ isAdmin: true });

const PUBLIC_TITLES = [
  'CEA Days proposal',
  'JPICE accomplishment report',
  'PSME bridge seminar report',
];

async function titles(viewer: DocumentViewer, filters = {}) {
  const { items } = await documents.list(viewer, { limit: 100, ...filters });
  return items.map((d) => d.title).sort();
}

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

describe('document visibility (nothing is reviewed: visibility alone decides)', () => {
  it('shows the public only available, public, undeleted documents', async () => {
    expect(await titles(PUBLIC_VIEWER)).toEqual(PUBLIC_TITLES);
  });

  it('shows a signed-in user outside the organization the same as the public', async () => {
    expect(await titles(userViewer())).toEqual(PUBLIC_TITLES);
  });

  it('shows a member public and members-only files, not private or archived ones', async () => {
    expect(await titles(memberOf(world.orgs.jpice.id))).toEqual(
      [...PUBLIC_TITLES, 'JPICE bridge competition proposal'].sort(),
    );
  });

  it('shows an officer all three visibilities and the archive, but not others’ uploads in progress', async () => {
    expect(await titles(officerOf(world.orgs.jpice.id))).toEqual(
      [
        ...PUBLIC_TITLES,
        'JPICE archived proposal',
        'JPICE bridge competition proposal',
        'JPICE draft resolution',
      ].sort(),
    );
  });

  it('shows the uploader their own documents while scanning or quarantined', async () => {
    const seen = await titles(uploader());
    expect(seen).toContain('JPICE week narrative report');
    expect(seen).toContain('JPICE refused upload');
  });

  it('shows another organization’s officer only its public files', async () => {
    const seen = await titles(officerOf(world.orgs.psme.id));
    expect(seen).toEqual([...PUBLIC_TITLES, 'PSME plant visit proposal'].sort());
  });

  it('shows admins every available or archived document, but not uploads in progress', async () => {
    const seen = await titles(admin());
    expect(seen).toHaveLength(7);
    expect(seen).toContain('JPICE draft resolution');
    expect(seen).toContain('JPICE archived proposal');
    expect(seen).not.toContain('JPICE week narrative report');
    expect(seen).not.toContain('JPICE refused upload');
    expect(seen).not.toContain('JPICE deleted bridge proposal');
  });

  it('hides documents of a deleted organization, even from admins', async () => {
    await db.organization.update({
      where: { id: world.orgs.psme.id },
      data: { deletedAt: new Date() },
    });
    expect(await titles(admin())).not.toContain('PSME bridge seminar report');
  });

  it('returns null from findById for a document the viewer may not see', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.findById(PUBLIC_VIEWER, id)).toBeNull();
    expect(await documents.findById(memberOf(world.orgs.jpice.id), id)).toBeNull();
    const own = await documents.findById(officerOf(world.orgs.jpice.id), id);
    expect(own?.title).toBe('JPICE draft resolution');
    expect(own?.currentVersion?.version).toBe(1);
  });

  it('tells when an admin sees a document only because they are an admin', async () => {
    const { jpicePrivate, jpicePublic, jpiceArchived } = world.docs;
    expect(await documents.visibleOnlyAsAdmin(admin(), jpicePrivate.id)).toBe(true);
    expect(await documents.visibleOnlyAsAdmin(admin(), jpiceArchived.id)).toBe(true);
    expect(await documents.visibleOnlyAsAdmin(admin(), jpicePublic.id)).toBe(false);
    const adminAndOfficer = userViewer({
      isAdmin: true,
      memberOrgIds: [world.orgs.jpice.id],
      officerOrgIds: [world.orgs.jpice.id],
    });
    expect(await documents.visibleOnlyAsAdmin(adminAndOfficer, jpicePrivate.id)).toBe(false);
    expect(
      await documents.visibleOnlyAsAdmin(officerOf(world.orgs.jpice.id), jpicePrivate.id),
    ).toBe(false);
  });
});

describe('documentRepository.list', () => {
  it('filters by organization, type, academic year, status and visibility', async () => {
    expect(await titles(admin(), { organizationId: world.orgs.psme.id })).toEqual([
      'PSME bridge seminar report',
      'PSME plant visit proposal',
    ]);
    expect(
      await titles(admin(), { typeId: world.types.report.id, academicYear: '2025-2026' }),
    ).toEqual(['JPICE accomplishment report']);
    expect(await titles(admin(), { visibility: 'private' })).toEqual([
      'JPICE draft resolution',
      'PSME plant visit proposal',
    ]);
    expect(await titles(uploader(), { status: 'quarantined' })).toEqual(['JPICE refused upload']);
  });

  it('pages newest first with a cursor', async () => {
    const first = await documents.list(admin(), { limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    const second = await documents.list(admin(), { limit: 5, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((d) => d.id);
    expect(new Set(all).size).toBe(7);
    expect(all).toEqual([...all].sort().reverse());
  });

  it('searches titles and still applies the visibility filter', async () => {
    expect(await titles(PUBLIC_VIEWER, { search: 'bridge' })).toEqual([
      'PSME bridge seminar report',
    ]);
    expect(await titles(memberOf(world.orgs.jpice.id), { search: 'bridge' })).toEqual([
      'JPICE bridge competition proposal',
      'PSME bridge seminar report',
    ]);
    expect(await titles(PUBLIC_VIEWER, { search: 'nonexistentword' })).toEqual([]);
  });
});

describe('documentRepository writes', () => {
  const officer = () => officerOf(world.orgs.jpice.id);
  const file = (name: string) => ({
    storageKey: `test/${name}-${crypto.randomUUID()}.pdf`,
    originalFilename: `${name}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 20,
    uploadedById: world.users.officer.id,
  });

  it('creates a scanning document with version 1 as its current version', async () => {
    const created = await documents.create({
      organizationId: world.orgs.jpice.id,
      typeId: world.types.proposal.id,
      title: 'New proposal',
      academicYear: '2026-2027',
      createdById: world.users.officer.id,
      firstVersion: { ...file('new'), sha256: 'y'.repeat(64) },
    });
    expect(created).toMatchObject({ status: 'scanning', visibility: 'public' });
    expect(created.currentVersion).toMatchObject({ version: 1, scanStatus: 'pending' });
  });

  it('adds a new version instead of overwriting, only for viewers who can see it', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.addVersion(PUBLIC_VIEWER, id, file('v2'))).toBeNull();
    const added = await documents.addVersion(officer(), id, file('v2'));
    expect(added?.version).toBe(2);
    expect(await db.documentVersion.count({ where: { documentId: id } })).toBe(2);
    // Not current until the worker finds it clean; the document stays available meanwhile.
    const doc = await documents.findById(officer(), id);
    expect(doc).toMatchObject({ status: 'available', currentVersion: { version: 1 } });
  });

  it('adds no version to an archived document', async () => {
    expect(await documents.addVersion(officer(), world.docs.jpiceArchived.id, file('v2'))).toBe(
      null,
    );
  });

  it('scans a quarantined document again when a new file is uploaded', async () => {
    const id = world.docs.jpiceQuarantined.id;
    expect(await documents.addVersion(uploader(), id, file('again'))).toMatchObject({ version: 2 });
    expect((await db.document.findUniqueOrThrow({ where: { id } })).status).toBe('scanning');
  });

  // The repository only filters what the viewer can see; who may write is the route guard's job.
  it('soft-deletes so the document disappears for everyone', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.softDelete(PUBLIC_VIEWER, id)).toBe(false);
    expect(await documents.softDelete(officer(), id)).toBe(true);
    expect(await documents.findById(admin(), id)).toBeNull();
    expect(await db.document.count({ where: { id } })).toBe(1);
  });

  it('updates details of a visible document that is not archived', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.update(PUBLIC_VIEWER, id, { title: 'X' })).toBeNull();
    expect(await documents.update(memberOf(world.orgs.jpice.id), id, { title: 'X' })).toBeNull();
    expect((await documents.update(officer(), id, { title: 'Renamed' }))?.title).toBe('Renamed');
    expect(
      await documents.update(officer(), world.docs.jpiceArchived.id, { title: 'Late edit' }),
    ).toBeNull();
  });

  it('changes visibility of any visible document, archived included', async () => {
    const id = world.docs.jpicePublic.id;
    expect(await documents.setVisibility(PUBLIC_VIEWER, id, 'private')).toBeNull();
    expect((await documents.setVisibility(officer(), id, 'private'))?.visibility).toBe('private');
    expect(await documents.findById(PUBLIC_VIEWER, id)).toBeNull();
    const archived = await documents.setVisibility(
      officer(),
      world.docs.jpiceArchived.id,
      'members',
    );
    expect(archived).toMatchObject({ status: 'archived', visibility: 'members' });
  });

  it('archives only available documents and restores only archived ones', async () => {
    const id = world.docs.jpicePublic.id;
    expect(await documents.restore(officer(), id)).toBe(false);
    expect(await documents.archive(PUBLIC_VIEWER, world.docs.jpicePrivate.id)).toBe(false);
    expect(await documents.archive(officer(), id)).toBe(true);
    expect(await documents.archive(officer(), id)).toBe(false);
    expect(await documents.findById(PUBLIC_VIEWER, id)).toBeNull();
    expect(await documents.restore(PUBLIC_VIEWER, id)).toBe(false);
    expect(await documents.restore(officer(), id)).toBe(true);
    expect(await documents.findById(PUBLIC_VIEWER, id)).toMatchObject({ status: 'available' });
    expect(await documents.archive(uploader(), world.docs.jpiceQuarantined.id)).toBe(false);
  });

  it('resolves the owning organization, but not for deleted documents', async () => {
    expect(await documents.organizationOf(world.docs.jpicePrivate.id)).toEqual({
      id: world.orgs.jpice.id,
      slug: 'jpice',
    });
    expect(await documents.organizationOf(world.docs.jpiceDeleted.id)).toBeNull();
    expect(await documents.organizationOf(crypto.randomUUID())).toBeNull();
  });
});

describe('documentRepository processing', () => {
  const NOW = new Date('2026-10-16T00:00:00Z');
  const clean = { sha256: 'a'.repeat(64), thumbnailKey: null, contentText: null };

  async function pendingVersion(documentId: string, viewer = uploader()) {
    const added = await documents.addVersion(viewer, documentId, {
      storageKey: `uploads/test/${crypto.randomUUID()}`,
      originalFilename: 'v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      uploadedById: viewer.kind === 'user' ? viewer.userId : '',
    });
    return added!;
  }

  const statusOf = async (id: string) =>
    (await db.document.findUniqueOrThrow({ where: { id } })).status;

  it('makes a scanning document available once its file is clean, with no review', async () => {
    const doc = await db.document.findUniqueOrThrow({ where: { id: world.docs.jpiceScanning.id } });
    expect(await documents.markClean(doc.currentVersionId!, clean, NOW)).toEqual({
      becameCurrent: false,
    });
    expect(await statusOf(doc.id)).toBe('available');
    expect(await titles(PUBLIC_VIEWER)).toContain('JPICE week narrative report');
  });

  it('makes a clean re-upload current and keeps the document available', async () => {
    const id = world.docs.jpicePublic.id;
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
      status: 'available',
      contentText: 'girder words',
    });
    expect(await titles(PUBLIC_VIEWER, { search: 'girder' })).toEqual([
      'JPICE accomplishment report',
    ]);
  });

  it('keeps a newer clean version current when an older one finishes later', async () => {
    const id = world.docs.jpicePublic.id;
    const v2 = await pendingVersion(id);
    const v3 = await pendingVersion(id);
    await documents.markClean(v3.id, clean, NOW);
    expect(await documents.markClean(v2.id, clean, NOW)).toEqual({ becameCurrent: false });
    expect((await db.document.findUniqueOrThrow({ where: { id } })).currentVersionId).toBe(v3.id);
  });

  it('refuses a re-upload of an available document without touching it', async () => {
    const id = world.docs.jpicePublic.id;
    const v2 = await pendingVersion(id);
    const result = await documents.markRefused(
      v2.id,
      { scanStatus: 'infected', reason: 'ClamAV: Eicar', quarantineKey: 'quarantine/x' },
      NOW,
    );
    expect(result).toEqual({ quarantinedDocument: false });
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('available');
    expect(doc.currentVersionId).not.toBe(v2.id);
    const version = await db.documentVersion.findUniqueOrThrow({ where: { id: v2.id } });
    expect(version).toMatchObject({ scanStatus: 'infected', storageKey: 'quarantine/x' });
  });

  it('quarantines a document whose first file is refused', async () => {
    const doc = await db.document.findUniqueOrThrow({ where: { id: world.docs.jpiceScanning.id } });
    const result = await documents.markRefused(
      doc.currentVersionId!,
      { scanStatus: 'invalid', reason: 'Content is text/plain', quarantineKey: 'quarantine/y' },
      NOW,
    );
    expect(result).toEqual({ quarantinedDocument: true });
    expect(await statusOf(doc.id)).toBe('quarantined');
  });

  it('makes a quarantined document available when a clean file replaces the refused one', async () => {
    const id = world.docs.jpiceQuarantined.id;
    const v2 = await pendingVersion(id);
    expect(await documents.markClean(v2.id, clean, NOW)).toEqual({ becameCurrent: true });
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'available', currentVersionId: v2.id });
  });

  it('lists only clean versions, plus the viewer’s own uploads in progress', async () => {
    const id = world.docs.jpicePrivate.id;
    const v2 = await pendingVersion(id);
    const mine = await documents.listVersions(uploader(), id);
    expect(mine?.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(mine).toMatchObject({ organizationId: world.orgs.jpice.id, visibility: 'private' });
    const otherOfficer = await documents.listVersions(officerOf(world.orgs.jpice.id), id);
    expect(otherOfficer?.versions.map((v) => v.version)).toEqual([1]);
    expect(await documents.listVersions(PUBLIC_VIEWER, id)).toBeNull();

    expect(await documents.findVersion(uploader(), id, v2.id)).toMatchObject({ version: 2 });
    expect(await documents.findVersion(officerOf(world.orgs.jpice.id), id, v2.id)).toBeNull();
    expect(await documents.findStalePending(new Date(Date.now() + 60_000))).toContain(v2.id);
  });
});
