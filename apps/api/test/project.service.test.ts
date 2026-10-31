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
    files: [],
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
    communicationLetterRequired: false,
    attendanceSheetRequired: false,
    createdById: 'u1',
    createdAt: CREATED,
    updatedAt: CREATED,
    organization: { id: 'jpice', slug: 'jpice', acronym: 'JPICE', name: 'JPICE', type: 'SBO' },
    tasks: [task('PROPOSAL', { status: 'open' }), task('ACR'), task('FINANCIAL_REPORT')],
    extraFiles: [],
    figures: null,
    ...overrides,
  };
}

/** A multi-file task with one file per label, each in the given state, uploaded by `by`. */
function labelled(
  type: ProjectTaskType,
  labels: string[],
  status = 'available',
  by = 'u1',
): TaskRecord {
  return task(type, {
    files: labels.map((label, i) => ({
      label,
      documentId: `doc-${type}-${i}`,
      createdAt: CREATED,
      document: { status: status as never, deletedAt: null, createdById: by },
    })),
  });
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
    addTaskFile: vi.fn(() => Promise.resolve()),
    addProjectFile: vi.fn(() => Promise.resolve()),
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
  const figures = { saveWithFile: vi.fn(() => Promise.resolve({} as never)) };
  const leaderboard = { forEventDates: vi.fn(() => Promise.resolve()) };
  const service = createProjectService({
    projects,
    sync,
    freezes,
    documents,
    documentReads,
    documentTypes,
    uploads,
    viewers: { forUser: () => Promise.resolve(VIEWER) },
    figures,
    audit,
    leaderboard,
    now: () => NOW,
  });
  return {
    service,
    leaderboard,
    figures,
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
      ['OTHER_PRE_EVENT', 'locked'],
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

  it('stores the ticked Communication Letter and Attendance Sheet as tasks', async () => {
    const { service, projects } = setup();
    await service.create(ACTOR, JPICE, {
      ...INPUT,
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
    });
    const [fields, plan] = projects.create.mock.calls[0]! as [
      Record<string, unknown>,
      { tasks: { type: string }[] },
    ];
    expect(fields).toMatchObject({
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
      nomRequired: false,
      momRequired: false,
    });
    expect(plan.tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'COMMUNICATION_LETTER',
      'ATTENDANCE_SHEET',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
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

describe('projectService.get: pre-event documents', () => {
  it('shows each letter the viewer may see with its label, required flags and deadlines', async () => {
    const { service, documentReads } = setup(
      record({
        communicationLetterRequired: true,
        attendanceSheetRequired: true,
        tasks: [filed('PROPOSAL'), labelled('COMMUNICATION_LETTER', ['Dean', 'Guidance'])],
      }),
    );
    // The viewer may see only the first letter.
    documentReads.findVisibleBriefs.mockImplementationOnce((_viewer, ids) =>
      Promise.resolve(
        new Map(
          ids
            .filter((id) => id !== 'doc-COMMUNICATION_LETTER-1')
            .map((id) => [
              id,
              { id, title: 'File', status: 'available' as const, visibility: 'governing' as const },
            ]),
        ),
      ),
    );
    const detail = await service.get(ACTOR, JPICE, 'p1');
    const byType = Object.fromEntries(detail.tasks.map((t) => [t.type, t]));
    expect(byType.COMMUNICATION_LETTER).toMatchObject({
      status: 'submitted',
      required: true,
      dueAt: '2026-10-20T15:59:59.999Z',
      document: null,
      files: [{ label: 'Dean', document: { id: 'doc-COMMUNICATION_LETTER-0' } }],
    });
    expect(byType.ATTENDANCE_SHEET).toMatchObject({
      status: 'open',
      required: true,
      dueAt: '2026-11-03T15:59:59.999Z',
    });
    expect(byType.OTHER_PRE_EVENT).toMatchObject({ required: false, dueAt: null, files: [] });
    expect(detail).toMatchObject({
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
    });
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
    const before = record();
    const after = record({ targetDate: new Date('2027-01-10T00:00:00Z') });
    const { service, projects, sync, audit, leaderboard } = setup(before);
    sync.sync.mockResolvedValueOnce(after);
    await service.update(ACTOR, JPICE, 'p1', { targetDate: '2027-01-10', momRequired: true });
    // Moved across semesters: both boards are recomputed.
    expect(leaderboard.forEventDates).toHaveBeenCalledWith(before.targetDate, after.targetDate);
    expect(projects.update).toHaveBeenCalledWith('p1', {
      targetDate: '2027-01-10',
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

  it('recomputes nothing when the target date stays', async () => {
    const { service, leaderboard } = setup();
    await service.update(ACTOR, JPICE, 'p1', { name: 'Renamed' });
    expect(leaderboard.forEventDates).not.toHaveBeenCalled();
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

describe('projectService.update: pre-event ticks', () => {
  it('lets a ticked document be unticked while it has no file, and ticks new ones', async () => {
    const { service, projects } = setup(
      record({ communicationLetterRequired: true, tasks: [filed('PROPOSAL'), task('ACR')] }),
    );
    await service.update(ACTOR, JPICE, 'p1', {
      communicationLetterRequired: false,
      attendanceSheetRequired: true,
    });
    expect(projects.update).toHaveBeenCalledWith('p1', {
      communicationLetterRequired: false,
      attendanceSheetRequired: true,
    });
  });

  it('409s unticking a Communication Letter or Attendance Sheet that has a file', async () => {
    const withLetter = record({
      communicationLetterRequired: true,
      tasks: [filed('PROPOSAL'), labelled('COMMUNICATION_LETTER', ['Letter to the Dean'])],
    });
    const a = setup(withLetter);
    await expect(
      a.service.update(ACTOR, JPICE, 'p1', { communicationLetterRequired: false }),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('Communication Letter') as unknown,
    });
    expect(a.projects.update).not.toHaveBeenCalled();

    const withSheet = record({
      attendanceSheetRequired: true,
      tasks: [filed('PROPOSAL'), filed('ATTENDANCE_SHEET', 'scanning')],
    });
    const b = setup(withSheet);
    await expect(
      b.service.update(ACTOR, JPICE, 'p1', { attendanceSheetRequired: false }),
    ).rejects.toMatchObject({ status: 409 });
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

  it('saves a Financial Report’s totals before filing its file', async () => {
    const open = record({
      targetDate: new Date('2026-10-01T00:00:00Z'),
      tasks: [filed('PROPOSAL'), task('ACR'), task('FINANCIAL_REPORT')],
    });
    const { service, figures, documents } = setup(open);
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'FINANCIAL_REPORT', {
      uploadKey: 'k',
      visibility: 'private',
      actingAs: 'Juan',
      figures: { incomeCentavos: 500, expensesCentavos: 200 },
    });
    expect(figures.saveWithFile).toHaveBeenCalledWith(
      ACTOR,
      open,
      { incomeCentavos: 500, expensesCentavos: 200 },
      'Juan',
    );
    expect(documents.create).toHaveBeenCalled();
  });

  it('400s a Financial Report without its totals, filing nothing', async () => {
    const { service, figures, documents } = setup(
      record({
        targetDate: new Date('2026-10-01T00:00:00Z'),
        tasks: [filed('PROPOSAL'), task('ACR'), task('FINANCIAL_REPORT')],
      }),
    );
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'FINANCIAL_REPORT', {
        uploadKey: 'k',
        visibility: 'private',
        actingAs: 'Juan',
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(figures.saveWithFile).not.toHaveBeenCalled();
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('files nothing when the totals are refused', async () => {
    const { service, figures, documents } = setup(
      record({
        targetDate: new Date('2026-10-01T00:00:00Z'),
        tasks: [filed('PROPOSAL'), task('ACR'), task('FINANCIAL_REPORT')],
      }),
    );
    figures.saveWithFile.mockRejectedValueOnce(new Error('closed'));
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'FINANCIAL_REPORT', {
        uploadKey: 'k',
        visibility: 'private',
        actingAs: 'Juan',
        figures: { incomeCentavos: 1, expensesCentavos: 1 },
      }),
    ).rejects.toThrow('closed');
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('files each Communication Letter as its own labelled document', async () => {
    const { service, documents, documentTypes, projects } = setup(
      record({ communicationLetterRequired: true, tasks: [filed('PROPOSAL')] }),
    );
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
      uploadKey: 'uploads/jpice/l1',
      visibility: 'private',
      actingAs: 'Juan',
      label: 'Letter to the Dean',
    });
    expect(documentTypes.findBySlug).toHaveBeenCalledWith('communication-letter');
    expect(documents.create).toHaveBeenCalledWith(
      ACTOR,
      JPICE,
      expect.objectContaining({
        title: 'Communication Letter: Letter to the Dean (Bridge design competition)',
        visibility: 'private',
      }),
    );
    expect(projects.addTaskFile).toHaveBeenCalledWith(
      'p1',
      'COMMUNICATION_LETTER',
      'new-doc',
      'Letter to the Dean',
    );
    expect(projects.linkDocument).not.toHaveBeenCalled();
    expect(documents.addVersion).not.toHaveBeenCalled();
  });

  it('adds a second letter as another file, not a version of the first', async () => {
    const { service, documents, projects } = setup(
      record({
        communicationLetterRequired: true,
        tasks: [filed('PROPOSAL'), labelled('COMMUNICATION_LETTER', ['Letter to the Dean'])],
      }),
    );
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
      uploadKey: 'k2',
      visibility: 'private',
      actingAs: 'Juan',
      label: 'Letter to the Guidance Office',
    });
    expect(documents.create).toHaveBeenCalledTimes(1);
    expect(projects.addTaskFile).toHaveBeenCalledWith(
      'p1',
      'COMMUNICATION_LETTER',
      'new-doc',
      'Letter to the Guidance Office',
    );
  });

  it('uploads a new version of one letter by its document id, and 404s one of another task', async () => {
    const { service, documents, projects } = setup(
      record({
        communicationLetterRequired: true,
        tasks: [filed('PROPOSAL'), labelled('COMMUNICATION_LETTER', ['Dean', 'Guidance'])],
      }),
    );
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
      uploadKey: 'k3',
      visibility: 'private',
      actingAs: 'Juan',
      documentId: 'doc-COMMUNICATION_LETTER-1',
    });
    expect(documents.addVersion).toHaveBeenCalledWith(ACTOR, JPICE, 'doc-COMMUNICATION_LETTER-1', {
      uploadKey: 'k3',
      actingAs: 'Juan',
    });
    expect(projects.addTaskFile).not.toHaveBeenCalled();
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
        uploadKey: 'k4',
        visibility: 'private',
        actingAs: 'Juan',
        documentId: 'doc-PROPOSAL',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('409s a new version while another officer’s copy of that letter is still checked', async () => {
    const { service } = setup(
      record({
        communicationLetterRequired: true,
        tasks: [filed('PROPOSAL'), labelled('COMMUNICATION_LETTER', ['Dean'], 'scanning', 'u2')],
      }),
    );
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
        uploadKey: 'k',
        visibility: 'private',
        actingAs: 'Juan',
        documentId: 'doc-COMMUNICATION_LETTER-0',
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('files an other pre-event document with its label, even on a project needing none', async () => {
    const { service, projects } = setup(record({ tasks: [filed('PROPOSAL')] }));
    await service.submitTaskFile(ACTOR, JPICE, 'p1', 'OTHER_PRE_EVENT', {
      uploadKey: 'k',
      visibility: 'private',
      actingAs: 'Juan',
      label: 'Venue reservation',
    });
    expect(projects.addTaskFile).toHaveBeenCalledWith(
      'p1',
      'OTHER_PRE_EVENT',
      'new-doc',
      'Venue reservation',
    );
  });

  it('404s a Communication Letter the project did not tick', async () => {
    const { service } = setup(record({ tasks: [filed('PROPOSAL')] }));
    await expect(
      service.submitTaskFile(ACTOR, JPICE, 'p1', 'COMMUNICATION_LETTER', {
        uploadKey: 'k',
        visibility: 'private',
        actingAs: 'Juan',
        label: 'Letter',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('409s an Attendance Sheet until the proposal is submitted', async () => {
    const { service } = setup(record({ attendanceSheetRequired: true }));
    await expect(
      service.taskUploadUrl(ACTOR, JPICE, 'p1', 'ATTENDANCE_SHEET', PDF),
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('once the Project Proposal is submitted') as unknown,
    });
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

describe('projectService: extra project files (spec 2C)', () => {
  const FILE = {
    typeId: '0195f3c0-0000-7000-8000-0000000000e2',
    title: 'Site visit photos',
    description: 'Photos of the venue before the event.',
    academicYear: '2026-2027',
    semester: 'first' as const,
    visibility: 'governing' as const,
    tags: ['venue'],
    uploadKey: 'uploads/jpice/k9',
    actingAs: 'Juan Dela Cruz',
  };
  // Created Sep 20: the proposal was due Oct 4, before NOW (Oct 10), so it is blocked.
  const blocked = () => record({ createdAt: new Date('2026-09-20T02:00:00Z') });

  it('files the upload as a Paperworks document with the details given, linked to the project', async () => {
    const { service, documents, projects } = setup();
    await service.addFile(ACTOR, JPICE, 'p1', FILE);
    expect(documents.create).toHaveBeenCalledWith(ACTOR, JPICE, FILE);
    expect(projects.addProjectFile).toHaveBeenCalledWith('p1', 'new-doc');
  });

  it('takes extra files and issues their upload URLs on a blocked project too', async () => {
    const { service, uploads, projects } = setup(blocked());
    await service.fileUploadUrl(ACTOR, JPICE, 'p1', PDF);
    expect(uploads.issueUrl).toHaveBeenCalledWith(ACTOR.userId, JPICE, PDF);
    await service.addFile(ACTOR, JPICE, 'p1', FILE);
    expect(projects.addProjectFile).toHaveBeenCalledWith('p1', 'new-doc');
  });

  it('404s a project of another organization, filing nothing', async () => {
    const { service, documents, uploads } = setup(record({ organizationId: 'psme' }));
    await expect(service.addFile(ACTOR, JPICE, 'p1', FILE)).rejects.toMatchObject({ status: 404 });
    await expect(service.fileUploadUrl(ACTOR, JPICE, 'p1', PDF)).rejects.toMatchObject({
      status: 404,
    });
    expect(documents.create).not.toHaveBeenCalled();
    expect(uploads.issueUrl).not.toHaveBeenCalled();
  });

  it('lists only the extra files the viewer may see, oldest first', async () => {
    const { service, documentReads } = setup(
      record({ extraFiles: [{ documentId: 'extra-1' }, { documentId: 'extra-2' }] }),
    );
    documentReads.findVisibleBriefs.mockResolvedValueOnce(
      new Map([
        [
          'extra-2',
          { id: 'extra-2', title: 'Budget', status: 'available' as const, visibility: 'governing' as const },
        ],
      ]),
    );
    const detail = await service.get(ACTOR, JPICE, 'p1');
    expect(documentReads.findVisibleBriefs).toHaveBeenCalledWith(VIEWER, ['extra-1', 'extra-2']);
    expect(detail.files).toEqual([
      { document: { id: 'extra-2', title: 'Budget', status: 'available', visibility: 'governing' } },
    ]);
  });
});
