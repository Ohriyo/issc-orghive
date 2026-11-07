import type { CollegeDetail, OrganizationDetail } from './public-read';

export const SITE_NAME = 'Orghive';

/** Shown when a page has no image of its own; served by the web app. */
export const DEFAULT_OG_IMAGE_PATH = '/og-default.png';

/** Search engines cut meta descriptions at roughly this many characters. */
export const META_DESCRIPTION_MAX = 155;

/**
 * What a page tells search engines and link previews. `path` and a relative `image` are
 * resolved against the site origin by whoever renders the tags (the web app today, a
 * server-side injector later), so the same builder serves both.
 */
export interface PageSeo {
  title: string;
  description: string;
  path: string;
  /** Absolute URL, or a site-relative path such as DEFAULT_OG_IMAGE_PATH. */
  image: string;
  imageAlt: string;
}

/** Shortens at a word boundary and adds an ellipsis, so previews never end mid-word. */
export function truncateDescription(text: string, max = META_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

function pageTitle(main: string): string {
  return `${main} | ${SITE_NAME}`;
}

const DEFAULT_IMAGE_ALT = `${SITE_NAME}, NwSSU student-organization archive`;

/** The home page, and the defaults index.html serves to crawlers that do not run JavaScript. */
export function siteSeo(): PageSeo {
  return {
    title: `${SITE_NAME}: NwSSU student-organization Paperworks`,
    description:
      "The official archive of Northwest Samar State University's student organizations: proposals, reports, resolutions and accomplishment reports from the ISSC, CSCs and SBOs.",
    path: '/',
    image: DEFAULT_OG_IMAGE_PATH,
    imageAlt: DEFAULT_IMAGE_ALT,
  };
}

type OrgSeoInput = Pick<
  OrganizationDetail,
  'type' | 'slug' | 'acronym' | 'name' | 'description' | 'logoUrl' | 'college'
>;

/** /orgs/:slug. Falls back to a factual sentence built from the hierarchy, never invented copy. */
export function organizationSeo(org: OrgSeoInput): PageSeo {
  const where = org.college ? ` of the ${org.college.name}` : '';
  const level =
    org.type === 'ISSC'
      ? 'the university-wide student council of NwSSU'
      : org.type === 'CSC'
        ? `the Collegiate Student Council${where}`
        : `a student body organization${where}`;
  const fallback = `${org.name} (${org.acronym}) is ${level}. Browse its Paperworks on ${SITE_NAME}, NwSSU's archive of student-organization documents.`;

  return {
    title: pageTitle(`${org.name} (${org.acronym})`),
    description: truncateDescription(org.description ?? fallback),
    path: `/orgs/${org.slug}`,
    image: org.logoUrl ?? DEFAULT_OG_IMAGE_PATH,
    imageAlt: org.logoUrl ? `${org.name} logo` : DEFAULT_IMAGE_ALT,
  };
}

/**
 * /orgs/:slug/paperworks. Says what the archive holds, from facts only: the organization's
 * name and the kinds of documents Orghive keeps.
 */
export function paperworksSeo(org: OrgSeoInput): PageSeo {
  return {
    title: pageTitle(`${org.acronym} Paperworks`),
    description: truncateDescription(
      `Paperworks of the ${org.name} (${org.acronym}): proposals, reports, resolutions and accomplishment reports in ${SITE_NAME}, NwSSU's archive of student-organization documents.`,
    ),
    path: `/orgs/${org.slug}/paperworks`,
    image: org.logoUrl ?? DEFAULT_OG_IMAGE_PATH,
    imageAlt: org.logoUrl ? `${org.name} logo` : DEFAULT_IMAGE_ALT,
  };
}

type CollegeSeoInput = Pick<CollegeDetail, 'slug' | 'name' | 'motto' | 'description' | 'csc'>;

/** /colleges/:slug. The CSC's logo stands in for the college, as it does in the carousel. */
export function collegeSeo(college: CollegeSeoInput): PageSeo {
  const fallback = `The ${college.name} at NwSSU: its Collegiate Student Council and student body organizations, and their Paperworks on ${SITE_NAME}.`;
  const logo = college.csc?.logoUrl ?? null;
  return {
    title: pageTitle(college.name),
    description: truncateDescription(college.description ?? fallback),
    path: `/colleges/${college.slug}`,
    image: logo ?? DEFAULT_OG_IMAGE_PATH,
    imageAlt: logo && college.csc ? `${college.csc.name} logo` : DEFAULT_IMAGE_ALT,
  };
}

/** /orgs/:slug/updates: the organization's news, from facts only. */
export function orgUpdatesSeo(org: { slug: string; acronym: string; name: string }): PageSeo {
  return {
    title: pageTitle(`${org.acronym} updates and highlights`),
    description: truncateDescription(
      `News, highlights and achievements from ${org.name} (${org.acronym}), on ${SITE_NAME}.`,
    ),
    path: `/orgs/${org.slug}/updates`,
    image: DEFAULT_OG_IMAGE_PATH,
    imageAlt: DEFAULT_IMAGE_ALT,
  };
}

/** /orgs/:slug/updates/:postSlug. The image is the cover, else the organization's logo. */
export function orgPostSeo(post: {
  slug: string;
  title: string;
  summary: string;
  cover: { url: string; alt: string } | null;
  organization: { slug: string; acronym: string; name: string; logoUrl: string | null };
}): PageSeo {
  const org = post.organization;
  const image = post.cover?.url ?? org.logoUrl;
  return {
    title: pageTitle(`${post.title} · ${org.acronym}`),
    description: truncateDescription(post.summary),
    path: `/orgs/${org.slug}/updates/${post.slug}`,
    image: image ?? DEFAULT_OG_IMAGE_PATH,
    imageAlt: post.cover?.alt ?? (org.logoUrl ? `${org.name} logo` : DEFAULT_IMAGE_ALT),
  };
}
