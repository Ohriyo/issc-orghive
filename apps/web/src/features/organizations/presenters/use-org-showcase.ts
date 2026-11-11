import { useQuery } from '@tanstack/react-query';
import {
  orgShowcaseSchema,
  SEMESTER_LABELS,
  SHOWCASE_PROJECTS_SHOWN,
  type OrgShowcase,
  type ShowcaseRank,
} from '@orghive/shared';
import { formatManilaDate } from '@/features/projects/presenters/project-format';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const TWO_MINUTES = 2 * 60_000;

export interface RankBadgeModel {
  /** "3rd on the SBO leaderboard". */
  label: string;
  /** "1st semester 2026-2027, provisional". */
  detail: string;
  rank: number;
  href: string;
}

export interface ShowcaseProjectModel {
  id: string;
  title: string;
  date: string;
  dateTime: string;
  location: string;
  beneficiaries: string;
  files: { label: string; href: string }[];
}

export interface ShowcaseSemesterModel {
  /** "1st semester 2026-2027". */
  label: string;
  projects: ShowcaseProjectModel[];
}

export interface ShowcaseDocumentModel {
  id: string;
  title: string;
  /** "Accomplishment report, Sep 25, 2026". */
  meta: string;
  href: string;
}

export interface OrgShowcaseModel {
  rank: RankBadgeModel | null;
  semesters: ShowcaseSemesterModel[];
  projectCount: number;
  /** Projects shown before "Show N earlier projects". */
  projectsShown: number;
  documents: ShowcaseDocumentModel[];
  publicDocumentCount: number;
}

export type OrgShowcaseState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; showcase: OrgShowcaseModel };

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

export function toRankBadge(rank: ShowcaseRank): RankBadgeModel {
  return {
    label: `${ordinal(rank.rank)} on the ${rank.board} leaderboard`,
    detail: `${SEMESTER_LABELS[rank.semester]} ${rank.academicYear}, ${rank.status}`,
    rank: rank.rank,
    href: rank.board === 'CSC' ? '/leaderboard?board=csc' : '/leaderboard',
  };
}

export function toOrgShowcase(data: OrgShowcase): OrgShowcaseModel {
  return {
    rank: data.rank ? toRankBadge(data.rank) : null,
    semesters: data.projectSemesters.map((group) => ({
      label: `${SEMESTER_LABELS[group.semester]} ${group.academicYear}`,
      projects: group.projects.map((p) => ({
        id: p.id,
        title: p.title,
        date: formatManilaDate(p.date),
        dateTime: p.date,
        location: p.location,
        beneficiaries: p.beneficiaries,
        files: p.files.map((f) => ({ label: f.label, href: `/documents/${f.documentId}` })),
      })),
    })),
    projectCount: data.projectSemesters.reduce((n, g) => n + g.projects.length, 0),
    projectsShown: SHOWCASE_PROJECTS_SHOWN,
    documents: data.documents.map((d) => ({
      id: d.id,
      title: d.title,
      meta: `${d.typeName}, ${formatManilaDate(d.createdAt)}`,
      href: `/documents/${d.id}`,
    })),
    publicDocumentCount: data.publicDocumentCount,
  };
}

/**
 * Presenter for /orgs/:slug's rank badge, Projects and Documents (GET
 * /organizations/:slug/showcase). Under the documents key, so any document mutation
 * refreshes it.
 */
export function useOrgShowcase(slug: string): OrgShowcaseState {
  const query = useQuery({
    queryKey: queryKeys.documents.showcase(slug),
    queryFn: () => api.get(`/organizations/${slug}/showcase`, { schema: orgShowcaseSchema }),
    select: toOrgShowcase,
    staleTime: TWO_MINUTES,
  });
  if (query.data) return { status: 'ready', showcase: query.data };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}

/** The first `limit` projects across semesters, keeping their semester headings. */
export function firstProjects(
  semesters: ShowcaseSemesterModel[],
  limit: number,
): ShowcaseSemesterModel[] {
  const out: ShowcaseSemesterModel[] = [];
  let left = limit;
  for (const semester of semesters) {
    if (left <= 0) break;
    const projects = semester.projects.slice(0, left);
    left -= projects.length;
    out.push({ ...semester, projects });
  }
  return out;
}
