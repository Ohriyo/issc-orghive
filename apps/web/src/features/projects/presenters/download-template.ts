import {
  PROJECT_TASK_LABELS,
  type ProjectTaskType,
  type TaskTemplateRequest,
} from '@orghive/shared';
import { apiPostForBlob } from '@/lib/api';

export type TemplateFormat = NonNullable<TaskTemplateRequest['format']>;

/** "TAG Project Proposal template.docx"; a letter adds its label. */
export function templateFilename(
  acronym: string,
  type: ProjectTaskType,
  format: TemplateFormat,
  label?: string,
): string {
  const name = [acronym, PROJECT_TASK_LABELS[type], label, 'template']
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, '-');
  return `${name}.${format}`;
}

/** Saves a file in the browser. */
function save(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A task's template, pre-filled and carrying its QR code (spec section 6). A one-file task
 * gets the same code every time; each Communication Letter gets its own, so its label is sent.
 */
export async function downloadTaskTemplate(
  projectId: string,
  type: ProjectTaskType,
  request: { format: TemplateFormat; label?: string },
  acronym: string,
): Promise<void> {
  const blob = await apiPostForBlob(`/projects/${projectId}/tasks/${type}/template`, request);
  save(templateFilename(acronym, type, request.format, request.label), blob);
}
