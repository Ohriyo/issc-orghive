import type { Page, Route } from '@playwright/test';
import type {
  CollegeDetail,
  CollegeListResponse,
  CollegeSummary,
  DocumentListResponse,
  DocumentSummary,
  DocumentTypeListResponse,
  OrganizationDetail,
  OrganizationSummary,
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
  status: 'approved',
  visibility: 'public',
  tags: [],
  submittedAt: '2026-09-01T00:00:00.000Z',
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
  // Signed out, this redirects to sign-in: the check covers that path.
  '/orgs/jpice/paperworks/upload',
  `/documents/${DOCUMENT_ID}`,
  '/login',
  '/forgot-password',
  '/reset-password?token=e2e-placeholder',
  '/no-such-page',
] as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Answers every /api/v1 request in the browser, as a signed-out visitor. */
export async function stubApi(page: Page) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
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
    if (path === '/organizations/jpice/documents' || path === '/documents') {
      return json(route, { items: documents, nextCursor: null } satisfies DocumentListResponse);
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
