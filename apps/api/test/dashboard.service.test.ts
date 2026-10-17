import { describe, expect, it, vi } from 'vitest';
import { createPublicUrl } from '#src/lib/public-url';
import type { DocumentRecord } from '#src/repositories/document.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { MembershipDetail } from '#src/repositories/membership.repository';
import { createDashboardService } from '#src/services/dashboard.service';

const JPICE = {
  id: '0195f3c0-0000-7000-8000-0000000000a1',
  type: 'SBO' as const,
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  logoKey: 'logos/jpice-ab12.webp',
  logoWidths: [128, 256],
};
const AT = new Date('2026-10-01T00:00:00Z');

function membership(overrides: Partial<MembershipDetail> = {}): MembershipDetail {
  return {
    id: 'm1',
    role: 'officer',
    isHead: true,
    title: 'President',
    termEnd: new Date('2027-07-31T00:00:00Z'),
    organization: JPICE,
    ...overrides,
  };
}

function doc(
  id: string,
  thumbnailKey: string | null = null,
  status: DocumentRecord['status'] = 'available',
): DocumentRecord {
  return {
    id,
    title: `Doc ${id}`,
    description: null,
    academicYear: '2026-2027',
    semester: null,
    status,
    visibility: 'members',
    tags: [],
    createdAt: AT,
    updatedAt: AT,
    organization: { id: JPICE.id, slug: 'jpice', acronym: 'JPICE', name: JPICE.name, type: 'SBO' },
    type: { id: 't1', slug: 'report', name: 'Report' },
    currentVersion: {
      id: `${id}-v1`,
      version: 1,
      originalFilename: 'r.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      scanStatus: 'clean',
      thumbnailKey,
      createdAt: AT,
    },
  };
}

function setup({ memberships = [membership()], isAdmin = false } = {}) {
  const orgIds = memberships.map((m) => m.organization.id);
  const viewer: DocumentViewer = {
    kind: 'user',
    userId: 'u1',
    isAdmin,
    memberOrgIds: orgIds,
    officerOrgIds: orgIds,
  };
  const repo = {
    countForDashboard: vi.fn(() =>
      Promise.resolve(new Map([[JPICE.id, { public: 2, private: 1, quarantined: 1 }]])),
    ),
    listQuarantined: vi.fn(() => Promise.resolve([doc('q1', null, 'quarantined')])),
    listActivity: vi.fn(() =>
      Promise.resolve([
        {
          id: '0195f3c0-0000-7000-8000-0000000000b1',
          action: 'visibility_change' as const,
          createdAt: AT,
          actorName: 'Maria Santos',
          document: { id: 'd1', title: 'Doc d1' },
          version: null,
        },
      ]),
    ),
  };
  const documents = {
    list: vi.fn(() => Promise.resolve({ items: [doc('d1', 'thumbs/d1.webp')], nextCursor: null })),
  };
  const storage = {
    presignGet: vi.fn((key: string) => Promise.resolve(`https://storage.test/${key}?signed`)),
  };
  const service = createDashboardService({
    memberships: { findActiveDetailsForUser: vi.fn(() => Promise.resolve(memberships)) },
    dashboard: repo,
    documents,
    viewers: { forUser: () => Promise.resolve(viewer) },
    storage,
    publicUrl: createPublicUrl('https://cdn.test'),
  });
  return { service, repo, documents, viewer };
}

describe('dashboardService.forUser', () => {
  it('builds each organization from the repositories, through the viewer', async () => {
    const { service, repo, documents, viewer } = setup();
    const body = await service.forUser('u1');

    expect(body.memberships).toEqual([
      {
        organizationId: JPICE.id,
        role: 'officer',
        isHead: true,
        title: 'President',
        termEnd: '2027-07-31',
      },
    ]);
    const [jpice] = body.organizations;
    expect(jpice!.organization).toMatchObject({
      id: JPICE.id,
      acronym: 'JPICE',
      logoUrl: 'https://cdn.test/logos/jpice-ab12.webp',
    });
    // Buckets without documents are zero.
    expect(jpice!.counts).toEqual({
      public: 2,
      members: 0,
      private: 1,
      scanning: 0,
      quarantined: 1,
      archived: 0,
    });
    expect(documents.list).toHaveBeenCalledWith(viewer, { organizationId: JPICE.id, limit: 5 });
    expect(repo.listQuarantined).toHaveBeenCalledWith(viewer, JPICE.id, 10);
    expect(repo.listActivity).toHaveBeenCalledWith(viewer, JPICE.id, 10);
  });

  it('signs previews and lists the quarantined uploads and activity', async () => {
    const [jpice] = (await setup().service.forUser('u1')).organizations;
    expect(jpice!.recentDocuments[0]!.currentVersion!.thumbnailUrl).toBe(
      'https://storage.test/thumbs/d1.webp?signed',
    );
    expect(jpice!.quarantined.map((d) => [d.id, d.status])).toEqual([['q1', 'quarantined']]);
    expect(jpice!.activity).toEqual([
      {
        id: '0195f3c0-0000-7000-8000-0000000000b1',
        kind: 'visibility_change',
        at: AT.toISOString(),
        actorName: 'Maria Santos',
        document: { id: 'd1', title: 'Doc d1' },
        version: null,
      },
    ]);
  });

  it('shows an organization once when the user holds two roles in it', async () => {
    const { service, repo } = setup({
      memberships: [membership(), membership({ id: 'm2', role: 'adviser', isHead: false })],
    });
    const body = await service.forUser('u1');
    expect(body.memberships).toHaveLength(2);
    expect(body.organizations).toHaveLength(1);
    expect(repo.countForDashboard).toHaveBeenCalledWith(expect.anything(), [JPICE.id]);
  });

  it('passes the admin flag and handles a user with no memberships', async () => {
    expect((await setup({ isAdmin: true }).service.forUser('u1')).isAdmin).toBe(true);
    const body = await setup({ memberships: [] }).service.forUser('u1');
    expect(body).toEqual({ memberships: [], organizations: [], isAdmin: false });
  });
});
