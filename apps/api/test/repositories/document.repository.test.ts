import { beforeEach, describe, expect, it } from 'vitest';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { PUBLIC_VIEWER, type DocumentViewer } from '#src/repositories/document-visibility';
import { SNIPPET_MATCH_END, SNIPPET_MATCH_START } from '@orghive/shared';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from '../db';

const db = testDb();
const documents = createDocumentRepository(db);
let world: World;

/** The shared account of an organization, as the viewer service builds it. */
function accountOf(user: { id: string }, org: { id: string; type: 'ISSC' | 'CSC' | 'SBO' }) {
  return {
    kind: 'account',
    userId: user.id,
    organizationId: org.id,
    organizationType: org.type,
  } satisfies DocumentViewer;
}

/** JPICE's account, which uploaded every JPICE document in the world. */
const jpice = () => accountOf(world.users.officer, world.orgs.jpice);
/** A sibling SBO in the same college. */
const psme = () => accountOf(world.users.psme, world.orgs.psme);
/** JPICE's governing CSC. */
const cscCea = () => accountOf(world.users.governor, world.orgs.cscCea);
/** Another college's CSC: governs nothing of JPICE. */
const cscCat = () => accountOf(world.users.cscCat, world.orgs.cscCat);
const issc = () => accountOf(world.users.issc, world.orgs.issc);

const PUBLIC_TITLES = [
  'CEA Days proposal',
  'JPICE accomplishment report',
  'PSME bridge seminar report',
];
const JPICE_GOVERNING = 'JPICE bridge competition proposal';
const JPICE_PRIVATE = 'JPICE draft resolution';

async function titles(viewer: DocumentViewer, filters = {}) {
  const { items } = await documents.list(viewer, { limit: 100, ...filters });
  return items.map((d) => d.title).sort();
}

beforeEach(async () => {
  await resetDb(db);
  world = await buildWorld(db);
});

describe('document visibility: public, governing bodies, private (docs/DOMAIN_RULES.md)', () => {
  it(
    'shows the public, and the super admin, only available public documents',
    { timeout: 15_000 },
    async () => {
      // The super admin and accounts acting for no organization are public viewers.
      expect(await titles(PUBLIC_VIEWER)).toEqual(PUBLIC_TITLES);
    },
  );

  it('shows the organization its own documents at every level and in every state', async () => {
    expect(await titles(jpice())).toEqual(
      [
        ...PUBLIC_TITLES,
        JPICE_GOVERNING,
        JPICE_PRIVATE,
        'JPICE archived proposal',
        'JPICE refused upload',
        'JPICE week narrative report',
      ].sort(),
    );
  });

  it('shows its college CSC and the ISSC the governing file, never the private one', async () => {
    for (const viewer of [cscCea(), issc()]) {
      expect(await titles(viewer)).toEqual([...PUBLIC_TITLES, JPICE_GOVERNING].sort());
    }
  });

  it('shows a sibling SBO and another college CSC only the public files', async () => {
    expect(await titles(psme())).toEqual([...PUBLIC_TITLES, 'PSME plant visit proposal'].sort());
    expect(await titles(cscCat())).toEqual(PUBLIC_TITLES);
  });

  it('keeps archived, scanning and quarantined files with the organization only', async () => {
    for (const viewer of [cscCea(), issc(), psme(), PUBLIC_VIEWER]) {
      const seen = await titles(viewer);
      expect(seen).not.toContain('JPICE archived proposal');
      expect(seen).not.toContain('JPICE week narrative report');
      expect(seen).not.toContain('JPICE refused upload');
    }
  });

  it('shows a governing file to its governing bodies only once it is available', async () => {
    await db.document.update({
      where: { id: world.docs.jpiceGoverning.id },
      data: { status: 'archived' },
    });
    expect(await titles(cscCea())).not.toContain(JPICE_GOVERNING);
    expect(await titles(issc())).not.toContain(JPICE_GOVERNING);
  });

  it('never shows a deleted document or a deleted organization’s documents', async () => {
    expect(await titles(jpice())).not.toContain('JPICE deleted bridge proposal');
    await db.organization.update({
      where: { id: world.orgs.psme.id },
      data: { deletedAt: new Date() },
    });
    expect(await titles(issc())).not.toContain('PSME bridge seminar report');
  });

  it('returns null from findById for a document the viewer may not see', async () => {
    const id = world.docs.jpicePrivate.id;
    for (const viewer of [PUBLIC_VIEWER, cscCea(), issc(), psme()]) {
      expect(await documents.findById(viewer, id)).toBeNull();
    }
    const own = await documents.findById(jpice(), id);
    expect(own?.title).toBe(JPICE_PRIVATE);
    expect(own?.currentVersion?.version).toBe(1);
    expect((await documents.findById(cscCea(), world.docs.jpiceGoverning.id))?.title).toBe(
      JPICE_GOVERNING,
    );
  });
});

describe('documentRepository.list', () => {
  it('filters by organization, type, academic year, status and visibility', async () => {
    expect(await titles(psme(), { organizationId: world.orgs.psme.id })).toEqual([
      'PSME bridge seminar report',
      'PSME plant visit proposal',
    ]);
    expect(
      await titles(jpice(), { typeId: world.types.report.id, academicYear: '2025-2026' }),
    ).toEqual(['JPICE accomplishment report']);
    expect(await titles(jpice(), { visibility: 'private' })).toEqual([JPICE_PRIVATE]);
    expect(await titles(jpice(), { status: 'quarantined' })).toEqual(['JPICE refused upload']);
  });

  it('pages newest first with a cursor', async () => {
    const first = await documents.list(jpice(), { limit: 5 });
    expect(first.items).toHaveLength(5);
    expect(first.nextCursor).not.toBeNull();
    const second = await documents.list(jpice(), { limit: 5, cursor: first.nextCursor! });
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
    expect(await titles(cscCea(), { search: 'bridge' })).toEqual([
      'JPICE bridge competition proposal',
      'PSME bridge seminar report',
    ]);
    expect(await titles(PUBLIC_VIEWER, { search: 'nonexistentword' })).toEqual([]);
  });
});

describe('documentRepository writes', () => {
  const officer = jpice;
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
    expect(await documents.addVersion(jpice(), id, file('again'))).toMatchObject({ version: 2 });
    expect((await db.document.findUniqueOrThrow({ where: { id } })).status).toBe('scanning');
  });

  // The repository only filters what the viewer can see; who may write is the route guard's job.
  it('soft-deletes so the document disappears for everyone', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.softDelete(PUBLIC_VIEWER, id)).toBe(false);
    expect(await documents.softDelete(officer(), id)).toBe(true);
    expect(await documents.findById(jpice(), id)).toBeNull();
    expect(await db.document.count({ where: { id } })).toBe(1);
  });

  it('updates details of a visible document that is not archived', async () => {
    const id = world.docs.jpicePrivate.id;
    expect(await documents.update(PUBLIC_VIEWER, id, { title: 'X' })).toBeNull();
    expect(await documents.update(cscCea(), id, { title: 'X' })).toBeNull();
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
      'governing',
    );
    expect(archived).toMatchObject({ status: 'archived', visibility: 'governing' });
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
    expect(await documents.archive(jpice(), world.docs.jpiceQuarantined.id)).toBe(false);
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
  /** A clean verdict; each version's scanned copy has its own key (storage keys are unique). */
  const clean = (versionId: string) => ({
    storageKey: `files/test/${versionId}`,
    sha256: 'a'.repeat(64),
    thumbnailKey: null,
    contentText: null,
  });

  async function pendingVersion(documentId: string) {
    const viewer = jpice();
    const added = await documents.addVersion(viewer, documentId, {
      storageKey: `uploads/test/${crypto.randomUUID()}`,
      originalFilename: 'v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 20,
      uploadedById: viewer.userId,
    });
    return added!;
  }

  const statusOf = async (id: string) =>
    (await db.document.findUniqueOrThrow({ where: { id } })).status;

  it('makes a scanning document available once its file is clean, with no review', async () => {
    const doc = await db.document.findUniqueOrThrow({ where: { id: world.docs.jpiceScanning.id } });
    expect(
      await documents.markClean(doc.currentVersionId!, clean(doc.currentVersionId!), NOW),
    ).toEqual({
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
      {
        storageKey: `files/test/${v2.id}`,
        sha256: 'a'.repeat(64),
        thumbnailKey: 'thumbnails/x.webp',
        contentText: 'girder words',
      },
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
    await documents.markClean(v3.id, clean(v3.id), NOW);
    expect(await documents.markClean(v2.id, clean(v2.id), NOW)).toEqual({ becameCurrent: false });
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
    expect(await documents.markClean(v2.id, clean(v2.id), NOW)).toEqual({ becameCurrent: true });
    const doc = await db.document.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ status: 'available', currentVersionId: v2.id });
  });

  it('lists only clean versions, plus the organization’s own uploads in progress', async () => {
    const id = world.docs.jpiceGoverning.id;
    const v2 = await pendingVersion(id);
    const mine = await documents.listVersions(jpice(), id);
    expect(mine?.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(mine).toMatchObject({ organizationId: world.orgs.jpice.id, visibility: 'governing' });
    const governing = await documents.listVersions(cscCea(), id);
    expect(governing?.versions.map((v) => v.version)).toEqual([1]);
    expect(await documents.listVersions(PUBLIC_VIEWER, id)).toBeNull();

    expect(await documents.findVersion(jpice(), id, v2.id)).toMatchObject({ version: 2 });
    expect(await documents.findVersion(cscCea(), id, v2.id)).toBeNull();
    expect(await documents.findStalePending(new Date(Date.now() + 60_000))).toContain(v2.id);
  });
});

describe('documentRepository.search', () => {
  const search = (viewer: DocumentViewer, query: string, extra = {}) =>
    documents.search(viewer, { query, offset: 0, limit: 20, ...extra });
  const titlesOf = (result: Awaited<ReturnType<typeof search>>) => result.items.map((d) => d.title);

  it('finds words only inside the file text and marks them in the headline', async () => {
    await db.document.update({
      where: { id: world.docs.psmePublic.id },
      data: { contentText: 'Attendees inspected the gusset plates of the old truss.' },
    });
    const result = await search(PUBLIC_VIEWER, 'gusset');
    expect(titlesOf(result)).toEqual(['PSME bridge seminar report']);
    expect(result.items[0]!.headline).toContain(`${SNIPPET_MATCH_START}gusset${SNIPPET_MATCH_END}`);
  });

  it('ranks a title match above tags, and tags above file text', async () => {
    await db.document.update({
      where: { id: world.docs.cscCeaPublic.id },
      data: { contentText: 'a seminar on surveying' },
    });
    await db.document.update({
      where: { id: world.docs.jpicePublic.id },
      data: { tags: ['seminar'] },
    });
    expect(titlesOf(await search(PUBLIC_VIEWER, 'seminar'))).toEqual([
      'PSME bridge seminar report',
      'JPICE accomplishment report',
      'CEA Days proposal',
    ]);
  });

  it('applies the visibility filter and leaves out archived and unscanned files', async () => {
    expect(titlesOf(await search(PUBLIC_VIEWER, 'bridge'))).toEqual(['PSME bridge seminar report']);
    expect(titlesOf(await search(cscCea(), 'bridge')).sort()).toEqual([
      'JPICE bridge competition proposal',
      'PSME bridge seminar report',
    ]);
    // The organization sees these in its dashboard, not in search.
    expect(titlesOf(await search(jpice(), 'narrative'))).toEqual([]);
    expect(titlesOf(await search(jpice(), 'archived'))).toEqual([]);
  });

  it('never builds a headline from a document the viewer cannot see', async () => {
    await db.document.update({
      where: { id: world.docs.jpicePrivate.id },
      data: { contentText: 'confidential budget figures' },
    });
    expect((await search(PUBLIC_VIEWER, 'confidential')).items).toEqual([]);
  });

  it('filters by college, organization, type slug and academic year', async () => {
    const catOrg = await db.organization.create({
      data: {
        type: 'SBO',
        slug: 'cat-sbo',
        acronym: 'CATS',
        name: 'CAT SBO',
        parentId: world.orgs.cscCat.id,
        collegeId: world.colleges.cat.id,
      },
    });
    await createTestDocument(db, {
      organizationId: catOrg.id,
      typeId: world.types.proposal.id,
      title: 'CAT bridge proposal',
      status: 'available',
      createdById: world.users.officer.id,
    });
    expect(titlesOf(await search(PUBLIC_VIEWER, 'bridge', { collegeSlug: 'cat' }))).toEqual([
      'CAT bridge proposal',
    ]);
    expect(titlesOf(await search(PUBLIC_VIEWER, 'bridge', { collegeSlug: 'cea' }))).toEqual([
      'PSME bridge seminar report',
    ]);
    expect(
      titlesOf(await search(PUBLIC_VIEWER, 'bridge', { organizationSlug: 'cat-sbo' })),
    ).toEqual(['CAT bridge proposal']);
    expect(
      titlesOf(await search(PUBLIC_VIEWER, 'bridge', { typeSlug: 'accomplishment-report' })),
    ).toEqual(['PSME bridge seminar report']);
    expect(titlesOf(await search(PUBLIC_VIEWER, 'report', { academicYear: '2025-2026' }))).toEqual([
      'JPICE accomplishment report',
    ]);
  });

  it('pages through ranked results', async () => {
    const first = await search(issc(), 'proposal', { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await search(issc(), 'proposal', { offset: 1, limit: 1 });
    expect(second.items.map((d) => d.id)).not.toContain(first.items[0]!.id);
  });

  it('finds an organization-scoped Paperworks search beyond other organizations', async () => {
    expect(
      await titles(PUBLIC_VIEWER, { search: 'proposal', organizationId: world.orgs.cscCea.id }),
    ).toEqual(['CEA Days proposal']);
  });
});
