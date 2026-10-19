import type { Page, Route } from '@playwright/test';
import type {
  AdminOrganization,
  AdminOrganizationTree,
  Announcement,
  AnnouncementListResponse,
  Appeal,
  AppealListResponse,
  AuthResponse,
  CollegeDetail,
  CollegeListResponse,
  CollegeSummary,
  ComplianceOverview,
  DashboardResponse,
  DocumentListResponse,
  DocumentSummary,
  DocumentTypeListResponse,
  NotificationListResponse,
  NotificationPreferences,
  OrganizationCompliance,
  OrganizationDetail,
  OrganizationSummary,
  ProjectDetail,
  ProjectListResponse,
  SearchResponse,
  SemestralReportListResponse,
  SystemAuditListResponse,
  SystemOverview,
  SystemSecurity,
  SystemUserDetail,
  SystemUserListResponse,
  SupportDocumentList,
  SystemAccountRequestList,
  TestDataPreview,
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
export const UPDATE_ID = '0195f3c0-0000-7000-8000-0000000000e1';

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
  '/updates',
  `/updates/${UPDATE_ID}`,
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
  '/dashboard/compliance',
  '/dashboard/notifications',
  '/dashboard/notifications/settings',
] as const;

/** JPICE's shared organization account. */
const OFFICER: AuthResponse = {
  accessToken: 'e2e-token',
  expiresIn: 900,
  user: {
    id: '0195f3c0-0000-7000-8000-000000000001',
    name: 'JPICE',
    email: 'jpice@orghive.local',
    mustChangePassword: false,
    organization: {
      id: organizations.jpice!.id,
      type: 'SBO',
      slug: 'jpice',
      acronym: 'JPICE',
      name: organizations.jpice!.name,
      parentId: '0195f3c0-0000-7000-8000-0000000000c2',
    },
    officerInCharge: { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' },
  },
};

/** The ISSC's shared account, which administers colleges and organizations. */
const ADMIN: AuthResponse = {
  ...OFFICER,
  user: {
    ...OFFICER.user,
    id: '0195f3c0-0000-7000-8000-000000000002',
    name: 'ISSC',
    email: 'issc@orghive.local',
    organization: {
      id: organizations.issc!.id,
      type: 'ISSC',
      slug: 'issc',
      acronym: 'ISSC',
      name: organizations.issc!.name,
      parentId: null,
    },
  },
};

/** Admin-only screens, checked with the admin session. */
export const ADMIN_ROUTES = ['/admin/organizations'] as const;

/** The developer's console account: SUPER_ADMIN with MFA, no organization. */
const SUPER_ADMIN: AuthResponse = {
  accessToken: 'e2e-token',
  expiresIn: 900,
  user: {
    id: '0195f3c0-0000-7000-8000-0000000000f1',
    name: 'Orghive Developer',
    email: 'dev@orghive.local',
    mustChangePassword: false,
    organization: null,
    officerInCharge: null,
    systemRole: 'SUPER_ADMIN',
    mfaSetupRequired: false,
  },
};

/** /system screens, checked with the super admin session. */
export const SYSTEM_ROUTES = [
  '/system/overview',
  '/system/users',
  '/system/users/new',
  '/system/users/0195f3c0-0000-7000-8000-000000000001',
  '/system/test-data',
  '/system/account-requests',
  '/system/super-admins',
  '/system/audit',
  '/system/security',
] as const;

const STAMP = '2026-10-19T08:00:00.000Z';

const SYSTEM_OVERVIEW: SystemOverview = {
  users: { total: 148, active: 141, disabled: 7 },
  superAdmins: { active: 2, pendingMfa: 1 },
  organizations: { total: 22, active: 21 },
  documents: { available: 1204, scanning: 3, stuckScanning: 1, quarantined: 2, archived: 87 },
  queues: [
    { name: 'documents', waiting: 3, active: 1, delayed: 0, failed: 1 },
    { name: 'notifications', waiting: 0, active: 0, delayed: 12, failed: 0 },
    { name: 'reports', waiting: 0, active: 0, delayed: 0, failed: 0 },
  ],
  auditEventsLast24h: 912,
  failedLoginsLast24h: 6,
  generatedAt: STAMP,
};

const SYSTEM_USERS: SystemUserListResponse = {
  items: [
    {
      id: SUPER_ADMIN.user.id,
      name: SUPER_ADMIN.user.name,
      email: SUPER_ADMIN.user.email,
      systemRole: 'SUPER_ADMIN',
      mfaEnabledAt: STAMP,
      disabledAt: null,
      lockedAt: null,
      lockReason: null,
      mustChangePassword: false,
      lastLoginAt: STAMP,
      officerInCharge: null,
      organization: null,
      createdAt: STAMP,
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000f2',
      name: 'Second Developer',
      email: 'second.developer.with.a.long.address@orghive.local',
      systemRole: 'SUPER_ADMIN',
      mfaEnabledAt: null,
      disabledAt: null,
      lockedAt: null,
      lockReason: null,
      mustChangePassword: false,
      lastLoginAt: STAMP,
      officerInCharge: null,
      organization: null,
      createdAt: STAMP,
    },
    {
      id: OFFICER.user.id,
      name: OFFICER.user.name,
      email: OFFICER.user.email,
      systemRole: 'NONE',
      mfaEnabledAt: null,
      disabledAt: STAMP,
      lockedAt: null,
      lockReason: null,
      mustChangePassword: false,
      lastLoginAt: null,
      organization: {
        slug: 'jpice',
        acronym: 'JPICE',
        name: 'Junior Philippine Institute of Civil Engineers',
        type: 'SBO',
        college: 'CEA',
      },
      officerInCharge: {
        name: 'Maria Concepcion Villanueva-Santos',
        position: 'President',
        email: 'maria.villanueva-santos@nwssu.test',
      },
      createdAt: STAMP,
    },
  ],
  total: 61,
  page: 1,
  pageSize: 25,
};

const ACCOUNT_ID = '0195f3c0-0000-7000-8000-000000000001';

/** /system/users/:id for JPICE's account. */
const SYSTEM_ACCOUNT: SystemUserDetail = {
  account: {
    ...SYSTEM_USERS.items[2]!,
    disabledAt: null,
    lockedAt: STAMP,
    lockReason: 'Suspicious sign-ins from a new device',
  },
  terms: [
    {
      officerName: 'Maria Concepcion Villanueva-Santos',
      officerPosition: 'President',
      officerEmail: 'maria.villanueva-santos@nwssu.test',
      termStart: '2026-08-01',
      termEnd: '2027-07-31',
      endedAt: null,
    },
    {
      officerName: 'Juan Dela Cruz',
      officerPosition: 'President',
      officerEmail: 'juan@nwssu.test',
      termStart: '2025-08-01',
      termEnd: '2026-07-31',
      endedAt: '2026-07-31T15:59:59.000Z',
    },
  ],
  logins: [
    {
      at: STAMP,
      succeeded: true,
      ip: '203.0.113.20',
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130',
    },
    { at: STAMP, succeeded: false, ip: '2001:db8:85a3::8a2e:370:7334', userAgent: null },
  ],
  sessions: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000e1',
      startedAt: STAMP,
      expiresAt: STAMP,
      ip: '203.0.113.20',
    },
  ],
  audit: [],
};

const SUPPORT_DOCUMENTS: SupportDocumentList = {
  organization: {
    slug: 'jpice',
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
  },
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000d1',
      title: 'Inter-Year Bridge Design Competition 2026: Project Proposal with a very long title',
      type: 'Project proposal',
      status: 'scanning',
      visibility: 'governing',
      isTestData: false,
      sizeBytes: 2_400_000,
      scanStatus: 'pending',
      stuck: true,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000d2',
      title: null,
      type: 'Resolution',
      status: 'archived',
      visibility: 'private',
      isTestData: true,
      sizeBytes: 81_000,
      scanStatus: 'clean',
      stuck: false,
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ],
};

const ACCOUNT_REQUESTS: SystemAccountRequestList = {
  openCount: 1,
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000b8',
      status: 'requested',
      organization: {
        slug: 'icpep-se',
        acronym: 'ICpEP.SE',
        name: 'Institute of Computer Engineers of the Philippines Student Edition',
        type: 'SBO',
        collegeSlug: 'cea',
        college: 'CEA',
        hasAccount: false,
      },
      accountEmail: 'icpep.se.official.account@nwssu.test',
      officerInCharge: {
        name: 'Maria Concepcion Villanueva-Santos',
        position: 'President',
        email: 'maria.villanueva-santos@nwssu.test',
      },
      note: 'New officers took over in August; please send the password before the first general assembly.',
      requestedAt: STAMP,
      requestedBy: { name: 'ISSC', email: 'issc@orghive.local' },
      decidedAt: null,
      declineReason: null,
      createdAccountId: null,
    },
  ],
};

const TEST_DATA: TestDataPreview = {
  total: 2,
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000d2',
      organization: { slug: 'jpice', acronym: 'JPICE' },
      type: 'Resolution',
      status: 'available',
      createdAt: STAMP,
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000d3',
      organization: { slug: 'icpep-se', acronym: 'ICpEP.SE' },
      type: 'Activity proposal',
      status: 'archived',
      createdAt: STAMP,
    },
  ],
};

const SYSTEM_AUDIT: SystemAuditListResponse = {
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000f9',
      createdAt: STAMP,
      action: 'system_role_change',
      actor: { id: SUPER_ADMIN.user.id, name: 'Orghive Developer', email: 'dev@orghive.local' },
      entityType: 'user',
      entityId: '0195f3c0-0000-7000-8000-0000000000f2',
      organizationId: null,
      ip: '2001:db8:85a3::8a2e:370:7334',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
      actingAs: null,
      metadata: { before: { systemRole: 'SUPER_ADMIN' }, after: { systemRole: 'NONE' } },
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000fa',
      createdAt: STAMP,
      action: 'upload',
      actor: { id: OFFICER.user.id, name: 'JPICE', email: 'jpice@orghive.local' },
      entityType: 'document',
      entityId: '0195f3c0-0000-7000-8000-0000000000d1',
      organizationId: organizations.jpice!.id,
      ip: '203.0.113.20',
      userAgent: null,
      actingAs: 'Maria Concepcion Villanueva-Santos',
      metadata: { version: 2, mimeType: 'application/pdf', sizeBytes: 482113 },
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000f8',
      createdAt: STAMP,
      action: 'login_failed',
      actor: null,
      entityType: 'user',
      entityId: null,
      organizationId: null,
      ip: '203.0.113.9',
      userAgent: null,
      actingAs: null,
      metadata: null,
    },
  ],
  nextCursor: null,
};

const SYSTEM_SECURITY: SystemSecurity = {
  mfaEnabledAt: STAMP,
  recoveryCodesRemaining: 3,
  sessionStartedAt: STAMP,
  sessionExpiresAt: '2026-10-19T16:00:00.000Z',
  idleTimeoutSeconds: 900,
  stepUpExpiresAt: null,
};

const adminOrg = (o: OrganizationSummary, n: number, active = true): AdminOrganization => ({
  type: o.type,
  slug: o.slug,
  acronym: o.acronym,
  name: o.name,
  description: null,
  logoUrl: null,
  active,
  documentCount: n * 3,
  hasAccount: n % 3 !== 2,
  // Organizations without an account show each request state.
  accountRequest:
    n % 3 !== 2
      ? null
      : n % 2 === 0
        ? {
            id: '0195f3c0-0000-7000-8000-0000000000b8',
            status: 'requested',
            requestedAt: STAMP,
            decidedAt: null,
            declineReason: null,
          }
        : {
            id: '0195f3c0-0000-7000-8000-0000000000b9',
            status: 'declined',
            requestedAt: STAMP,
            decidedAt: STAMP,
            declineReason:
              'Use the organization’s official NwSSU email address, not a personal one.',
          },
});

const ADMIN_TREE: AdminOrganizationTree = {
  issc: adminOrg({ ...organizations.issc!, type: 'ISSC' }, 4),
  colleges: collegeSummaries.map((college, i) => ({
    code: college.code,
    slug: college.slug,
    name: college.name,
    motto: college.motto,
    description: null,
    csc: adminOrg(college.csc!, i),
    // CEA has the real SBOs, one of them inactive; the rest have none yet.
    sbos: college.slug === 'cea' ? sbos.map((s, j) => adminOrg(s, j, s.slug !== 'jiiee')) : [],
  })),
};

const jpiceDocs = documents.map((d, i) => ({
  ...d,
  status: (['scanning', 'available', 'available', 'quarantined', 'archived'] as const)[i]!,
  visibility: (['public', 'governing', 'private', 'public', 'public'] as const)[i]!,
}));

/** Every panel is on (appeals, compliance) so the layout checks cover them all. */
const DASHBOARD: DashboardResponse = {
  term: {
    officerInCharge: { name: 'Juan Dela Cruz', position: 'President', email: 'juan@nwssu.test' },
    termEnd: '2027-07-31',
  },
  organizations: [
    {
      organization: { ...sbos[3]!, id: organizations.jpice!.id },
      counts: { public: 1, governing: 1, private: 1, scanning: 1, quarantined: 1, archived: 1 },
      semester: {
        academicYear: '2026-2027',
        semester: 'first',
        counts: { active: 2, blocked: 1, completed: 3 },
        nextDeadlines: [
          {
            projectId: '0195f3c0-0000-7000-8000-0000000000c1',
            projectName: 'Inter-Year Bridge Design Competition 2026',
            task: 'PROPOSAL',
            dueAt: `${isoDay(2)}T15:59:59.999Z`,
          },
          {
            projectId: '0195f3c0-0000-7000-8000-0000000000c1',
            projectName: 'Inter-Year Bridge Design Competition 2026',
            task: 'FINANCIAL_REPORT',
            dueAt: `${isoDay(34)}T15:59:59.999Z`,
          },
        ],
      },
      recentDocuments: jpiceDocs,
      quarantined: [jpiceDocs[3]!],
      activity: [
        {
          id: '0195f3c0-0000-7000-8000-0000000000a9',
          kind: 'visibility_change',
          at: '2026-10-14T03:00:00.000Z',
          actorName: 'JPICE',
          actingAs: 'Maria Santos',
          document: { id: jpiceDocs[3]!.id, title: jpiceDocs[3]!.title },
          version: 1,
        },
        {
          id: '0195f3c0-0000-7000-8000-0000000000aa',
          kind: 'upload',
          at: '2026-10-10T03:00:00.000Z',
          actorName: 'JPICE',
          actingAs: 'Juan Dela Cruz',
          document: { id: jpiceDocs[1]!.id, title: jpiceDocs[1]!.title },
          version: 2,
        },
      ],
    },
  ],
  isIssc: false,
  canSeeCompliance: true,
  decidesAppeals: true,
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
        visibility: 'private',
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
  nextCursor: null,
  unreadCount: 2,
  items: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000e1',
      kind: 'appeal_decided',
      title: `Appeal rejected: ${PROJECT.name}`,
      body: `CSC-CEA rejected your appeal about ${PROJECT.name}. Remarks: ${REMARKS}`,
      link: `/projects/${PROJECT.id}`,
      revealId: null,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: '0195f3c0-0000-7000-8000-0000000000e2',
      kind: 'deadline_soon',
      title: 'Project Proposal due Oct 20, 2026',
      body: 'The Project Proposal for Engineering Week Seminar Series is due at 11:59 PM.',
      link: '/projects/0195f3c0-0000-7000-8000-0000000000c2',
      revealId: null,
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

const ISSC_BRIEF = {
  type: 'ISSC' as const,
  slug: 'issc',
  acronym: 'ISSC',
  name: organizations.issc!.name,
};

const UPDATES: Announcement[] = [
  {
    id: UPDATE_ID,
    title: 'General assembly of all organization officers this Friday',
    body: 'All officers of the ISSC, the Collegiate Student Councils and the Student Body Organizations meet at the university gymnasium on Friday at 3:00 PM.\n\nBring your organization ID. Attendance is recorded per organization, and the semestral calendar of activities will be discussed.',
    publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
    editedAt: null,
    organization: ISSC_BRIEF,
    canEdit: false,
  },
  {
    id: '0195f3c0-0000-7000-8000-0000000000e2',
    title: 'CEA Engineering Week opening program',
    body: 'The opening program starts Monday at 8:00 AM at the CEA lobby. Each SBO prepares one booth.',
    publishedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    editedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    organization: CSC_CEA,
    canEdit: false,
  },
];

const OVERVIEW: ComplianceOverview = {
  academicYear: '2026-2027',
  semester: 'first',
  scope: { type: 'ISSC', acronym: 'ISSC' },
  organizations: sbos.map((s, i) => ({
    organization: { type: 'SBO', slug: s.slug, acronym: s.acronym, name: s.name, college: 'CEA' },
    activeProjects: (i % 3) + 1,
    blockedProjects:
      i === 1 ? [{ id: PROJECT.id, name: 'Inter-Year Bridge Design Competition 2026' }] : [],
    nextDeadline: {
      projectId: PROJECT.id,
      projectName: 'Inter-Year Bridge Design Competition 2026',
      task: 'PROPOSAL',
      dueAt: endOfDay(isoDay(i + 1)),
    },
    overdueTasks:
      i % 2 === 0
        ? [
            {
              projectId: PROJECT.id,
              projectName: 'Inter-Year Bridge Design Competition 2026',
              task: 'FINANCIAL_REPORT',
              dueAt: endOfDay(isoDay(-(i + 2))),
              daysOverdue: i + 2,
            },
          ]
        : [],
    frozenSince: i === 0 ? new Date(Date.now() - 5 * 86_400_000).toISOString() : null,
    openAppeals: i === 0 ? 1 : 0,
  })),
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Answers every /api/v1 request in the browser, as a signed-out visitor or an officer. */
export async function stubApi(
  page: Page,
  {
    signedIn = false,
    admin = false,
    superAdmin = false,
  }: { signedIn?: boolean; admin?: boolean; superAdmin?: boolean } = {},
) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    if (superAdmin && path === '/auth/refresh') return json(route, SUPER_ADMIN);
    if (superAdmin && path === '/system/overview') return json(route, SYSTEM_OVERVIEW);
    if (superAdmin && path === '/system/users') {
      return json(
        route,
        url.searchParams.get('role') === 'SUPER_ADMIN'
          ? { items: SYSTEM_USERS.items.slice(0, 2), nextCursor: null }
          : SYSTEM_USERS,
      );
    }
    if (superAdmin && path === `/system/users/${ACCOUNT_ID}`) return json(route, SYSTEM_ACCOUNT);
    if (superAdmin && path === '/system/organizations') return json(route, ADMIN_TREE);
    if (superAdmin && path === '/system/organizations/jpice/documents') {
      return json(route, SUPPORT_DOCUMENTS);
    }
    if (superAdmin && path === '/system/test-data') return json(route, TEST_DATA);
    if (superAdmin && path === '/system/account-requests/count') return json(route, { open: 1 });
    if (superAdmin && path === '/system/account-requests') return json(route, ACCOUNT_REQUESTS);
    if (superAdmin && path === '/system/audit-logs') return json(route, SYSTEM_AUDIT);
    if (superAdmin && path === '/system/me/security') return json(route, SYSTEM_SECURITY);
    if (admin && path === '/auth/refresh') return json(route, ADMIN);
    if (admin && path === '/admin/organizations') return json(route, ADMIN_TREE);
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
    if (signedIn && path === '/me/notification-preferences') {
      return json(route, {
        email: {
          deadline_soon: true,
          deadline_missed: true,
          appeal_submitted: true,
          appeal_decided: true,
          report_ready: true,
          upload_quarantined: true,
          term_ending: true,
          password_reveal: true,
          account_request_declined: true,
          announcement_posted: false,
        },
      } satisfies NotificationPreferences);
    }
    if (signedIn && path === '/compliance/overview') return json(route, OVERVIEW);
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
    if (path === '/announcements') {
      return json(route, {
        items: UPDATES,
        nextCursor: null,
        canPostFor: signedIn ? [ISSC_BRIEF] : [],
      } satisfies AnnouncementListResponse);
    }
    if (path === `/announcements/${UPDATE_ID}`) return json(route, UPDATES[0]);
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
              actingAs: null,
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
