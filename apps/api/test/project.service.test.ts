import { describe, expect, it, vi } from 'vitest';
import type { ProjectTaskType } from '@orghive/shared';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { FreezeRecord } from '#src/repositories/org-freeze.repository';
import type { ProjectRecord, TaskRecord } from '#src/repositories/project.repository';
import { createProjectService } from '#src/services/project.service';

const JPICE = { id: 'jpice', slug: 'jpice' };
const IECEP = { id: 'iecep', slug: 'iecep' };
const ACTOR = { userId: 'u1', ip: '10.0.0.1' };
const VIEWER: DocumentViewer = {
  kind: 'account',
  userId: 'u1',
  organizationId: 'jpice',
  organizationType: 'SBO',
};
/** Oct 10, 10:00 Manila: after creation, before the Oct 20 event. */
const NOW = new Date('2026-10-10T02:00:00Z');
const CREATED = new Date('2026-10-01T02:00:00Z');

function task(type: ProjectTaskType, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: `t-${type}`,
    type,
    status: 'locked',
    dueAt: null,
    submittedAt: null,
    documentId: null,
    document: null,
    ...overrides,
  };
}

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    organizationId: 'jpice',
    name: 'Bridge design competition',
    targetDate: new Date('2026-10-20T00:00:00Z'),
    location: 'CEA Building',
    beneficiaries: 'CE students',
    description: 'A truss bridge competition.',
    status: 'active',
    proposalDueAt: new Date('2026-10-15T15:59:59.999Z'),
    postEventDueAt: new Date('2026-11-03T15:59:59.999Z'),
    proposalDueOverride: null,
    postEventDueOverride: null,
    nomRequired: false,
    momRequired: false,
    createdById: 'u1',
    createdAt: CREATED,
    updatedAt: CREATED,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    tasks: [task('PROPOSAL', { status: 'open' }), task('ACR'), task('FINANCIAL_REPORT')],
    ...overrides,
  };
}

/** A task whose file is in the given document state, uploaded by `by`. */
function filed(type: ProjectTaskType, status = 'available', by = 'u1'): TaskRecord {
  return task(type, {
    documentId: `doc-${type}`,
    document: { status: status as never, deletedAt: null, createdById: by },
  });
}

function setup(found: ProjectRecord | null = record()) {
  const projects = {
    create: vi.fn((_input: unknown, _plan: unknown) => Promise.resolve(record())),
    findById: vi.fn(() => Promise.resolve(found)),
    listByOrganization: vi.fn(() => Promise.resolve(found ? [found] : [])),
    update: vi.fn(() => Promise.resolve()),
    linkDocument: vi.fn(() => Promise.resolve()),
  };
  const sync = {
    sync: vi.fn(() => Promise.resolve(found)),
    syncOrganization: vi.fn(() => Promise.resolve(1)),
  };
  const freezes = { listOpen: vi.fn(() => Promise.resolve([] as FreezeRecord[])) };
  const documents = {
    create: vi.fn(() => Promise.resolve({ id: 'new-doc' } as never)),
    addVersion: vi.fn(() => Promise.resolve({} as never)),
  };
  const documentReads = {
    findVisibleBriefs: vi.fn((_viewer: DocumentViewer, ids: string[]) =>
      Promise.resolve(
        new Map(
          ids.map((id) => [
            id,
            {
              id,
              title: 'Proposal',
              status: 'available' as const,
              visibility: 'governing' as const,
            },
          ]),
        ),
      ),
    ),
  };
  const documentTypes = {
    findBySlug: vi.fn((slug: string) => Promise.resolve({ id: `type-${slug}`, slug, name: slug })),
  };
  const uploads = { issueUrl: vi.fn(() => Promise.resolve({ uploadKey: 'k' } as never)) };
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const service = createProjectService({
    projects,
    sync,
    freezes,
    documents,
    documentReads,
    documentTypes,
    uploads,
    viewers: { forUser: () => Promise.resolve(VIEWER) },
    audit,
    now: () => NOW,
  });
  return {
    service,
    projects,
    sync,
    freezes,
    documents,
    documentReads,
    documentTypes,
    uploads,
    audit,
  };
}

const PDF = { filename: 'proposal.pdf', contentType: 'application/pdf' as const, sizeBytes: 100 };
const INPUT = {
  name: 'Bridge design competition',
  targetDate: '2026-10-20',
  location: 'CEA Building',
  beneficiaries: 'CE students',
  description: 'A truss bridge competition.',
};

describe('projectService.create', () => {
  it('stores the project with its checklist from the rules, and audits it', async () => {
    const { service, projects, audit } = setup();
    const detail = await service.create(ACTOR, JPICE, { ...INPUT, nomRequired: true });
    const [fields, plan] = projects.create.mock.calls[0]! as [
      Record<string, unknown>,
      { tasks: { type: string; status: string }[]; proposalDueAt: Date },
    ];
    expect(fields).toMatchObject({ organizationId: 'jpice', createdById: 'u1', nomRequired: true });
    expect(plan.tasks.map((t) => [t.type, t.status])).toEqual([
      ['PROPOSAL', 'open'],
      ['NOM', 'locked'],
      ['ACR', 'locked'],
      ['FINANCIAL_REPORT', 'locked'],
    ]);
    // Created Oct 10 (NOW), so the proposal is due Oct 24, 23:59:59 Manila.
    expect(plan.proposalDueAt.toISOString()).toBe('2026-10-24T15:59:59.999Z');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project_create',
        entityId: 'p1',
        organizationId: 'jpice',
      }),
    );
    expect(detail.tasks[0]).toMatchObject({ type: 'PROPOSAL', status: 'open' });
  });

  it('checks the organization’s deadlines first, then refuses a frozen organization (403)', async () => {
    const { service, projects, sync, freezes } = setup();
    freezes.listOpen.mockResolvedValueOnce([
      {
        id: 'f1',
        organizationId: 'jpice',
        projectId: 'p0',
        reports: ['ACR'],
        frozenAt: NOW,
        liftedAt: null,
        project: { id: 'p0', name: 'Freshmen orientation' },
      },
    ]);
    await expect(service.create(ACTOR, JPICE, INPUT)).rejects.toMatchObject({
      status: 403,
      code: 'ORGANIZATION_FROZEN',
      message: expect.stringContaining('Freshmen orientation') as unknown,
    });
    expect(sync.syncOrganization).toHaveBeenCalledWith('jpice');
    expect(projects.create).not.toHaveBeenCalled();
  });
});

describe('projectService.list and get', () => {
  it('runs the compliance check on read: list checks the organization, get the project', async () => {
    const { service, sync } = setup();
    await service.list(JPICE);
    expect(sync.syncOrganization).toHaveBeenCalledWith('jpice');
    await service.get(ACTOR, JPICE, 'p1');
    expect(sync.sync).toHaveBeenCalledWith('p1');
  });

  it('lists with each project’s next deadline', async () => {
    const { items } = await setup().service.list(JPICE);
    expect(items[0]).toMatchObject({
      id: 'p1',
      status: 'active',
      targetDate: '2026-10-20',
      nextDeadline: { type: 'PROPOSAL', dueAt: '2026-10-15T15:59:59.999Z' },
    });
  });

  it('shows a task’s file only through the visibility filter', async () => {
    const { service, documentReads } = setup(
      record({ tasks: [filed('PROPOSAL'), task('ACR'), task('FINANCIAL_REPORT')] }),
    );
    documentReads.findVisibleBriefs.mockResolvedValueOnce(new Map());
    const detail = await service.get(ACTOR, JPICE, 'p1');
    expect(documentReads.findVisibleBriefs).toHaveBeenCalledWith(VIEWER, ['doc-PROPOSAL']);
    // Submitted (its file is clean), but this viewer may not see the file itself.
    expect(detail.tasks[0]).toMatchObject({ status: 'submitted', document: null });
  });

  it('404s a project of another organization than the guarded one', async () => {
    await expect(setup().service.get(ACTOR, IECEP, 'p1')).rejects.toMatchObject({ status: 404 });
    await expect(setup(null).service.get(ACTOR, JPICE, 'p1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('projectService.update', () => {
  it('saves, re-applies the rules and audits which fields changed', async () => {
    const { service, projects, sync, audit } = setup();
    await service.update(ACTOR, JPICE, 'p1', { targetDate: '2026-11-05', momRequired: true });
    expect(projects.update).toHaveBeenCalledWith('p1', {
      targetDate: '2026-11-05',
      momRequired: true,
    });
    expect(sync.sync).toHaveBeenCalledWith('p1');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'project_update',
        metadata: { fields: ['targetDate', 'momRequired'] },
      }),
    );
  });

  it('409s dropping an optional task that already has a file', async () => {
    const { service, projects } = setup(
      record({
        nomRequired: true,
        tasks: [filed('PROPOSAL'), filed('NOM'), task('ACR'), task('FINANCIAL_REPORT')],
      }),
    );
    await expect(service.update(ACTOR, JPICE, 'p1', { nomRequired: false })).rejects.toMatchObject({
      status: 409,
    });
    expect(projects.update).not.toHaveBeenCalled();
  });
});

describe('projectService.taskUploadUrl', () => {
  it('issues an upload URL for an open task', async () => {
    const { service, uploads } = setup();
    await service.taskUploadUrl(ACTOR, JPICE, 'p1', 'PROPOSAL', PDF);
    expect(uploads.issueUrl).toHaveBeenCalledWith('u1', JPICE, PDF);
  });

  it('409s a locked task with the reason, and 404s a task the project does not need', async () => {
    const { service, uploads } = setup();
    await expect(service.taskUploadUrl(ACTOR, JPICE, 'p1', 'ACR', PDF)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('opens on the event day, 2026-10-20') as unknown,
    });
    await expect(service.taskUploadUrl(ACTOR, JPICE, 'p1', 'NOM', PDF)).rejects.toMatchObject({
      status: 404,
    });
    expect(uploads.issueUrl).not.toHaveBeenCalled();
  });

  it('409s NOM until the proposal is submitted', async () => {
    const { service } = setup(record({ nomRequired: true }));
    await expect(service.taskUploadUrl(ACTOR, JPICE, 'p1', 'NOM', PDF)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('once the Project Proposal is submitted') as unknown,
    });
  });

  it('409s every task of a project whose proposal deadline passed (blocked)', async () => {
    // Created Sep 20: the proposal was due Oct 4, before NOW (Oct 10).
    const { service } = setup(record({ createdAt: new Date('2026-09-20T02:00:00Z') }));
    await expect(service.taskUploadUrl(ACTOR, JPICE, 'p1', 'PROPOSAL', PDF)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('blocked') as unknown,
    });
  });
});

describe('projectService.submitTaskFile', () => {
  it('files the first upload as a new document with the chosen visibility, linked to the task', async () => {
    const { service, documents, documentTypes, projects, sync } = setup();
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'PROPOSAL', {
      uploadKey: 'uploads/jpice/k1',
      visibility: 'private',
      actingAs: 'Juan Dela Cruz',
    });
    expect(documentTypes.findBySlug).toHaveBeenCalledWith('project-proposal');
    expect(documents.create).toHaveBeenCalledWith(ACTOR, JPICE, {
      typeId: 'type-project-proposal',
      title: 'Project Proposal: Bridge design competition',
      academicYear: '2026-2027',
      visibility: 'private',
      tags: [],
      uploadKey: 'uploads/jpice/k1',
      actingAs: 'Juan Dela Cruz',
    });
    expect(projects.linkDocument).toHaveBeenCalledWith('p1', 'PROPOSAL', 'new-doc');
    expect(sync.sync).toHaveBeenCalledWith('p1');
  });

  it('adds a version when the task already has a file', async () => {
    const { service, documents, projects } = setup(
      record({ tasks: [filed('PROPOSAL'), task('ACR'), task('FINANCIAL_REPORT')] }),
    );
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'PROPOSAL', {
      uploadKey: 'uploads/jpice/k2',
      visibility: 'governing',
      actingAs: 'Maria Santos',
    });
    expect(documents.addVersion).toHaveBeenCalledWith(ACTOR, JPICE, 'doc-PROPOSAL', {
      uploadKey: 'uploads/jpice/k2',
      actingAs: 'Maria Santos',
    });
    expect(documents.create).not.toHaveBeenCalled();
    expect(projects.linkDocument).not.toHaveBeenCalled();
  });

  it('starts a new document when the old file was deleted', async () => {
    const deleted = task('PROPOSAL', {
      documentId: 'old',
      document: { status: 'available', deletedAt: new Date(), createdById: 'u1' },
    });
    const { service, documents, projects } = setup(
      record({ tasks: [deleted, task('ACR'), task('FINANCIAL_REPORT')] }),
    );
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'PROPOSAL', {
      uploadKey: 'k',
      visibility: 'governing',
      actingAs: 'Juan',
    });
    expect(documents.create).toHaveBeenCalled();
    expect(projects.linkDocument).toHaveBeenCalledWith('p1', 'PROPOSAL', 'new-doc');
  });

  it('409s while another officer’s file for the task is still being checked', async () => {
    const { service, documents } = setup(
      record({
        tasks: [filed('PROPOSAL', 'scanning', 'u2'), task('ACR'), task('FINANCIAL_REPORT')],
      }),
    );
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'PROPOSAL', {
        uploadKey: 'k',
        visibility: 'public',
        actingAs: 'Juan',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(documents.addVersion).not.toHaveBeenCalled();
  });

  it('409s a locked task without touching any document', async () => {
    const { service, documents } = setup();
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'ACR', {
        uploadKey: 'k',
        visibility: 'public',
        actingAs: 'Juan',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(documents.create).not.toHaveBeenCalled();
  });
});
