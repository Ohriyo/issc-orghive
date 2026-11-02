import {
  contentTypeForFilename,
  isCheckedTask,
  MAX_UPLOAD_BYTES,
  projectDetailSchema,
  taskUploadContentTypesFor,
  uploadUrlResponseSchema,
  type DocumentVisibility,
  type FinancialFiguresInput,
  type ProjectDetail,
  type ProjectTaskType,
} from '@orghive/shared';
import { RefusedFileError } from '@/features/documents/presenters/upload-version';
import { api } from '@/lib/api';
import { putWithProgress } from '@/lib/upload-put';

export type TaskUploadStep = { status: 'uploading'; progress: number } | { status: 'saving' };

export const TASK_FILE_TYPES_LABEL = 'PDF, JPG or PNG, up to 25 MB';
/** Checked tasks (spec section 6): the signed template, scanned or saved as a PDF. */
export const CHECKED_TASK_FILE_TYPES_LABEL = 'The signed template as a PDF, up to 25 MB';

export function taskFileTypesLabel(type: ProjectTaskType): string {
  return isCheckedTask(type) ? CHECKED_TASK_FILE_TYPES_LABEL : TASK_FILE_TYPES_LABEL;
}

/**
 * Files a task: an upload URL for that task, the bytes straight to storage (never through
 * Node), then the task's document with the visibility the officer chose. The task is
 * submitted once the virus scan (and, for checked tasks, the integrity checks) pass. A
 * Financial Report also sends its totals; a Communication Letter or other pre-event document
 * its label (or the file it replaces); a file whose QR is damaged, the code typed from it.
 */
export async function uploadTaskFile(
  projectId: string,
  type: ProjectTaskType,
  file: File,
  visibility: DocumentVisibility,
  actingAs: string,
  onStep: (step: TaskUploadStep) => void,
  figures?: FinancialFiguresInput,
  /**
   * Multi-file tasks: a new file's label, or the file a new version is for. `taskCode`: the
   * short code under a damaged QR.
   */
  target?: { label?: string; documentId?: string; taskCode?: string },
): Promise<ProjectDetail> {
  const contentType = contentTypeForFilename(file.name);
  const allowed = (taskUploadContentTypesFor(type) as readonly string[]).includes(
    contentType ?? '',
  );
  if (!contentType || !allowed || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new RefusedFileError(
      isCheckedTask(type)
        ? 'Upload the signed template as a PDF, up to 25 MB.'
        : `Use a ${TASK_FILE_TYPES_LABEL}.`,
    );
  }
  onStep({ status: 'uploading', progress: 0 });
  const url = await api.post(
    `/projects/${projectId}/tasks/${type}/upload-url`,
    { filename: file.name, contentType, sizeBytes: file.size },
    { schema: uploadUrlResponseSchema },
  );
  await putWithProgress(url.url, file, url.headers, (fraction) =>
    onStep({ status: 'uploading', progress: Math.round(fraction * 100) }),
  );
  onStep({ status: 'saving' });
  return api.post(
    `/projects/${projectId}/tasks/${type}/documents`,
    {
      uploadKey: url.uploadKey,
      visibility,
      actingAs,
      ...(figures && { figures }),
      ...(target?.label !== undefined && { label: target.label }),
      ...(target?.documentId !== undefined && { documentId: target.documentId }),
      ...(target?.taskCode !== undefined && { taskCode: target.taskCode }),
    },
    { schema: projectDetailSchema },
  );
}
