import {
  ErrorCode,
  isCheckedTask,
  isMultiFileTask,
  PROJECT_TASK_LABELS,
  type ProjectTaskType,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { OfficeConverter } from '#src/lib/office-converter';
import { generateTaskCode, type TaskQr } from '#src/lib/task-qr';
import { buildTaskTemplate, DOCX_MIME } from '#src/lib/task-template';
import type { TaskCodeRepository } from '#src/repositories/task-code.repository';
import type { OrgRef } from './access.service';

export interface TaskTemplateFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

export interface TaskTemplateServiceDeps {
  codes: Pick<TaskCodeRepository, 'findTemplateTask' | 'findForTask' | 'create'>;
  /** Null when TASK_QR_SECRET is not set: no template can be made. */
  qr: TaskQr | null;
  converter: Pick<OfficeConverter, 'toPdf'>;
}

/** "Project Proposal - Tree Planting - OH-7K3P-PROP.docx", safe in a header and on disk. */
function filenameOf(type: ProjectTaskType, projectName: string, code: string, ext: string) {
  const name = `${PROJECT_TASK_LABELS[type]} - ${projectName}`
    .replace(/[^\p{L}\p{N} .,()&'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return `${name} - ${code}.${ext}`;
}

/**
 * Project task templates (docs/PROJECT_WORKFLOW_SPEC.md, section 6): the official form on the
 * NwSSU letterhead, pre-filled, with the task's QR code and short code on every page. Only the
 * organization's own account downloads them (requireOwnOrg). A one-file task always gets the
 * same code; each Communication Letter gets its own, labelled, every time one is downloaded.
 */
export function createTaskTemplateService({ codes, qr, converter }: TaskTemplateServiceDeps) {
  return {
    async template(
      org: OrgRef,
      projectId: string,
      type: ProjectTaskType,
      request: { label?: string; format: 'docx' | 'pdf' },
    ): Promise<TaskTemplateFile> {
      if (!isCheckedTask(type)) {
        throw AppError.notFound('This task has no template');
      }
      const task = await codes.findTemplateTask(projectId, type);
      if (!task || task.project.deletedAt || task.project.organizationId !== org.id) {
        throw AppError.notFound('Project task not found');
      }
      if (!qr) {
        throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Task templates are not set up yet');
      }
      const multi = isMultiFileTask(type);
      if (multi && !request.label) {
        throw new AppError(
          400,
          ErrorCode.VALIDATION_ERROR,
          'Name this letter first, e.g. "Letter to the Dean"',
        );
      }
      const code =
        (!multi && (await codes.findForTask(task.id))) ||
        (await codes.create({ taskId: task.id, label: multi ? request.label! : null }, () =>
          generateTaskCode(type),
        ));

      const { project } = task;
      const docx = await buildTaskTemplate({
        type,
        organization: project.organization,
        college: project.organization.college?.name ?? null,
        project: {
          name: project.name,
          targetDate: project.targetDate.toISOString().slice(0, 10),
          location: project.location,
          beneficiaries: project.beneficiaries,
        },
        label: code.label,
        code: code.code,
        qrContent: qr.contentOf({
          code: code.code,
          taskId: task.id,
          organizationId: project.organizationId,
        }),
      });
      if (request.format === 'docx') {
        return {
          filename: filenameOf(type, project.name, code.code, 'docx'),
          contentType: DOCX_MIME,
          body: docx,
        };
      }
      return {
        filename: filenameOf(type, project.name, code.code, 'pdf'),
        contentType: 'application/pdf',
        body: await converter.toPdf(docx, DOCX_MIME),
      };
    },
  };
}

export type TaskTemplateService = ReturnType<typeof createTaskTemplateService>;
