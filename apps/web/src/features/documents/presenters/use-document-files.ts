import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  documentVersionListResponseSchema,
  downloadUrlResponseSchema,
  organizationDetailSchema,
  type DocumentVersion,
} from '@orghive/shared';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { uploadErrorMessage, uploadNewVersion } from './upload-version';

export type ReuploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string; progress: number }
  | { status: 'saving'; filename: string }
  | { status: 'done'; filename: string }
  | { status: 'error'; message: string };

export interface DocumentFilesModel {
  versions: DocumentVersion[] | undefined;
  versionsError: boolean;
  /** Opens a signed download link for one version; resolves with an error message, if any. */
  download: (versionId: string) => Promise<string | undefined>;
  canReupload: boolean;
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
  const canReupload =
    !!orgId &&
    !!user?.roles.some(
      (role) => (role.orgId === orgId && role.role === 'officer') || role.role === 'admin',
    );

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
    try {
      await uploadNewVersion(org!.slug, documentId, file, (step) =>
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

  return {
    versions: versions.data?.versions,
    versionsError: versions.isError,
    download,
    canReupload,
    reupload,
    uploadVersion,
  };
}
