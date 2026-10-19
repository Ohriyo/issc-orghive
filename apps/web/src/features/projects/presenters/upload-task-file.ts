import {
  contentTypeForFilename,
  MAX_UPLOAD_BYTES,
  projectDetailSchema,
  TASK_UPLOAD_CONTENT_TYPES,
  uploadUrlResponseSchema,
  type DocumentVisibility,
  type ProjectDetail,
  type ProjectTaskType,
} from '@orghive/shared';
import { RefusedFileError } from '@/features/documents/presenters/upload-version';
import { api } from '@/lib/api';
import { putWithProgress } from '@/lib/upload-put';

export type TaskUploadStep = { status: 'uploading'; progress: number } | { status: 'saving' };

export const TASK_FILE_TYPES_LABEL = 'PDF, JPG or PNG, up to 25 MB';

/**
 * Files a task: an upload URL for that task, the bytes straight to storage (never through
 * Node), then the task's document with the visibility the officer chose. The task is
 * submitted once the virus scan passes.
 */
export async function uploadTaskFile(
  projectId: string,
  type: ProjectTaskType,
  file: File,
  visibility: DocumentVisibility,
  actingAs: string,
  onStep: (step: TaskUploadStep) => void,
): Promise<ProjectDetail> {
  const contentType = contentTypeForFilename(file.name);
  const allowed = (TASK_UPLOAD_CONTENT_TYPES as readonly string[]).includes(contentType ?? '');
  if (!contentType || !allowed || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new RefusedFileError(`Use a ${TASK_FILE_TYPES_LABEL}.`);
  }
  onStep({ status: 'uploading', progress: 0 });
  const target = await api.post(
    `/projects/${projectId}/tasks/${type}/upload-url`,
    { filename: file.name, contentType, sizeBytes: file.size },
    { schema: uploadUrlResponseSchema },
  );
  await putWithProgress(target.url, file, target.headers, (fraction) =>
    onStep({ status: 'uploading', progress: Math.round(fraction * 100) }),
  );
  onStep({ status: 'saving' });
  return api.post(
    `/projects/${projectId}/tasks/${type}/documents`,
    { uploadKey: target.uploadKey, visibility, actingAs },
    { schema: projectDetailSchema },
  );
}
