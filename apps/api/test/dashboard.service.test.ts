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

function doc(id: string, thumbnailKey: string | null = null): DocumentRecord {
  return {
    id,
    title: `Doc ${id}`,
    description: null,
    academicYear: '2026-2027',
    semester: null,
    status: 'rejected',
    visibility: 'members',
    tags: [],
    submittedAt: AT,
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

function setup({
  memberships = [membership()],
  reviewableOrgIds = [] as string[],
  isAdmin = false,
} = {}) {
  const viewer: DocumentViewer = {
    kind: 'user',
    userId: 'u1',
    isAdmin,
    memberOrgIds: memberships.map((m) => m.organization.id),
    reviewableOrgIds,
  };
  const repo = {
    countByStatus: vi.fn(() => Promise.resolve(new Map([[JPICE.id, { pending: 2, rejected: 1 }]]))),
    listRejected: vi.fn(() =>
      Promise.resolve([
        {
          ...doc('r1'),
          approvals: [
            { comment: 'Add the minutes.', decidedAt: AT, approver: { name: 'Maria Santos' } },
          ],
        },
        { ...doc('r2'), approvals: [] },
      ]),
    ),
    listActivity: vi.fn(() =>
      Promise.resolve([
        {
          id: '0195f3c0-0000-7000-8000-0000000000b1',
          action: 'reject' as const,
          createdAt: AT,
          actorName: 'Maria Santos',
          document: { id: 'r1', title: 'Doc r1' },
          version: 1,
        },
      ]),
    ),
    countAwaitingReview: vi.fn(() => Promise.resolve(4)),
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
    // Statuses without documents are zero.
    expect(jpice!.counts).toEqual({ draft: 0, pending: 2, approved: 0, rejected: 1, archived: 0 });
    expect(documents.list).toHaveBeenCalledWith(viewer, { organizationId: JPICE.id, limit: 5 });
    expect(repo.listRejected).toHaveBeenCalledWith(viewer, JPICE.id, 10);
    expect(repo.listActivity).toHaveBeenCalledWith(viewer, JPICE.id, 10);
  });

  it('signs previews and maps remarks, including a rejection with no recorded decision', async () => {
    const [jpice] = (await setup().service.forUser('u1')).organizations;
    expect(jpice!.recentDocuments[0]!.currentVersion!.thumbnailUrl).toBe(
      'https://storage.test/thumbs/d1.webp?signed',
    );
    expect(jpice!.needsRevision.map((r) => [r.remark, r.reviewerName, r.decidedAt])).toEqual([
      ['Add the minutes.', 'Maria Santos', AT.toISOString()],
      [null, null, null],
    ]);
    expect(jpice!.activity).toEqual([
      {
        id: '0195f3c0-0000-7000-8000-0000000000b1',
        kind: 'reject',
        at: AT.toISOString(),
        actorName: 'Maria Santos',
        document: { id: 'r1', title: 'Doc r1' },
        version: 1,
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
    expect(repo.countByStatus).toHaveBeenCalledWith(expect.anything(), [JPICE.id]);
  });

  it('counts documents awaiting review only for reviewers', async () => {
    expect((await setup().service.forUser('u1')).reviews).toBeNull();
    const reviewer = setup({ reviewableOrgIds: ['psme', 'iecep'] });
    expect((await reviewer.service.forUser('u1')).reviews).toEqual({
      pending: 4,
      organizations: 2,
    });
    expect(reviewer.repo.countAwaitingReview).toHaveBeenCalledWith(expect.anything(), [
      'psme',
      'iecep',
    ]);
  });

  it('passes the admin flag and handles a user with no memberships', async () => {
    expect((await setup({ isAdmin: true }).service.forUser('u1')).isAdmin).toBe(true);
    const body = await setup({ memberships: [] }).service.forUser('u1');
    expect(body).toMatchObject({ memberships: [], organizations: [], reviews: null });
  });
});
