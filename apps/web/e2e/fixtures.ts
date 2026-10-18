import type { Page, Route } from '@playwright/test';
import type {
  Appeal,
  AppealListResponse,
  AuthResponse,
  CollegeDetail,
  CollegeListResponse,
  CollegeSummary,
  DashboardResponse,
  DocumentListResponse,
  DocumentSummary,
  DocumentTypeListResponse,
  NotificationListResponse,
  OrganizationCompliance,
  OrganizationDetail,
  OrganizationSummary,
  ProjectDetail,
  ProjectListResponse,
  SearchResponse,
  SemestralReportListResponse,
} from '@orghive/shared';

/*
 * API stand-ins for the e2e checks, typed against the shared schemas so they cannot drift
 * from what the API really returns. Names and lengths are the real seeded ones, so layouts
 * are measured with realistic text.
 */

const COLLEGES: [code: string, name: string, motto: string][] = [
  ['CAT', 'College of Agriculture and Technology', 'Growing Innovation, Harvesting Change.'],
  ['CCIS', 'College of Computing and Information Sciences', 'Code the Future.'],
  ['CCJS', 'College of Criminal Justice and Sciences', 'Justice, Integrity, Service.'],
  ['CEA', 'College of Engineering and Architecture', 'Designing Structures, Building Futures.'],
  ['CoED', 'College of Education', 'Teaching Minds, Touching Hearts.'],
  ['COM', 'College of Management', 'Leading with Purpose.'],
  ['CON', 'College of Nursing', 'Caring Beyond Measure.'],
];

const SBOS: [slug: string, acronym: string, name: string][] = [
  ['icpep-se', 'ICpEP.SE', 'Institute of Computer Engineers of the Philippines - Student Edition'],
  ['iecep', 'IECEP', 'Institute of Electronics Engineers of the Philippines'],
  ['jiiee', 'JIIEE', 'Junior Institute of Integrated Electrical Engineers'],
  ['jpice', 'JPICE', 'Junior Philippine Institute of Civil Engineers'],
  ['psme', 'PSME', 'Philippine Society of Mechanical Engineers'],
  ['uapsa', 'UAPSA', 'United Architects of the Philippines Student Auxiliary'],
];

function csc(code: string, name: string): OrganizationSummary {
  return {
    type: 'CSC',
    slug: `csc-${code.toLowerCase()}`,
    acronym: `CSC-${code}`,
    name: `Collegiate Student Council of the ${name}`,
    logoUrl: null,
    logoSrcSet: null,
  };
}

const collegeSummaries: CollegeSummary[] = COLLEGES.map(([code, name, motto]) => ({
  code,
  slug: code.toLowerCase(),
  name,
  motto,
  csc: csc(code, name),
}));

const sbos: OrganizationSummary[] = SBOS.map(([slug, acronym, name]) => ({
  type: 'SBO',
  slug,
  acronym,
  name,
  logoUrl: null,
  logoSrcSet: null,
}));

const CEA_REF = { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' };

const cea: CollegeDetail = {
  ...collegeSummaries[3]!,
  description:
    'The College of Engineering and Architecture is home to dynamic student organizations (JPICE, IECEP, ICpEP.SE, PSME, UAPSA, and JIIEE) that represent various engineering disciplines.',
  csc: {
    ...csc('CEA', CEA_REF.name),
    description:
      'The CSC-CEA serves as the official student governing body, uniting all CEA-tizens.',
  },
  sbos,
};

const organizations: Record<string, OrganizationDetail> = {
  issc: {
    id: '0195f3c0-0000-7000-8000-0000000000c1',
    type: 'ISSC',
    slug: 'issc',
    acronym: 'ISSC',
    name: 'Institutional Supreme Student Council',
    logoUrl: null,
    logoSrcSet: null,
    description:
      'The ISSC is the highest student governing body in the university. It represents all students and coordinates with the collegiate student councils.',
    parent: null,
    college: null,
  },
  jpice: {
    id: '0195f3c0-0000-7000-8000-0000000000c2',
    ...sbos[3]!,
    description:
      'The JPICE is a dynamic organization committed to shaping competent and socially responsible civil engineering students.',
    parent: csc('CEA', CEA_REF.name),
    college: CEA_REF,
  },
};

const TYPES: DocumentTypeListResponse = {
  types: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000e1',
      slug: 'activity-proposal',
      name: 'Activity proposal',
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000e2',
      slug: 'accomplishment-report',
      name: 'Accomplishment report',
    },
    { id: '0195f3c0-0000-7000-8000-0000000000e3', slug: 'resolution', name: 'Resolution' },
  ],
};

export const DOCUMENT_ID = '0195f3c0-0000-7000-8000-0000000000d1';

const TITLES = [
  'Activity Proposal: Inter-Year Bridge Design Competition 2026',
  'JPICE Accomplishment Report, First Semester AY 2025-2026',
  'Resolution No. 2026-03: Adopting the JPICE Officers’ Code of Conduct',
  'Civil Engineering Week 2026 Narrative Report',
  'Site Visit: Diversion Road Widening Project',
];

const documents: DocumentSummary[] = TITLES.map((title, i) => ({
  id: `0195f3c0-0000-7000-8000-0000000000d${i + 1}`,
  title,
  description:
    i === 0
      ? 'A truss bridge design and load-testing competition among civil engineering students.'
      : null,
  academicYear: '2026-2027',
  semester: 'first',
  status: 'available',
  visibility: 'public',
  tags: [],
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: organizations.jpice!.name },
  type: TYPES.types[i % TYPES.types.length]!,
  currentVersion: {
    version: 1,
    originalFilename: `document-${i + 1}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 120_000,
    scanStatus: 'clean',
    createdAt: '2026-08-20T00:00:00.000Z',
    thumbnailUrl: null,
  },
}));

/** Public routes the responsive and accessibility checks visit. */
export const PUBLIC_ROUTES = [
  '/',
  '/colleges',
  '/colleges/cea',
  '/colleges/cea/organizations',
  '/orgs/jpice',
  '/orgs/issc',
  '/orgs/jpice/paperworks',
  '/search',
  '/search?q=bridge&college=cea',
  // Signed out, this redirects to sign-in: the check covers that path.
  '/orgs/jpice/paperworks/upload',
  `/documents/${DOCUMENT_ID}`,
  '/login',
  '/forgot-password',
  '/reset-password?token=e2e-placeholder',
  '/no-such-page',
] as const;

/** Signed-in pages, checked with a stubbed officer session (JPICE and CSC-CEA). */
export const SIGNED_IN_ROUTES = [
  '/dashboard',
  '/dashboard/documents?org=jpice',
  '/dashboard/projects?org=jpice',
  '/dashboard/projects/new?org=jpice',
  '/projects/0195f3c0-0000-7000-8000-0000000000c1',
  '/dashboard/appeals',
  '/dashboard/appeals/new?org=jpice&project=0195f3c0-0000-7000-8000-0000000000c1',
  '/admin',
] as const;

const OFFICER: AuthResponse = {
  accessToken: 'e2e-token',
  expiresIn: 900,
  user: {
    id: '0195f3c0-0000-7000-8000-000000000001',
    name: 'Juan Dela Cruz',
    email: 'jpice.officer@orghive.local',
    mustChangePassword: false,
    roles: [{ orgId: organizations.jpice!.id, role: 'officer', isHead: true }],
    memberships: [
      {
        orgId: organizations.jpice!.id,
        orgSlug: 'jpice',
        orgAcronym: 'JPICE',
        role: 'officer',
        isHead: true,
        title: 'President',
      },
    ],
  },
};

const jpiceDocs = documents.map((d, i) => ({
  ...d,
  status: (['scanning', 'available', 'available', 'quarantined', 'archived'] as const)[i]!,
  visibility: (['public', 'members', 'private', 'public', 'public'] as const)[i]!,
}));

const DASHBOARD: DashboardResponse = {
  memberships: [
    {
      organizationId: organizations.jpice!.id,
      role: 'officer',
      isHead: true,
      title: 'President',
      termEnd: '2027-07-31',
    },
    {
      organizationId: organizations.issc!.id,
      role: 'officer',
      isHead: false,
      title: null,
      termEnd: '2027-07-31',
    },
  ],
  organizations: [
    {
      organization: { ...sbos[3]!, id: organizations.jpice!.id },
      counts: { public: 1, members: 1, private: 1, scanning: 1, quarantined: 1, archived: 1 },
      recentDocuments: jpiceDocs,
      quarantined: [jpiceDocs[3]!],
      activity: [
        {
          id: '0195f3c0-0000-7000-8000-0000000000a9',
          kind: 'visibility_change',
          at: '2026-10-14T03:00:00.000Z',
          actorName: 'Maria Santos',
          document: { id: jpiceDocs[3]!.id, title: jpiceDocs[3]!.title },
          version: 1,
        },
        {
          id: '0195f3c0-0000-7000-8000-0000000000aa',
          kind: 'upload',
          at: '2026-10-10T03:00:00.000Z',
          actorName: 'Juan Dela Cruz',
          document: { id: jpiceDocs[1]!.id, title: jpiceDocs[1]!.title },
          version: 2,
        },
      ],
    },
    {
      organization: {
        type: 'ISSC',
        slug: 'issc',
        acronym: 'ISSC',
        name: organizations.issc!.name,
        logoUrl: null,
        logoSrcSet: null,
        id: organizations.issc!.id,
      },
      counts: { public: 0, members: 0, private: 0, scanning: 0, quarantined: 0, archived: 0 },
      recentDocuments: [],
      quarantined: [],
      activity: [],
    },
  ],
  isAdmin: false,
};

/** `YYYY-MM-DD`, `days` from today (UTC is close enough for a stand-in). */
function isoDay(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999+08:00`).toISOString();

/** A project mid-way: proposal submitted, NOM open, the post-event reports still locked. */
const PROJECT: ProjectDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000c1',
  name: 'Inter-Year Bridge Design Competition 2026',
  targetDate: isoDay(20),
  location: 'CEA Building, NwSSU Main Campus, Catbalogan City',
  beneficiaries: 'First- to fourth-year civil engineering students',
  description:
    'A truss bridge design and load-testing competition among civil engineering students.',
  status: 'active',
  proposalDueAt: endOfDay(isoDay(9)),
  postEventDueAt: endOfDay(isoDay(34)),
  nomRequired: true,
  momRequired: true,
  nextDeadline: null,
  organization: { type: 'SBO', slug: 'jpice', acronym: 'JPICE', name: organizations.jpice!.name },
  createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  updatedAt: new Date().toISOString(),
  tasks: [
    {
      type: 'PROPOSAL',
      status: 'submitted',
      dueAt: endOfDay(isoDay(9)),
      submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      document: {
        id: documents[0]!.id,
        title: 'Project Proposal: Inter-Year Bridge Design Competition 2026',
        status: 'available',
        visibility: 'members',
      },
    },
    { type: 'NOM', status: 'open', dueAt: null, submittedAt: null, document: null },
    { type: 'MOM', status: 'open', dueAt: null, submittedAt: null, document: null },
    {
      type: 'ACR',
      status: 'locked',
      dueAt: endOfDay(isoDay(34)),
      submittedAt: null,
      document: null,
    },
    {
      type: 'FINANCIAL_REPORT',
      status: 'locked',
      dueAt: endOfDay(isoDay(34)),
      submittedAt: null,
      document: null,
    },
  ],
};

const { tasks: _tasks, ...projectSummary } = PROJECT;
const PROJECTS: ProjectListResponse = {
  items: [
    projectSummary,
    {
      ...projectSummary,
      id: '0195f3c0-0000-7000-8000-0000000000c2',
      name: 'Engineering Week Seminar Series',
      targetDate: isoDay(3),
      nextDeadline: { type: 'PROPOSAL', dueAt: endOfDay(isoDay(1)) },
    },
    {
      ...projectSummary,
      id: '0195f3c0-0000-7000-8000-0000000000c3',
      name: 'Coastal Clean-up Drive',
      status: 'completed',
      nextDeadline: null,
    },
  ],
};

const CSC_CEA = { type: 'CSC' as const, slug: 'csc-cea', acronym: 'CSC-CEA', name: 'CSC of CEA' };
const JPICE_BRIEF = {
  type: 'SBO' as const,
  slug: 'jpice',
  acronym: 'JPICE',
  name: organizations.jpice!.name,
};
const FREEZE_ID = '0195f3c0-0000-7000-8000-0000000000f9';
const REMARKS =
  'Attach the adviser’s signed leave notice and the rescheduled meeting minutes, then appeal again.';

/** JPICE is frozen by one project and has the checked project blocked, after a rejection. */
const COMPLIANCE: OrganizationCompliance = {
  frozen: true,
  freezes: [
    {
      id: FREEZE_ID,
      project: { id: '0195f3c0-0000-7000-8000-0000000000c3', name: 'Coastal Clean-up Drive' },
      reports: ['ACR', 'FINANCIAL_REPORT'],
      frozenAt: new Date().toISOString(),
      pendingAppeal: null,
      lastRejection: null,
    },
  ],
  blockedProjects: [
    {
      id: PROJECT.id,
      name: PROJECT.name,
      proposalDueAt: endOfDay(isoDay(-2)),
      pendingAppeal: null,
      lastRejection: { remarks: REMARKS, decidedAt: new Date().toISOString() },
    },
  ],
  decider: CSC_CEA,
};

const APPEAL: Appeal = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'PROJECT_BLOCK',
  status: 'rejected',
  reason:
    'Our adviser was on official leave for the regional engineering congress, so the proposal could not be signed before the deadline.',
  remarks: REMARKS,
  newDueAt: null,
  submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  decidedAt: new Date().toISOString(),
  submittedBy: { name: 'Juan Dela Cruz' },
  decidedBy: { name: 'Maria Santos' },
  organization: JPICE_BRIEF,
  decider: CSC_CEA,
  project: { id: PROJECT.id, name: PROJECT.name, targetDate: PROJECT.targetDate },
  freeze: null,
  attachments: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000a9',
      filename: 'adviser-leave-notice-regional-engineering-congress-2026.pdf',
      contentType: 'application/pdf',
      sizeBytes: 482_113,
      scanStatus: 'clean',
    },
  ],
  canDecide: false,
};

const QUEUE: AppealListResponse = {
  items: [
    {
      ...APPEAL,
      status: 'pending',
      remarks: null,
      decidedAt: null,
      decidedBy: null,
      canDecide: true,
    },
    {
      ...APPEAL,
      id: '0195f3c0-0000-7000-8000-0000000000b2',
      type: 'ORG_FREEZE',
      status: 'pending',
      remarks: null,
      decidedAt: null,
      decidedBy: null,
      attachments: [],
      freeze: { id: FREEZE_ID, reports: ['ACR', 'FINANCIAL_REPORT'] },
      canDecide: true,
    },
  ],
};

const NOTIFICATIONS: NotificationListResponse = {
  unreadCount: 2,
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000e1',
      kind: 'appeal_decided',
      title: `Appeal rejected: ${PROJECT.name}`,
      body: `CSC-CEA rejected your appeal about ${PROJECT.name}. Remarks: ${REMARKS}`,
      link: `/projects/${PROJECT.id}`,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000e2',
      kind: 'deadline_soon',
      title: 'Project Proposal due Oct 20, 2026',
      body: 'The Project Proposal for Engineering Week Seminar Series is due at 11:59 PM.',
      link: '/projects/0195f3c0-0000-7000-8000-0000000000c2',
      readAt: null,
      createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    },
  ],
};

/** One report finished, one being made, one failed: every state of the dashboard panel. */
const REPORTS: SemestralReportListResponse = {
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000b7',
      academicYear: '2026-2027',
      semester: 'first',
      status: 'generating',
      progress: 45,
      error: null,
      requestedBy: { name: 'Juan Dela Cruz' },
      createdAt: new Date().toISOString(),
      finishedAt: null,
      document: null,
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000b8',
      academicYear: '2025-2026',
      semester: 'second',
      status: 'ready',
      progress: 100,
      error: null,
      requestedBy: { name: 'Juan Dela Cruz' },
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      finishedAt: new Date(Date.now() - 86_000_000).toISOString(),
      document: {
        id: '0195f3c0-0000-7000-8000-0000000000d9',
        title: 'Semestral End Report: JPICE, 2nd semester 2025-2026',
        versionId: '0195f3c0-0000-7000-8000-0000000000e9',
      },
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000b9',
      academicYear: '2025-2026',
      semester: 'midyear',
      status: 'failed',
      progress: 30,
      error: 'Something went wrong while making the report. Try again.',
      requestedBy: { name: 'Juan Dela Cruz' },
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      finishedAt: new Date(Date.now() - 2 * 86_000_000).toISOString(),
      document: null,
    },
  ],
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Answers every /api/v1 request in the browser, as a signed-out visitor or an officer. */
export async function stubApi(page: Page, { signedIn = false }: { signedIn?: boolean } = {}) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    if (signedIn && path === '/auth/refresh') return json(route, OFFICER);
    if (signedIn && path === '/me/dashboard') return json(route, DASHBOARD);
    if (signedIn && path === '/organizations/jpice/projects') return json(route, PROJECTS);
    if (signedIn && path === `/projects/${PROJECT.id}`) return json(route, PROJECT);
    if (signedIn && path === '/organizations/jpice/compliance') return json(route, COMPLIANCE);
    if (signedIn && path === `/projects/${PROJECT.id}/appeals`) {
      return json(route, { items: [APPEAL] } satisfies AppealListResponse);
    }
    if (signedIn && path === '/appeals/queue') {
      return json(route, url.searchParams.get('status') === 'decided' ? { items: [] } : QUEUE);
    }
    if (signedIn && path === '/me/notifications') return json(route, NOTIFICATIONS);
    if (signedIn && path === '/organizations/jpice/semestral-reports') {
      return json(route, REPORTS);
    }
    if (signedIn && path === '/organizations/jpice/documents') {
      return json(route, { items: jpiceDocs, nextCursor: null } satisfies DocumentListResponse);
    }
    if (path === '/auth/refresh') {
      return json(
        route,
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401,
      );
    }
    if (path === '/colleges')
      return json(route, { colleges: collegeSummaries } satisfies CollegeListResponse);
    if (path === '/colleges/cea') return json(route, cea);
    if (path === '/document-types') return json(route, TYPES);
    if (path === '/organizations/jpice/documents') {
      return json(route, { items: documents, nextCursor: null } satisfies DocumentListResponse);
    }
    if (path === '/search') {
      return json(route, {
        query: url.searchParams.get('q') ?? '',
        items: documents.map((document) => ({
          document,
          snippet: [
            { text: 'Teams build and load-test a truss ', match: false },
            { text: 'bridge', match: true },
            { text: ' made of balsa wood, scored on strength per gram.', match: false },
          ],
        })),
        page: 1,
        nextPage: null,
      } satisfies SearchResponse);
    }
    const org = /^\/organizations\/([a-z0-9-]+)$/.exec(path);
    if (org && organizations[org[1]!]) return json(route, organizations[org[1]!]);
    const versions = /^\/documents\/([0-9a-f-]+)\/versions$/.exec(path);
    if (versions) {
      const found = documents.find((d) => d.id === versions[1]);
      if (found) {
        return json(route, {
          versions: [
            {
              id: '0195f3c0-0000-7000-8000-0000000000f1',
              version: 1,
              originalFilename: found.currentVersion!.originalFilename,
              mimeType: 'application/pdf',
              sizeBytes: found.currentVersion!.sizeBytes,
              scanStatus: 'clean',
              createdAt: found.createdAt,
              isCurrent: true,
            },
          ],
        });
      }
    }
    const doc = /^\/documents\/([0-9a-f-]+)$/.exec(path);
    if (doc) {
      const found = documents.find((d) => d.id === doc[1]);
      if (found) return json(route, found);
    }
    return json(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
}
