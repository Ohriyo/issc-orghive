import type { OrgPostSectionsState } from '@/features/posts/presenters/use-org-post-sections';
import type { ConstitutionModel } from './use-constitution';
import type { OrgShowcaseState } from './use-org-showcase';
import type { OrganizationPageModel } from './use-organization-page';

/*
 * Which sections /orgs/:slug shows, in the fixed order of the template (docs/DOMAIN_RULES.md,
 * "Organization page"). A section with nothing to show is left out of the page and of the
 * "On this page" nav, so visitors never meet an empty heading (About and Documents stay:
 * what is missing there is worth saying). While a part is still loading
 * its section is kept, so the nav does not jump when it arrives.
 */

export const SECTION_IDS = [
  'highlights',
  'about',
  'updates',
  'projects',
  'officers',
  'documents',
  'contact',
] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const SECTION_LABELS: Record<SectionId, string> = {
  highlights: 'Highlights',
  about: 'About',
  updates: 'Updates',
  projects: 'Projects',
  officers: 'Officers',
  documents: 'Documents',
  contact: 'Contact',
};

export interface PageParts {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
  posts?: OrgPostSectionsState;
  showcase?: OrgShowcaseState;
}

const loaded = <T extends { status: string }>(state: T | undefined) =>
  state?.status === 'ready' ? (state as Extract<T, { status: 'ready' }>) : null;

/** Whether each section has something to show (true while its data is on its way). */
export function presentSections({ page, posts, showcase }: PageParts): SectionId[] {
  const postsReady = loaded(posts);
  const showcaseReady = loaded(showcase);
  const has: Record<SectionId, boolean> = {
    // Only once loaded: the band sits above the nav, so holding its place would not help.
    highlights: postsReady ? postsReady.sections.highlights.length > 0 : false,
    // When empty it says so, and what will appear as the organization adds it.
    about: true,
    updates: posts === undefined ? false : postsReady ? postsReady.sections.updates.length > 0 : true,
    projects:
      showcase === undefined ? false : showcaseReady ? showcaseReady.showcase.projectCount > 0 : true,
    officers: page.officers.length > 0,
    // The constitution's absence is worth saying, so Documents always shows.
    documents: true,
    // Its college is listed there too.
    contact: page.contact !== null || page.context !== null,
  };
  return SECTION_IDS.filter((id) => has[id]);
}

export interface ChecklistItem {
  label: string;
  done: boolean;
  /** Where to do it; one of the account's editors. */
  href: string;
  action: string;
}

/**
 * The own account's "Fill in your page" list: only it sees this, and only while something
 * is still missing. Null for everyone else, or once every item is done.
 */
export function fillInChecklist({ page, constitution, posts }: PageParts): ChecklistItem[] | null {
  const postsReady = loaded(posts);
  if (!postsReady?.sections.isOwner) return null;
  const { sections } = postsReady;
  const items: ChecklistItem[] = [
    {
      label: 'Logo, tagline and description',
      done: !!page.logoSrc && page.tagline !== null && page.description !== null,
      href: '/dashboard/profile',
      action: 'Edit profile',
    },
    {
      label: 'Pin a highlight',
      done: sections.highlights.length > 0,
      href: '/dashboard/posts/new',
      action: 'Add',
    },
    {
      label: 'Post your first update',
      done: sections.updates.length > 0,
      href: '/dashboard/posts/new',
      action: 'Write',
    },
    {
      label: 'List your officers',
      done: page.officers.length > 0,
      href: '/dashboard/profile',
      action: 'Add',
    },
    {
      label: 'Upload your Constitution & By-laws',
      done: constitution.status === 'ready',
      href: '/dashboard/profile#constitution',
      action: 'Upload',
    },
    {
      label: 'Add a contact email',
      done: page.contact?.email != null,
      href: '/dashboard/profile',
      action: 'Add',
    },
  ];
  return items.some((item) => !item.done) ? items : null;
}
