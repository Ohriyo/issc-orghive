import { describe, expect, it, vi } from 'vitest';
import { createPublicUrl } from '#src/lib/public-url';
import type { DocumentRecord } from '#src/repositories/document.repository';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { AccountOrganization } from '#src/repositories/account.repository';
import type { ProjectRecord } from '#src/repositories/project.repository';
import { createDashboardService } from '#src/services/dashboard.service';

const JPICE: AccountOrganization = {
  id: '0195f3c0-0000-7000-8000-0000000000a1',
  type: 'SBO',
  parentId: '0195f3c0-0000-7000-8000-0000000000c1',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  logoKey: 'logos/jpice-ab12.webp',
  logoWidths: [128, 256],
};
const AT = new Date('2026-10-01T00:00:00Z');

/** A project with no files yet: its proposal is due 14 days after it was created. */
function project(id: string, createdAt: string, targetDate: string): ProjectRecord {
  return {
    id,
    name: `Project ${id}`,
    organizationId: JPICE.id,
    createdAt: new Date(createdAt),
    targetDate: new Date(`${targetDate}T00:00:00Z`),
    nomRequired: false,
    momRequired: false,
    proposalDueOverride: null,
    postEventDueOverride: null,
    organization: { id: JPICE.id, slug: 'jpice', acronym: 'JPICE', name: JPICE.name, type: 'SBO' },
    tasks: [],
  } as unknown as ProjectRecord;
}

/** 08:00 on October 16, 2026, Manila: the 1st semester of 2026-2027. */
const NOW = new Date('2026-10-16T00:00:00Z');
const PROJECTS = [
  // Active: proposal due October 24.
  project('p-active', '2026-10-10T02:00:00Z', '2026-11-20'),
  // Blocked: its proposal was due October 4.
  project('p-blocked', '2026-09-20T02:00:00Z', '2026-10-30'),
  // Next semester, but its proposal (due October 26) is still one of the next deadlines.
  project('p-next', '2026-10-12T02:00:00Z', '2027-02-10'),
];

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
    visibility: 'governing',
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

const TERM = {
  officerName: 'Juan Dela Cruz',
  officerPosition: 'President',
  officerEmail: 'juan@nwssu.test',
  termEnd: new Date('2027-07-31T00:00:00Z'),
};

/** The shared account of `org` (null: an account acting for no organization). */
function setup({ org = JPICE }: { org?: AccountOrganization | null } = {}) {
  const viewer: DocumentViewer = org
    ? { kind: 'account', userId: 'u1', organizationId: org.id, organizationType: org.type }
    : { kind: 'public' };
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
          actingAs: 'Maria Santos',
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
    accounts: {
      findAccount: vi.fn(() => Promise.resolve(org && { userId: 'u1', organization: org })),
      findCurrentTerm: vi.fn(() => Promise.resolve(org && TERM)),
    },
    dashboard: repo,
    documents,
    viewers: { forUser: () => Promise.resolve(viewer) },
    projects: { listByOrganization: vi.fn(() => Promise.resolve(PROJECTS)) },
    storage,
    publicUrl: createPublicUrl('https://cdn.test'),
    now: () => NOW,
  });
  return { service, repo, documents, viewer };
}

describe('dashboardService.forUser', () => {
  it('builds each organization from the repositories, through the viewer', async () => {
    const { service, repo, documents, viewer } = setup();
    const body = await service.forUser('u1');

    expect(body.term).toEqual({
      officerInCharge: { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' },
      termEnd: '2027-07-31',
    });
    const [jpice] = body.organizations;
    expect(jpice!.organization).toMatchObject({
      id: JPICE.id,
      acronym: 'JPICE',
      logoUrl: 'https://cdn.test/logos/jpice-ab12.webp',
    });
    // Buckets without documents are zero.
    expect(jpice!.counts).toEqual({
      public: 2,
      governing: 0,
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
        actingAs: 'Maria Santos',
        document: { id: 'd1', title: 'Doc d1' },
        version: null,
      },
    ]);
  });

  it('sets the ISSC, council and compliance flags from the account’s organization', async () => {
    const council = (type: 'ISSC' | 'CSC', id: string) =>
      ({ ...JPICE, id, type, parentId: null }) satisfies AccountOrganization;
    expect(await setup().service.forUser('u1')).toMatchObject({
      isIssc: false,
      canSeeCompliance: false,
      decidesAppeals: false,
    });
    expect(await setup({ org: council('CSC', 'csc') }).service.forUser('u1')).toMatchObject({
      isIssc: false,
      canSeeCompliance: true,
      decidesAppeals: true,
    });
    expect(await setup({ org: council('ISSC', 'issc') }).service.forUser('u1')).toMatchObject({
      isIssc: true,
      canSeeCompliance: true,
      decidesAppeals: true,
    });
  });

  it('is empty for an account acting for no organization', async () => {
    const { service, repo } = setup({ org: null });
    expect(await service.forUser('u1')).toEqual({
      term: null,
      organizations: [],
      isIssc: false,
      canSeeCompliance: false,
      decidesAppeals: false,
    });
    expect(repo.countForDashboard).not.toHaveBeenCalled();
  });
});

describe('dashboardService "This semester"', () => {
  it('counts this semester’s projects by status and lists the next three deadlines', async () => {
    const [jpice] = (await setup().service.forUser('u1')).organizations;
    expect(jpice!.semester).toEqual({
      academicYear: '2026-2027',
      semester: 'first',
      counts: { active: 1, blocked: 1, completed: 0 },
      nextDeadlines: [
        expect.objectContaining({ projectId: 'p-active', task: 'PROPOSAL' }),
        expect.objectContaining({ projectId: 'p-next', task: 'PROPOSAL' }),
      ],
    });
  });
});
