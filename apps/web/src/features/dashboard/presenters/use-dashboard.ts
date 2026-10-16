import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dashboardResponseSchema,
  TERM_ENDING_SOON_DAYS,
  type DashboardActivity,
  type DashboardMembership,
  type DashboardOrganization,
  type DashboardResponse,
  type DocumentStatus,
  type DocumentSummary,
  type MembershipRole,
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
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export const ROLE_LABELS: Record<MembershipRole, string> = {
  officer: 'Officer',
  adviser: 'Adviser',
  admin: 'Admin',
};

/** The four tiles, in the order an officer works through them. */
export const TILE_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export type TileStatus = (typeof TILE_STATUSES)[number];
export const TILE_LABELS: Record<TileStatus, string> = {
  draft: 'Drafts',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Needs revision',
};

export type OrgRef = DashboardOrganization['organization'];

export interface StatTile {
  status: TileStatus;
  label: string;
  count: number;
  href: string;
}

export type ReviseState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'saving' }
  | { status: 'done' }
  | { status: 'error'; message: string };

export interface RevisionItem {
  id: string;
  title: string;
  typeLabel: string;
  href: string;
  remark: string | null;
  /** "Maria Santos, Oct 14, 2026"; null when no decision was recorded. */
  decidedBy: string | null;
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
export type RolePanel =
  | { kind: 'reviews'; pending: number; organizations: number; href: string }
  | { kind: 'admin'; href: string };

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
  needsRevision: RevisionItem[];
  activity: ActivityItem[];
  /** Shown when there is no recorded activity yet. */
  recentDocuments: RecentDocument[];
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

/** The latest term end among the user's memberships in one organization; null if open-ended. */
export function termOf(memberships: DashboardMembership[], today: Date): TermInfo | null {
  if (memberships.length === 0 || memberships.some((m) => m.termEnd === null)) return null;
  const last = memberships
    .map((m) => m.termEnd!)
    .sort()
    .at(-1)!;
  const [y, m, d] = last.split('-').map(Number) as [number, number, number];
  const daysLeft = daysUntil(last, today);
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
    case 'approve':
      return `${who} approved`;
    case 'reject':
      return `${who} rejected`;
    case 'quarantine':
      return `The virus scan blocked${ofVersion || ' the file of'}`;
    case 'archive':
      return `${who} archived`;
    case 'restore':
      return `${who} restored`;
  }
}

export function documentsHref(slug: string, status?: DocumentStatus): string {
  const params = new URLSearchParams({ org: slug });
  if (status) params.set('status', status);
  return `/dashboard/documents?${params.toString()}`;
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

export function rolePanels(data: DashboardResponse): RolePanel[] {
  const panels: RolePanel[] = [];
  if (data.reviews) {
    panels.push({ kind: 'reviews', ...data.reviews, href: '/dashboard/reviews' });
  }
  if (data.isAdmin) panels.push({ kind: 'admin', href: '/admin' });
  return panels;
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
  const mine = data.memberships.filter((m) => m.organizationId === org.id);
  const isOfficer = data.isAdmin || mine.some((m) => m.role === 'officer');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return {
    org,
    roles: mine.map((m) => ({ label: ROLE_LABELS[m.role], title: m.title })),
    term: termOf(mine, now),
    tiles: TILE_STATUSES.map((status) => ({
      status,
      label: TILE_LABELS[status],
      count: counts[status],
      href: documentsHref(org.slug, status),
    })),
    isEmpty: total === 0,
    uploadHref: isOfficer ? `/orgs/${org.slug}/paperworks/upload` : null,
    paperworksHref: `/orgs/${org.slug}/paperworks`,
    documentsHref: documentsHref(org.slug),
    canRevise: isOfficer,
    needsRevision: found.needsRevision.map((r) => ({
      id: r.document.id,
      title: r.document.title,
      typeLabel: r.document.type.name,
      href: `/documents/${r.document.id}`,
      remark: r.remark,
      decidedBy:
        r.decidedAt === null
          ? null
          : `${r.reviewerName ?? 'Reviewer'}, ${dateFormat.format(new Date(r.decidedAt))}`,
      revise: revisions[r.document.id] ?? { status: 'idle' },
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
    const slug = data.organizations.find((o) =>
      o.needsRevision.some((r) => r.document.id === documentId),
    )?.organization.slug;
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
