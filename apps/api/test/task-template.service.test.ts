import { describe, expect, it, vi } from 'vitest';
import type { ProjectTaskType } from '@orghive/shared';
import { createTaskQr } from '#src/lib/task-qr';
import { DOCX_MIME } from '#src/lib/task-template';
import type { TaskCodeRecord, TemplateTaskRecord } from '#src/repositories/task-code.repository';
import { createTaskTemplateService } from '#src/services/task-template.service';

const ORG = { id: 'org-tag', slug: 'tag' };
const qr = createTaskQr(Buffer.alloc(32, 9).toString('base64'));

function taskRecord(patch: Partial<TemplateTaskRecord['project']> = {}): TemplateTaskRecord {
  return {
    id: '0195f3c0-0000-7000-8000-0000000000c1',
    project: {
      name: 'Making Moves / 3D: Workshop',
      targetDate: new Date('2026-11-07T00:00:00Z'),
      location: 'Lab 4',
      beneficiaries: 'BSEMC students',
      organizationId: ORG.id,
      deletedAt: null,
      organization: {
        name: 'The Animation Guild',
        acronym: 'TAG',
        type: 'SBO',
        college: { name: 'College of Computing and Information Sciences' },
      },
      ...patch,
    },
  };
}

function setup({
  task = taskRecord(),
  existing = null,
  withQr = true,
}: { task?: TemplateTaskRecord | null; existing?: TaskCodeRecord | null; withQr?: boolean } = {}) {
  const created: { taskId: string; label: string | null; code: string }[] = [];
  const codes = {
    findTemplateTask: vi.fn((_projectId: string, _type: ProjectTaskType) => Promise.resolve(task)),
    findForTask: vi.fn(() => Promise.resolve(existing)),
    create: vi.fn((input: { taskId: string; label: string | null }, draw: () => string) => {
      const code = draw();
      created.push({ ...input, code });
      return Promise.resolve({ id: `code-${created.length}`, taskFileId: null, ...input, code });
    }),
  };
  const converter = { toPdf: vi.fn(() => Promise.resolve(Buffer.from('%PDF'))) };
  const service = createTaskTemplateService({ codes, qr: withQr ? qr : null, converter });
  return { service, codes, converter, created };
}

describe('taskTemplateService.template', () => {
  it('makes the task’s code once and gives the Word file', async () => {
    const { service, created } = setup();
    const file = await service.template(ORG, 'p1', 'ACR', { format: 'docx' });
    expect(file.contentType).toBe(DOCX_MIME);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      taskId: '0195f3c0-0000-7000-8000-0000000000c1',
      label: null,
    });
    expect(created[0]!.code).toMatch(/-ACR$/);
    // Characters a file name cannot hold are dropped.
    expect(file.filename).toBe(
      `Activity Completion Report - Making Moves 3D Workshop - ${created[0]!.code}.docx`,
    );
  });

  it('reuses a one-file task’s code', async () => {
    const existing = {
      id: 'code-1',
      taskId: 't',
      code: 'OH-7K3P-ACR',
      label: null,
      taskFileId: null,
    };
    const { service, created } = setup({ existing });
    const file = await service.template(ORG, 'p1', 'ACR', { format: 'docx' });
    expect(created).toEqual([]);
    expect(file.filename).toContain('OH-7K3P-ACR');
  });

  it('makes a new labelled code for every letter, and needs the label', async () => {
    const { service, codes, created } = setup();
    await expect(
      service.template(ORG, 'p1', 'COMMUNICATION_LETTER', { format: 'docx' }),
    ).rejects.toMatchObject({ status: 400 });
    await service.template(ORG, 'p1', 'COMMUNICATION_LETTER', {
      label: 'Letter to the Dean',
      format: 'docx',
    });
    expect(codes.findForTask).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(created[0]!.label).toBe('Letter to the Dean');
    expect(created[0]!.code).toMatch(/-CL$/);
  });

  it('converts to PDF on request', async () => {
    const { service, converter } = setup();
    const file = await service.template(ORG, 'p1', 'FINANCIAL_REPORT', { format: 'pdf' });
    expect(converter.toPdf).toHaveBeenCalledWith(expect.any(Buffer), DOCX_MIME);
    expect(file).toMatchObject({ contentType: 'application/pdf', body: Buffer.from('%PDF') });
    expect(file.filename).toMatch(/\.pdf$/);
  });

  it('404s unchecked tasks, missing or deleted projects and other organizations’ projects', async () => {
    await expect(
      setup().service.template(ORG, 'p1', 'OTHER_PRE_EVENT', { format: 'docx' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setup({ task: null }).service.template(ORG, 'p1', 'ACR', { format: 'docx' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setup({ task: taskRecord({ deletedAt: new Date() }) }).service.template(ORG, 'p1', 'ACR', {
        format: 'docx',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      setup({ task: taskRecord({ organizationId: 'org-other' }) }).service.template(
        ORG,
        'p1',
        'ACR',
        { format: 'docx' },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('503s while TASK_QR_SECRET is not set', async () => {
    await expect(
      setup({ withQr: false }).service.template(ORG, 'p1', 'ACR', { format: 'docx' }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
