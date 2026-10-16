import { useQuery } from '@tanstack/react-query';
import { documentSummarySchema, type DocumentSummary } from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { SEMESTER_LABELS } from '@/features/paperworks/presenters/use-paperworks';

export interface DocumentPageModel {
  title: string;
  typeLabel: string;
  description: string | null;
  org: { slug: string; acronym: string; name: string; href: string; paperworksHref: string };
  /** "2026-2027, First semester", or just the year. */
  term: string;
  status: DocumentSummary['status'];
  /** ISO date: when it was submitted for review, or created. */
  date: string;
  hasFile: boolean;
}

export function toDocumentPage(doc: DocumentSummary): DocumentPageModel {
  return {
    title: doc.title,
    typeLabel: doc.type.name,
    description: doc.description,
    org: {
      slug: doc.organization.slug,
      acronym: doc.organization.acronym,
      name: doc.organization.name,
      href: `/orgs/${doc.organization.slug}`,
      paperworksHref: `/orgs/${doc.organization.slug}/paperworks`,
    },
    term: doc.semester ? `${doc.academicYear}, ${SEMESTER_LABELS[doc.semester]}` : doc.academicYear,
    status: doc.status,
    date: doc.submittedAt ?? doc.createdAt,
    hasFile: doc.currentVersion !== null,
  };
}

export type DocumentPageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; page: DocumentPageModel };

/**
 * Presenter for /documents/:id. A document the viewer may not see is a 404 from the API,
 * so it reads as not found here too (its existence is not revealed).
 */
export function useDocument(id: string): DocumentPageState {
  const query = useQuery({
    queryKey: queryKeys.documents.detail(id),
    queryFn: () => api.get(`/documents/${id}`, { schema: documentSummarySchema }),
    select: toDocumentPage,
    staleTime: 60_000,
  });

  if (query.data) return { status: 'ready', page: query.data };
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
