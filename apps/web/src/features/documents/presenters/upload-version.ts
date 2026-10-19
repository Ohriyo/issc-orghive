import {
  contentTypeForFilename,
  documentVersionSchema,
  MAX_UPLOAD_BYTES,
  uploadUrlResponseSchema,
  type DocumentVersion,
} from '@orghive/shared';
import { ACCEPTED_TYPES_LABEL } from '@/features/uploads/presenters/use-upload-documents';
import { api, ApiError } from '@/lib/api';
import { putWithProgress } from '@/lib/upload-put';

/** A file that fails the shared allow-list before anything is sent. */
export class RefusedFileError extends Error {}

export type VersionUploadStep = { status: 'uploading'; progress: number } | { status: 'saving' };

/** Plain words for a failed upload; server details only for client errors. */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof RefusedFileError) return error.message;
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * Uploads `file` as the next version of a document: an upload URL from the API, the bytes
 * straight to storage (never through Node), then the version record. The new version
 * becomes current once the virus scan passes; nothing needs approving again.
 */
export async function uploadNewVersion(
  orgSlug: string,
  documentId: string,
  file: File,
  actingAs: string,
  onStep: (step: VersionUploadStep) => void,
): Promise<DocumentVersion> {
  const contentType = contentTypeForFilename(file.name);
  if (!contentType || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new RefusedFileError(`Use ${ACCEPTED_TYPES_LABEL}.`);
  }
  onStep({ status: 'uploading', progress: 0 });
  const target = await api.post(
    `/organizations/${orgSlug}/documents/upload-url`,
    { filename: file.name, contentType, sizeBytes: file.size },
    { schema: uploadUrlResponseSchema },
  );
  await putWithProgress(target.url, file, target.headers, (fraction) =>
    onStep({ status: 'uploading', progress: Math.round(fraction * 100) }),
  );
  onStep({ status: 'saving' });
  return api.post(
    `/documents/${documentId}/versions`,
    { uploadKey: target.uploadKey, actingAs },
    { schema: documentVersionSchema },
  );
}
