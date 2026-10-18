import type { OrganizationType } from '@orghive/shared';
import type { Crumb, NavSection, PageChrome } from './page-chrome';

/**
 * Where each screen sits: its breadcrumb trail, logical parent (where Back goes when the
 * user did not come from another page) and header section. Pure, so the rules are tested
 * in one place. Public screens follow the hierarchy (Home › college › organization);
 * workspace screens hang off the Dashboard.
 */

/** What a trail needs to know about an organization. */
export interface OrgPlace {
  slug: string;
  acronym: string;
  type: OrganizationType;
  college: { code: string; slug: string } | null;
}

export interface CollegePlace {
  code: string;
  slug: string;
}

const HOME: Crumb = { label: 'Home', href: '/' };
const COLLEGES: Crumb = { label: 'Colleges', href: '/colleges' };
const DASHBOARD: Crumb = { label: 'Dashboard', href: '/dashboard' };

const toDestination = (crumb: Crumb) => ({ path: crumb.href ?? '/', label: crumb.label });

function sectionOf(org: OrgPlace | null): NavSection {
  return org?.type === 'ISSC' ? 'issc' : 'colleges';
}

/** Home › CEA › JPICE (or Home › ISSC). The last crumb links to the organization. */
function orgCrumbs(org: OrgPlace): Crumb[] {
  const self = { label: org.acronym, href: `/orgs/${org.slug}` };
  return org.college
    ? [HOME, { label: org.college.code, href: `/colleges/${org.college.slug}` }, self]
    : [HOME, self];
}

/** An organization's project list (all projects when the organization is not known yet). */
function projectsCrumb(org: { slug: string; acronym: string } | null): Crumb {
  return org
    ? { label: `${org.acronym} projects`, href: `/dashboard/projects?org=${org.slug}` }
    : { label: 'Projects', href: '/dashboard/projects' };
}

/** The last crumb is the current page: no link. */
function here(label: string): Crumb {
  return { label };
}

export const chrome = {
  home(): PageChrome {
    return { section: 'home', trail: [], parent: null, overlay: true };
  },

  /** /search → parent home. Search spans every organization, so no header section. */
  search(): PageChrome {
    return { section: null, trail: [HOME, here('Search')], parent: toDestination(HOME) };
  },

  colleges(): PageChrome {
    return { section: 'colleges', trail: [HOME, here('Colleges')], parent: toDestination(HOME) };
  },

  /** /colleges/:slug → parent /colleges. */
  college(college: CollegePlace | null): PageChrome {
    return {
      section: 'colleges',
      trail: [HOME, COLLEGES, here(college?.code ?? 'College')],
      parent: toDestination(COLLEGES),
    };
  },

  /** /colleges/:slug/organizations → parent the college page. */
  collegeOrganizations(slug: string, college: CollegePlace | null): PageChrome {
    const collegeCrumb = { label: college?.code ?? 'College', href: `/colleges/${slug}` };
    return {
      section: 'colleges',
      trail: [HOME, COLLEGES, collegeCrumb, here('Organizations')],
      parent: toDestination(collegeCrumb),
    };
  },

  /** /orgs/:slug → parent its college page (the ISSC: home). */
  organization(slug: string, org: OrgPlace | null): PageChrome {
    if (!org) return { section: 'colleges', trail: [], parent: toDestination(COLLEGES) };
    const crumbs = orgCrumbs(org);
    return {
      section: sectionOf(org),
      trail: [...crumbs.slice(0, -1), here(org.acronym)],
      parent: toDestination(crumbs.at(-2) ?? HOME),
    };
  },

  /** /orgs/:slug/paperworks → parent the organization. */
  paperworks(slug: string, org: OrgPlace | null): PageChrome {
    const orgCrumb = { label: org?.acronym ?? 'Organization', href: `/orgs/${slug}` };
    return {
      label: `${org?.acronym ?? 'Organization'} Paperworks`,
      section: sectionOf(org),
      trail: [...(org ? orgCrumbs(org) : [HOME, orgCrumb]), here('Paperworks')],
      parent: toDestination(orgCrumb),
    };
  },

  /** /documents/:id → parent its organization's Paperworks. */
  document(org: OrgPlace | null, title: string | null): PageChrome {
    if (!org) return { section: null, trail: [], parent: toDestination(HOME) };
    const paperworks = { label: `${org.acronym} Paperworks`, href: `/orgs/${org.slug}/paperworks` };
    return {
      section: sectionOf(org),
      trail: [
        ...orgCrumbs(org),
        { label: 'Paperworks', href: paperworks.href },
        here(title ?? 'Document'),
      ],
      parent: toDestination(paperworks),
    };
  },

  dashboard(): PageChrome {
    return { section: 'dashboard', trail: [here('Dashboard')], parent: null };
  },

  /** /admin/…: Dashboard › Admin › section, parent the Dashboard. */
  admin(label: string): PageChrome {
    return {
      section: 'dashboard',
      trail: [DASHBOARD, { label: 'Admin', href: '/admin' }, here(label)],
      parent: toDestination(DASHBOARD),
    };
  },

  /** Workspace screens: Dashboard › [organization ›] screen, parent the Dashboard. */
  workspace(label: string, org?: { slug: string; acronym: string } | null): PageChrome {
    const orgCrumb = org
      ? [{ label: org.acronym, href: `/dashboard/documents?org=${org.slug}` }]
      : [];
    return {
      section: 'dashboard',
      trail: [DASHBOARD, ...orgCrumb, here(label)],
      parent: toDestination(DASHBOARD),
    };
  },

  /** /dashboard/projects?org= → parent the Dashboard. */
  projects(org: { slug: string; acronym: string } | null): PageChrome {
    return {
      label: org ? `${org.acronym} projects` : 'Projects',
      section: 'dashboard',
      trail: [DASHBOARD, here(org ? `${org.acronym} projects` : 'Projects')],
      parent: toDestination(DASHBOARD),
    };
  },

  /** /dashboard/projects/new?org= → parent the organization's projects. */
  newProject(org: { slug: string; acronym: string } | null): PageChrome {
    const list = projectsCrumb(org);
    return {
      section: 'dashboard',
      trail: [DASHBOARD, list, here('New project')],
      parent: toDestination(list),
    };
  },

  /** /projects/:id → parent its organization's projects. */
  project(org: { slug: string; acronym: string } | null, name: string | null): PageChrome {
    const list = projectsCrumb(org);
    return {
      section: 'dashboard',
      trail: [DASHBOARD, list, here(name ?? 'Project')],
      parent: toDestination(list),
    };
  },

  /** /dashboard/appeals: the decision queue, parent the Dashboard. */
  appeals(): PageChrome {
    return {
      section: 'dashboard',
      trail: [DASHBOARD, here('Appeals')],
      parent: toDestination(DASHBOARD),
    };
  },

  /**
   * /dashboard/appeals/new: from a blocked project, parent that project; from a freeze on
   * the dashboard, parent the Dashboard.
   */
  submitAppeal(project: { id: string; name: string } | null): PageChrome {
    const projectCrumb = project && { label: project.name, href: `/projects/${project.id}` };
    return {
      label: 'Submit an appeal',
      section: 'dashboard',
      trail: [DASHBOARD, ...(projectCrumb ? [projectCrumb] : []), here('Appeal')],
      parent: toDestination(projectCrumb ?? DASHBOARD),
    };
  },

  /** Sign-in and its siblings: no trail, nothing to go back to. */
  bare(): PageChrome {
    return { section: null, trail: [], parent: null };
  },
};
