import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardResponseSchema,
  daysBetween,
  manilaDate,
  PROJECT_STATUSES,
  PROJECT_TASK_LABELS,
  SEMESTER_LABELS,
  TERM_ENDING_SOON_DAYS,
  type ProjectStatus,
  type SemesterSummary,
  type DashboardActivity,
  type DashboardOrganization,
  type DashboardResponse,
  type DashboardTerm,
  type DocumentStatus,
  type DocumentSummary,
  type DocumentVisibility,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import {
  uploadErrorMessage,
  uploadNewVersion,
} from '@/features/documents/presenters/upload-version';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const ONE_MINUTE = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormat = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
/** Deadlines are Manila calendar days, whatever the viewer's time zone. */
const deadlineFormat = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeZone: 'Asia/Manila',
});
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * The four tiles: who can see the organization's available documents, then uploads the
 * virus scan blocked. Nothing waits for a review.
 */
export const TILE_KEYS = ['public', 'governing', 'private', 'quarantined'] as const;
export type TileKey = (typeof TILE_KEYS)[number];
export const TILE_LABELS: Record<TileKey, string> = {
  public: 'Public',
  governing: 'Governing bodies',
  private: 'Private',
  quarantined: 'Blocked by scan',
};

export type OrgRef = DashboardOrganization['organization'];

export interface StatTile {
  key: TileKey;
  label: string;
  count: number;
  href: string;
  /** Something needs the user: a blocked upload to replace. */
  alert: boolean;
}

export type ReviseState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'saving' }
  | { status: 'done' }
  | { status: 'error'; message: string };

/** One of the user's own uploads the virus scan blocked: they can upload a clean copy. */
export interface AttentionItem {
  id: string;
  title: string;
  typeLabel: string;
  href: string;
  revise: ReviseState;
}

export interface ActivityItem {
  id: string;
  kind: DashboardActivity['kind'];
  /** "Juan Dela Cruz uploaded version 2 of" */
  lead: string;
  documentTitle: string;
  /** Null when the document has since been deleted. */
  documentHref: string | null;
  at: string;
  ago: string;
}

export interface RecentDocument {
  id: string;
  title: string;
  href: string;
  status: DocumentStatus;
  date: string;
}

/** An extension point: each role that has extra work adds a panel here. */
export type RolePanel = { kind: 'admin' | 'appeals' | 'overview'; href: string };

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
};

/** "This semester": the organization's projects by status and its next deadlines. */
export interface SemesterView {
  /** "1st semester, 2026-2027". */
  label: string;
  counts: { status: ProjectStatus; label: string; count: number; href: string }[];
  deadlines: {
    key: string;
    task: string;
    projectName: string;
    href: string;
    dueAt: string;
    /** "Oct 24, 2026". */
    dueLabel: string;
    /** "today", "tomorrow", "in 8 days". */
    when: string;
    /** Within three days: the view marks it. */
    soon: boolean;
  }[];
  projectsHref: string;
}

export interface TermInfo {
  label: string;
  daysLeft: number;
  endingSoon: boolean;
}

export interface SelectedOrganization {
  org: OrgRef;
  roles: { label: string; title: string | null }[];
  term: TermInfo | null;
  tiles: StatTile[];
  /** Nothing filed yet: the page shows a welcome instead of empty sections. */
  isEmpty: boolean;
  uploadHref: string | null;
  paperworksHref: string;
  documentsHref: string;
  canRevise: boolean;
  /** The user's own uploads the virus scan blocked. */
  quarantined: AttentionItem[];
  activity: ActivityItem[];
  /** Shown when there is no recorded activity yet. */
  recentDocuments: RecentDocument[];
  /** Set for the organization's officers only. */
  semester: SemesterView | null;
}

export type DashboardModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      greeting: string;
      organizations: OrgRef[];
      selected: SelectedOrganization | null;
      selectOrganization: (id: string) => void;
      revise: (documentId: string, file: File) => Promise<void>;
      panels: RolePanel[];
    };

/** "Good morning" before noon, "Good afternoon" before 6 pm, then "Good evening". */
export function greetingFor(name: string, at: Date): string {
  const hour = at.getHours();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(/\s+/)[0] ?? name}`;
}

/** Days from today until the last day of the term (0 = it ends today). */
export function daysUntil(isoDay: string, today: Date): number {
  const [y, m, d] = isoDay.split('-').map(Number) as [number, number, number];
  const end = Date.UTC(y, m - 1, d);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / DAY_MS);
}

/** The account's current officer term; null when there is none or it is open-ended. */
export function termOf(term: DashboardTerm | null, today: Date): TermInfo | null {
  if (!term?.termEnd) return null;
  const [y, m, d] = term.termEnd.split('-').map(Number) as [number, number, number];
  const daysLeft = daysUntil(term.termEnd, today);
  return {
    label: `Term ends ${dateFormat.format(new Date(y, m - 1, d))}`,
    daysLeft,
    endingSoon: daysLeft < TERM_ENDING_SOON_DAYS,
  };
}

/** "3 hours ago", "yesterday", "2 weeks ago". */
export function timeAgo(iso: string, now: Date): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86400],
    ['month', 30 * 86400],
    ['week', 7 * 86400],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** The sentence before the document title, in plain words. */
export function activityLead(entry: DashboardActivity): string {
  const who = entry.actorName ?? 'Someone';
  const ofVersion = entry.version && entry.version > 1 ? ` version ${entry.version} of` : '';
  switch (entry.kind) {
    case 'upload':
      return `${who} uploaded${ofVersion}`;
    case 'quarantine':
      return `The virus scan blocked${ofVersion || ' the file of'}`;
    case 'archive':
      return `${who} archived`;
    case 'restore':
      return `${who} restored`;
    case 'visibility_change':
      return `${who} changed who can see`;
  }
}

export function documentsHref(
  slug: string,
  status?: DocumentStatus,
  visibility?: DocumentVisibility,
): string {
  const params = new URLSearchParams({ org: slug });
  if (status) params.set('status', status);
  if (visibility) params.set('visibility', visibility);
  return `/dashboard/documents?${params.toString()}`;
}

function tileHref(slug: string, key: TileKey): string {
  return key === 'quarantined'
    ? documentsHref(slug, 'quarantined')
    : documentsHref(slug, 'available', key);
}

function storageKey(userId: string) {
  return `orghive:dashboard:org:${userId}`;
}

/** The last organization chosen on this device. Storage can be unavailable; then none. */
function readRemembered(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function remember(userId: string | undefined, orgId: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), orgId);
  } catch {
    // A private window or blocked storage: the choice lasts for this visit only.
  }
}

function toRecent(doc: DocumentSummary): RecentDocument {
  return {
    id: doc.id,
    title: doc.title,
    href: `/documents/${doc.id}`,
    status: doc.status,
    date: doc.createdAt,
  };
}

/** Whether the account decides appeals: a CSC or the ISSC (the server's appeal-rules.ts). */
export function decidesAppeals(data: DashboardResponse): boolean {
  return data.decidesAppeals;
}

export function rolePanels(data: DashboardResponse): RolePanel[] {
  const panels: RolePanel[] = [];
  if (decidesAppeals(data)) panels.push({ kind: 'appeals', href: '/dashboard/appeals' });
  if (data.canSeeCompliance) panels.push({ kind: 'overview', href: '/dashboard/compliance' });
  if (data.isIssc) panels.push({ kind: 'admin', href: '/admin' });
  return panels;
}

/** Shapes "This semester" for the view; deadlines are counted in Manila calendar days. */
export function toSemesterView(summary: SemesterSummary, orgSlug: string, now: Date): SemesterView {
  const today = manilaDate(now);
  const projectsHref = `/dashboard/projects?org=${orgSlug}`;
  return {
    label: `${SEMESTER_LABELS[summary.semester]}, ${summary.academicYear}`,
    counts: PROJECT_STATUSES.map((status) => ({
      status,
      label: PROJECT_STATUS_LABELS[status],
      count: summary.counts[status] ?? 0,
      href: projectsHref,
    })),
    deadlines: summary.nextDeadlines.map((d) => {
      const days = daysBetween(today, manilaDate(new Date(d.dueAt)));
      return {
        key: `${d.projectId}:${d.task}`,
        task: PROJECT_TASK_LABELS[d.task],
        projectName: d.projectName,
        href: `/projects/${d.projectId}`,
        dueAt: d.dueAt,
        dueLabel: deadlineFormat.format(new Date(d.dueAt)),
        when: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
        soon: days <= 3,
      };
    }),
    projectsHref,
  };
}

/** Shapes one organization of the response for the view. */
export function selectOrganization(
  data: DashboardResponse,
  orgId: string,
  revisions: Record<string, ReviseState>,
  now: Date,
): SelectedOrganization | null {
  const found = data.organizations.find((o) => o.organization.id === orgId);
  if (!found) return null;
  const { organization: org, counts } = found;
  // The dashboard lists the account's own organization only: it manages it.
  const isOfficer = true;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const officer = data.term?.officerInCharge;

  return {
    org,
    roles: officer ? [{ label: officer.name, title: officer.position }] : [],
    term: termOf(data.term, now),
    tiles: TILE_KEYS.map((key) => ({
      key,
      label: TILE_LABELS[key],
      count: counts[key],
      href: tileHref(org.slug, key),
      alert: key === 'quarantined' && counts[key] > 0,
    })),
    isEmpty: total === 0,
    uploadHref: isOfficer ? `/orgs/${org.slug}/paperworks/upload` : null,
    paperworksHref: `/orgs/${org.slug}/paperworks`,
    documentsHref: documentsHref(org.slug),
    canRevise: isOfficer,
    quarantined: found.quarantined.map((doc) => ({
      id: doc.id,
      title: doc.title,
      typeLabel: doc.type.name,
      href: `/documents/${doc.id}`,
      revise: revisions[doc.id] ?? { status: 'idle' },
    })),
    activity: found.activity.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      lead: activityLead(entry),
      documentTitle: entry.document?.title ?? 'a document that was deleted',
      documentHref: entry.document ? `/documents/${entry.document.id}` : null,
      at: entry.at,
      ago: timeAgo(entry.at, now),
    })),
    recentDocuments: found.recentDocuments.map(toRecent),
    semester: found.semester ? toSemesterView(found.semester, org.slug, now) : null,
  };
}

/** The signed-in dashboard: GET /me/dashboard, the chosen organization and revise uploads. */
export function useDashboard(now: () => Date = () => new Date()): DashboardModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [chosen, setChosen] = useState<string | null>(() => readRemembered(user?.id));
  const [revisions, setRevisions] = useState<Record<string, ReviseState>>({});

  const query = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get('/me/dashboard', { schema: dashboardResponseSchema }),
    staleTime: ONE_MINUTE,
  });

  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };

  const data = query.data;
  const organizations = data.organizations.map((o) => o.organization);
  const selectedId = organizations.find((o) => o.id === chosen)?.id ?? organizations[0]?.id ?? null;
  const at = now();

  async function revise(documentId: string, file: File) {
    const slug = data.organizations.find((o) => o.quarantined.some((doc) => doc.id === documentId))
      ?.organization.slug;
    if (!slug) return;
    const set = (state: ReviseState) => setRevisions((all) => ({ ...all, [documentId]: state }));
    try {
      await uploadNewVersion(slug, documentId, file, set);
      set({ status: 'done' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
      ]);
    } catch (error) {
      set({ status: 'error', message: uploadErrorMessage(error) });
    }
  }

  return {
    status: 'ready',
    greeting: greetingFor(user?.name ?? '', at),
    organizations,
    selected: selectedId ? selectOrganization(data, selectedId, revisions, at) : null,
    selectOrganization: (id) => {
      setChosen(id);
      remember(user?.id, id);
    },
    revise,
    panels: rolePanels(data),
  };
}
