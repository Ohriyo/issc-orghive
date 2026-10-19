import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  documentVersionListResponseSchema,
  downloadUrlResponseSchema,
  organizationDetailSchema,
  type DocumentVersion,
} from '@orghive/shared';
import { useActingAs, type ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { isOwnOrganization, useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { uploadErrorMessage, uploadNewVersion } from './upload-version';

export type ReuploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string; progress: number }
  | { status: 'saving'; filename: string }
  | { status: 'done'; filename: string }
  | { status: 'error'; message: string };

/** "Uploaded by JPICE · acting as Juan Dela Cruz": for the organization's own account only. */
export function uploadedByLine(orgAcronym: string, actingAs: string | null): string | null {
  return actingAs ? `Uploaded by ${orgAcronym} · acting as ${actingAs}` : null;
}

export interface VersionRow extends DocumentVersion {
  /** Who uploaded it for the account; null unless the viewer is the owning organization. */
  uploadedBy: string | null;
}

export interface DocumentFilesModel {
  versions: VersionRow[] | undefined;
  versionsError: boolean;
  /** Opens a signed download link for one version; resolves with an error message, if any. */
  download: (versionId: string) => Promise<string | undefined>;
  canReupload: boolean;
  /** The owning organization, e.g. "JPICE". */
  orgAcronym: string;
  /** Who is uploading a new version for the account. */
  actingAs: ActingAsModel;
  reupload: ReuploadState;
  /** Uploads a file as the next version of the document. */
  uploadVersion: (file: File) => Promise<void>;
}

/**
 * Presenter for a document's files: every version (old ones stay downloadable), signed
 * downloads, and re-upload for the organization's officers. While a version is being
 * scanned the list refreshes every few seconds.
 */
export function useDocumentFiles(
  documentId: string,
  org: { slug: string } | undefined,
): DocumentFilesModel {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [reupload, setReupload] = useState<ReuploadState>({ status: 'idle' });
  const actingAs = useActingAs();

  const versions = useQuery({
    queryKey: ['documents', 'versions', documentId],
    queryFn: () =>
      api.get(`/documents/${documentId}/versions`, { schema: documentVersionListResponseSchema }),
    refetchInterval: (query) =>
      query.state.data?.versions.some((v) => v.scanStatus === 'pending') ? 3000 : false,
    staleTime: 30_000,
  });
  const orgDetail = useQuery({
    queryKey: queryKeys.organizations.detail(org?.slug ?? ''),
    queryFn: () => api.get(`/organizations/${org!.slug}`, { schema: organizationDetailSchema }),
    enabled: !!org,
    staleTime: 5 * 60_000,
  });

  const orgId = orgDetail.data?.id;
  const canReupload = isOwnOrganization(user, { id: orgId });

  async function download(versionId: string) {
    try {
      const link = await api.get(`/documents/${documentId}/versions/${versionId}/download-url`, {
        schema: downloadUrlResponseSchema,
      });
      // A signed, 5-minute link served as an attachment: the browser saves the file.
      window.location.assign(link.url);
      return undefined;
    } catch (error) {
      return uploadErrorMessage(error);
    }
  }

  async function uploadVersion(file: File) {
    const name = actingAs.take();
    if (!name) return;
    try {
      await uploadNewVersion(org!.slug, documentId, file, name, (step) =>
        setReupload({ ...step, filename: file.name }),
      );
      setReupload({ status: 'done', filename: file.name });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents', 'versions', documentId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.documents.detail(documentId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    } catch (error) {
      setReupload({ status: 'error', message: uploadErrorMessage(error) });
    }
  }

  const orgAcronym = orgDetail.data?.acronym ?? '';
  return {
    versions: versions.data?.versions.map((v) => ({
      ...v,
      uploadedBy: uploadedByLine(orgAcronym, v.actingAs),
    })),
    versionsError: versions.isError,
    download,
    canReupload,
    orgAcronym,
    actingAs,
    reupload,
    uploadVersion,
  };
}
