import { describe, expect, it } from 'vitest';
import type { OrgShowcase } from '@orghive/shared';
import type { OrgPostSectionsState } from '@/features/posts/presenters/use-org-post-sections';
import { fillInChecklist, presentSections } from './org-page-layout';
import type { ConstitutionModel } from './use-constitution';
import { firstProjects, ordinal, toOrgShowcase, toRankBadge } from './use-org-showcase';
import { initialsOf, type OrganizationPageModel } from './use-organization-page';

const project = (id: string, date: string) => ({
  id,
  title: `Project ${id}`,
  date,
  location: 'CEA',
  beneficiaries: 'Students',
  files: [{ documentId: '0195f3c0-0000-7000-8000-0000000000d1', label: 'Project Proposal' }],
});

const SHOWCASE: OrgShowcase = {
  rank: { board: 'CSC', rank: 2, academicYear: '2026-2027', semester: 'first', status: 'final' },
  projectSemesters: [
    { academicYear: '2026-2027', semester: 'first', projects: [project('a', '2026-09-15'), project('b', '2026-08-23')] },
    { academicYear: '2025-2026', semester: 'second', projects: [project('c', '2026-03-02'), project('d', '2026-02-10')] },
  ],
  documents: [
    {
      id: '0195f3c0-0000-7000-8000-0000000000d2',
      title: 'CE Week report',
      typeName: 'Accomplishment report',
      createdAt: '2026-09-25T02:00:00.000Z',
    },
  ],
  publicDocumentCount: 24,
};

describe('the showcase', () => {
  it('names places the way people say them', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd',
    ]);
  });

  it('shapes the badge and links to its own board', () => {
    expect(toRankBadge(SHOWCASE.rank!)).toEqual({
      label: '2nd on the CSC leaderboard',
      detail: '1st semester 2026-2027, final',
      rank: 2,
      href: '/leaderboard?board=csc',
    });
    expect(toRankBadge({ ...SHOWCASE.rank!, board: 'SBO' }).href).toBe('/leaderboard');
  });

  it('labels semesters, links files to the viewer and counts projects', () => {
    const model = toOrgShowcase(SHOWCASE);
    expect(model.semesters.map((s) => s.label)).toEqual([
      '1st semester 2026-2027',
      '2nd semester 2025-2026',
    ]);
    expect(model.semesters[0]!.projects[0]).toMatchObject({
      date: 'Sep 15, 2026',
      files: [{ label: 'Project Proposal', href: '/documents/0195f3c0-0000-7000-8000-0000000000d1' }],
    });
    expect(model.projectCount).toBe(4);
    expect(model.documents[0]).toMatchObject({
      meta: 'Accomplishment report, Sep 25, 2026',
      href: '/documents/0195f3c0-0000-7000-8000-0000000000d2',
    });
    expect(toOrgShowcase({ ...SHOWCASE, rank: null }).rank).toBeNull();
  });

  it('shows the first few projects across semesters, keeping their headings', () => {
    const { semesters } = toOrgShowcase(SHOWCASE);
    expect(firstProjects(semesters, 3).map((s) => s.projects.map((p) => p.id))).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
    expect(firstProjects(semesters, 2)).toHaveLength(1);
  });

  it('takes officers’ initials from the first and last names', () => {
    expect(initialsOf('Maria Clara Santos')).toBe('MS');
    expect(initialsOf('  ana ')).toBe('A');
    expect(initialsOf('José P. Rizal Jr.')).toBe('JJ');
  });
});

describe('the page layout', () => {
  const page = {
    acronym: 'JPICE',
    name: 'Junior Philippine Institute of Civil Engineers',
    tagline: null,
    slug: 'jpice',
    description: null,
    about: null,
    cover: null,
    officers: [],
    contact: null,
    context: null,
    logoSrc: undefined,
  } as unknown as OrganizationPageModel;
  const none: ConstitutionModel = { status: 'none', canUpload: true };
  const posts = (isOwner: boolean, highlights = 0, updates = 0): OrgPostSectionsState => ({
    status: 'ready',
    sections: {
      highlights: Array.from({ length: highlights }, () => ({}) as never),
      updates: Array.from({ length: updates }, () => ({}) as never),
      updatesTotal: updates,
      updatesHref: '/orgs/jpice/updates',
      highlightsHref: '/orgs/jpice/updates?type=highlight',
      isOwner,
    },
  });

  it('lists only sections with something to show, in the template’s order', () => {
    expect(presentSections({ page, constitution: none })).toEqual(['about', 'documents']);
    expect(
      presentSections({
        page: { ...page, officers: [{ position: 'President', name: 'Ana' }], contact: { email: 'a@b.c', links: [] } },
        constitution: none,
        posts: posts(false, 2, 1),
        showcase: { status: 'ready', showcase: toOrgShowcase(SHOWCASE) },
      }),
    ).toEqual(['highlights', 'about', 'updates', 'projects', 'officers', 'documents', 'contact']);
  });

  it('keeps a section’s place while its data loads, but never the highlights band', () => {
    expect(
      presentSections({ page, constitution: none, posts: { status: 'loading' }, showcase: { status: 'loading' } }),
    ).toEqual(['about', 'updates', 'projects', 'documents']);
  });

  it('gives the own account a checklist until everything is filled in', () => {
    expect(fillInChecklist({ page, constitution: none, posts: posts(false) })).toBeNull();
    const items = fillInChecklist({ page, constitution: none, posts: posts(true, 1) })!;
    expect(items.map((i) => [i.label, i.done])).toEqual([
      ['Logo, tagline and description', false],
      ['Pin a highlight', true],
      ['Post your first update', false],
      ['List your officers', false],
      ['Upload your Constitution & By-laws', false],
      ['Add a contact email', false],
    ]);
    const full = {
      ...page,
      logoSrc: 'https://cdn.test/l.webp',
      tagline: 'T',
      description: [],
      officers: [{ position: 'P', name: 'N' }],
      contact: { email: 'a@b.c', links: [] },
    } as unknown as OrganizationPageModel;
    const ready = { status: 'ready' } as ConstitutionModel;
    expect(fillInChecklist({ page: full, constitution: ready, posts: posts(true, 1, 1) })).toBeNull();
  });
});
