import { useQuery } from '@tanstack/react-query';
import {
  constitutionResponseSchema,
  documentSummarySchema,
  type ConstitutionResponse,
} from '@orghive/shared';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const FIVE_MINUTES = 5 * 60_000;
const longDate = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'UTC' });

/** "September 15, 2026" from a Manila calendar date ("2026-09-15"). */
export function formatCalendarDate(isoDate: string): string {
  return longDate.format(new Date(`${isoDate}T00:00:00Z`));
}

export interface ConstitutionEntry {
  id: string;
  version: number;
  /** "Adopted September 1, 2026" or "Amended October 3, 2026"; the upload date if none. */
  label: string;
  note: string | null;
  isCurrent: boolean;
  /** The viewer for this version: the current one plainly, older ones with ?version=. */
  href: string;
  /** Owner only: still being scanned or refused (everyone else sees clean versions). */
  state: 'scanning' | 'refused' | 'ready';
  /** Owner only: "Uploaded by …". */
  actingAs: string | null;
}

export type ConstitutionModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** Not uploaded yet (or, for visitors, not through the scan yet). */
  | { status: 'none'; canUpload: boolean }
  | {
      status: 'ready';
      readHref: string;
      /** "Last amended September 15, 2026", or "Adopted …" while it has one version. */
      dateLine: string | null;
      /** ISO date for <time>. */
      dateIso: string | null;
      /** Earlier versions, at most 3: the sheets stacked behind the current one. */
      layers: number;
      /** The watermarked page 1, once rendered. */
      thumbnail: string | null;
      history: ConstitutionEntry[];
      canUpload: boolean;
    };

type Constitution = NonNullable<ConstitutionResponse['constitution']>;

export function toConstitutionEntries(c: Constitution): ConstitutionEntry[] {
  return c.versions.map((v) => {
    const when = v.amendedOn ? formatCalendarDate(v.amendedOn) : null;
    const verb = v.version === 1 ? 'Adopted' : 'Amended';
    return {
      id: v.id,
      version: v.version,
      label: when ? `${verb} ${when}` : `Version ${v.version}`,
      note: v.note,
      isCurrent: v.isCurrent,
      href: v.isCurrent ? `/documents/${c.documentId}` : `/documents/${c.documentId}?version=${v.id}`,
      state:
        v.scanStatus === 'pending' ? 'scanning' : v.scanStatus === 'clean' ? 'ready' : 'refused',
      actingAs: v.actingAs,
    };
  });
}

export function constitutionDateLine(c: Constitution): string | null {
  if (!c.lastAmendedOn) return null;
  const current = c.versions.find((v) => v.isCurrent);
  const verb = current?.version === 1 ? 'Adopted' : 'Last amended';
  return `${verb} ${formatCalendarDate(c.lastAmendedOn)}`;
}

/** The raw constitution query, shared by the public page and the profile editor. */
export function useConstitutionQuery(slug: string) {
  return useQuery({
    queryKey: queryKeys.documents.constitution(slug),
    queryFn: () =>
      api.get(`/organizations/${slug}/constitution`, { schema: constitutionResponseSchema }),
    enabled: slug !== '',
    staleTime: FIVE_MINUTES,
    // While a version is being scanned (owner only), check back for the result.
    refetchInterval: (q) =>
      q.state.data?.constitution?.versions.some((v) => v.scanStatus === 'pending') ? 4000 : false,
  });
}

/**
 * The organization page's Constitution & By-laws: always public, view-only for everyone
 * but its organization, with its amendment history. Page 1's watermarked thumbnail comes
 * from the document itself.
 */
export function useConstitution(slug: string): ConstitutionModel {
  const { user } = useAuth();
  const canUpload = isOwnOrganization(user, { slug });
  const query = useConstitutionQuery(slug);
  const documentId = query.data?.constitution?.documentId;
  const doc = useQuery({
    queryKey: queryKeys.documents.detail(documentId ?? ''),
    queryFn: () => api.get(`/documents/${documentId}`, { schema: documentSummarySchema }),
    enabled: !!documentId,
    staleTime: 60_000,
  });

  if (query.isPending) return { status: 'loading' };
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  const c = query.data.constitution;
  if (!c) return { status: 'none', canUpload };
  return {
    status: 'ready',
    readHref: `/documents/${c.documentId}`,
    dateLine: constitutionDateLine(c),
    dateIso: c.lastAmendedOn,
    layers: Math.min(3, c.versions.filter((v) => !v.isCurrent && v.scanStatus === 'clean').length),
    thumbnail: doc.data?.currentVersion?.thumbnailUrl ?? null,
    history: toConstitutionEntries(c),
    canUpload,
  };
}
