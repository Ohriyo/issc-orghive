import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  documentSummarySchema,
  type DocumentSummary,
  type DocumentVisibility,
} from '@orghive/shared';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { SEMESTER_LABELS } from '@/features/paperworks/presenters/use-paperworks';
import { useSetVisibility } from './use-set-visibility';

export interface DocumentPageModel {
  id: string;
  title: string;
  typeLabel: string;
  description: string | null;
  org: { slug: string; acronym: string; name: string; href: string; paperworksHref: string };
  /** "2026-2027, First semester", or just the year. */
  term: string;
  status: DocumentSummary['status'];
  visibility: DocumentVisibility;
  /** ISO date the document was uploaded. */
  date: string;
  hasFile: boolean;
}

export function toDocumentPage(doc: DocumentSummary): DocumentPageModel {
  return {
    id: doc.id,
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
    visibility: doc.visibility,
    date: doc.createdAt,
    hasFile: doc.currentVersion !== null,
  };
}

/** Who can see the document, and the control for the organization's officers. */
export interface VisibilityModel {
  /** Officers of the owning organization only; admins can view but not change it. */
  canChange: boolean;
  saving: boolean;
  error: string | undefined;
  change: (visibility: DocumentVisibility) => void;
}

export type DocumentPageState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; page: DocumentPageModel; visibility: VisibilityModel };

/**
 * Presenter for /documents/:id. A document the viewer may not see is a 404 from the API,
 * so it reads as not found here too (its existence is not revealed).
 */
export function useDocument(id: string): DocumentPageState {
  const { user } = useAuth();
  const setVisibility = useSetVisibility();
  const [visibilityError, setVisibilityError] = useState<string>();
  const query = useQuery({
    queryKey: queryKeys.documents.detail(id),
    queryFn: () => api.get(`/documents/${id}`, { schema: documentSummarySchema }),
    select: toDocumentPage,
    staleTime: 60_000,
  });

  if (query.data) {
    const page = query.data;
    const canChange = isOwnOrganization(user, { slug: page.org.slug });
    return {
      status: 'ready',
      page,
      visibility: {
        canChange,
        saving: setVisibility.pendingId === page.id,
        error: visibilityError,
        change: (next) => {
          setVisibilityError(undefined);
          void setVisibility.change(page.id, next).then(setVisibilityError);
        },
      },
    };
  }
  if (query.error instanceof ApiError && [400, 404].includes(query.error.status)) {
    return { status: 'not-found' };
  }
  if (query.isError) return { status: 'error', retry: () => void query.refetch() };
  return { status: 'loading' };
}
