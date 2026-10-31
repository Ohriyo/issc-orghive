import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  endOfManilaDay,
  manilaDate,
  type ProjectDetail,
  type ProjectTaskType,
} from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import type { Storage } from '#src/lib/storage';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDocumentTypeRepository } from '#src/repositories/document-type.repository';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createOrgFreezeRepository } from '#src/repositories/org-freeze.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createUploadIntentRepository } from '#src/repositories/upload-intent.repository';
import { createAccessService } from '#src/services/access.service';
import { createDocumentService } from '#src/services/document.service';
import { createDocumentViewerService } from '#src/services/document-viewer.service';
import { createFinancialFiguresService } from '#src/services/financial-figures.service';
import { createProjectService } from '#src/services/project.service';
import { createProjectSync } from '#src/services/project-sync.service';
import { createRecipients } from '#src/services/recipients.service';
import { createTokenService } from '#src/services/token.service';
import { createUploadService } from '#src/services/upload.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, createTaskDocumentTypes, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
const documentRepo = createDocumentRepository(db);
const projectRepo = createProjectRepository(db);
/** Semesters whose leaderboard a scanned task file asked to recompute. */
const recomputed: string[] = [];
const projectSync = createProjectSync({
  projects: projectRepo,
  leaderboard: {
    forEventDates: (...dates) => {
      recomputed.push(
        ...dates.map((d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10))),
      );
      return Promise.resolve();
    },
  },
});

/** Storage stand-in: an upload "exists" once its intent exists, as declared. */
const storage: Storage = {
  presignPut: (key) => Promise.resolve({ url: `https://storage.test/${key}?put`, headers: {} }),
  presignGet: (key) => Promise.resolve(`https://storage.test/${key}?get`),
  head: async (key) => {
    const intent = await db.uploadIntent.findUnique({ where: { key } });
    return intent ? { sizeBytes: intent.sizeBytes, contentType: intent.contentType } : null;
  },
  read: () => Promise.reject(new Error('not used')),
  put: () => Promise.resolve(),
  copy: () => Promise.resolve(),
  move: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  list: () => Promise.resolve([]),
};
const queued: string[] = [];
const queue = {
  enqueueProcessing: (versionId: string) => {
    queued.push(versionId);
    return Promise.resolve();
  },
};

/** JPICE's account, its CSC (governor), a sibling SBO, the ISSC (admin), and no organization. */
type Who = 'student' | 'officer' | 'governor' | 'psmeOfficer' | 'admin';
let world: World;
let app: ReturnType<typeof buildTestApp>;
const userIds = {} as Record<Who, string>;
const tokenOf = {} as Record<Who, string>;

const today = manilaDate(new Date());

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  await createTaskDocumentTypes(db);
  const people: Record<Who, string> = {
    student: world.users.outsider.id,
    officer: world.users.officer.id,
    governor: world.users.governor.id,
    psmeOfficer: world.users.psme.id,
    admin: world.users.issc.id,
  };
  for (const [key, userId] of Object.entries(people) as [Who, string][]) {
    userIds[key] = userId;
    tokenOf[key] = (await tokens.sign({ userId, passwordChangeRequired: false })).token;
  }

  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const audit = createAuditLogRepository(db);
  const viewers = createDocumentViewerService({ accounts });
  const uploads = createUploadService({ intents: createUploadIntentRepository(db), storage });
  const documentTypes = createDocumentTypeRepository(db);
  const documents = createDocumentService({
    documents: documentRepo,
    documentTypes,
    organizations,
    viewers,
    uploads,
    queue,
    storage,
    audit,
    cache: memoryCache(),
  });
  const financialFigures = createFinancialFiguresService({
    figures: createFinancialFiguresRepository(db),
    projects: projectRepo,
    recipients: createRecipients({ accounts, organizations }),
    notifications: { notify: () => Promise.resolve() },
    audit,
  });
  app = buildTestApp({
    tokens,
    uploads,
    documents,
    financialFigures,
    access: createAccessService({
      accounts,
      organizations,
      documents: documentRepo,
      projects: projectRepo,
    }),
    projects: createProjectService({
      projects: projectRepo,
      sync: projectSync,
      freezes: createOrgFreezeRepository(db),
      documents,
      documentReads: documentRepo,
      documentTypes,
      uploads,
      viewers,
      figures: financialFigures,
      audit,
    }),
  });
});

function call(method: 'get' | 'post' | 'patch', path: string, who?: Who, body?: object) {
  let req = request(app)[method](`/api/v1${path}`);
  if (who) req = req.set('Authorization', `Bearer ${tokenOf[who]}`);
  return body ? req.send(body) : req;
}

const projectBody = (overrides: object = {}) => ({
  name: 'Inter-Year Bridge Design Competition',
  targetDate: addDays(today, 30),
  location: 'CEA Building, NwSSU Main Campus',
  beneficiaries: 'Civil engineering students',
  description: 'A truss bridge design and load-testing competition.',
  ...overrides,
});

async function newProject(overrides: object = {}): Promise<ProjectDetail> {
  const res = await call(
    'post',
    '/organizations/jpice/projects',
    'officer',
    projectBody(overrides),
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ProjectDetail;
}

const PDF = { filename: 'file.pdf', contentType: 'application/pdf', sizeBytes: 1000 };
/** ₱12,345.50 in, ₱2,000.00 out. */
const FIGURES = { incomeCentavos: 1_234_550, expensesCentavos: 200_000 };

/** Uploads a PDF for the task as `who` (the browser PUT is assumed done), then files it. */
async function fileTask(
  projectId: string,
  type: ProjectTaskType,
  who: Who = 'officer',
  visibility = 'governing',
) {
  const url = await call('post', `/projects/${projectId}/tasks/${type}/upload-url`, who, PDF);
  expect(url.status, JSON.stringify(url.body)).toBe(201);
  const { uploadKey } = url.body as { uploadKey: string };
  const res = await call('post', `/projects/${projectId}/tasks/${type}/documents`, who, {
    uploadKey,
    visibility,
    actingAs: 'Juan Dela Cruz',
    ...(type === 'FINANCIAL_REPORT' && { figures: FIGURES }),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ProjectDetail;
}

/** What the worker does for a clean file: mark it clean, then let the project move on. */
async function scanClean(documentId: string) {
  const doc = await db.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { versions: { select: { id: true }, orderBy: { version: 'desc' }, take: 1 } },
  });
  await documentRepo.markClean(
    doc.versions[0]!.id,
    {
      storageKey: `files/test/${doc.versions[0]!.id}`,
      sha256: 'a'.repeat(64),
      contentText: null,
    },
    new Date(),
  );
  await projectSync.documentScanned(documentId);
}

const statusOf = (detail: ProjectDetail, type: ProjectTaskType) =>
  detail.tasks.find((t) => t.type === type)?.status;

describe('project authorization', () => {
  let project: ProjectDetail;
  beforeAll(async () => {
    project = await newProject();
  });

  const cases: [
    string,
    (who?: Who) => PromiseLike<request.Response>,
    Record<Who | 'anonymous', number>,
  ][] = [
    [
      'list projects',
      (who) => call('get', '/organizations/jpice/projects', who),
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 200, officer: 200, admin: 200 },
    ],
    [
      'read a project',
      (who) => call('get', `/projects/${project.id}`, who),
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 200, officer: 200, admin: 200 },
    ],
    [
      'create a project',
      (who) => call('post', '/organizations/jpice/projects', who, projectBody()),
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 403, officer: 201, admin: 403 },
    ],
    [
      'edit a project',
      (who) => call('patch', `/projects/${project.id}`, who, { location: 'Gym' }),
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 403, officer: 200, admin: 403 },
    ],
    [
      'get a task upload URL',
      (who) => call('post', `/projects/${project.id}/tasks/PROPOSAL/upload-url`, who, PDF),
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 403, officer: 201, admin: 403 },
    ],
    [
      'file a task document',
      (who) =>
        call('post', `/projects/${project.id}/tasks/PROPOSAL/documents`, who, {
          uploadKey: `uploads/${world.orgs.jpice.id}/${crypto.randomUUID()}`,
          visibility: 'public',
          actingAs: 'Juan Dela Cruz',
        }),
      // Authorized users get past the guard; the unknown upload key is then a 400.
      { anonymous: 401, student: 403, psmeOfficer: 403, governor: 403, officer: 400, admin: 403 },
    ],
  ];

  it.each(
    cases.flatMap(([name, run, expected]) =>
      (Object.keys(expected) as (Who | 'anonymous')[]).map((who) => ({
        name,
        run,
        who,
        status: expected[who],
      })),
    ),
  )('$name as $who -> $status', async ({ run, who, status }) => {
    const res = await run(who === 'anonymous' ? undefined : who);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
  });

  it('404s an unknown project and 400s a malformed id or task type', async () => {
    await call('get', `/projects/${crypto.randomUUID()}`, 'officer').expect(404);
    await call('get', '/projects/not-a-uuid', 'officer').expect(400);
    await call('post', `/projects/${project.id}/tasks/BUDGET/upload-url`, 'officer', PDF).expect(
      400,
    );
  });

  it('never caches project responses', async () => {
    const res = await call('get', `/projects/${project.id}`, 'officer').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
});

describe('POST /organizations/:slug/projects', () => {
  it('creates the checklist: proposal open and due in 14 days, the rest locked; audited', async () => {
    const before = Date.now();
    const project = await newProject({ nomRequired: true, momRequired: false });
    expect(project).toMatchObject({
      status: 'active',
      nomRequired: true,
      momRequired: false,
      organization: { slug: 'jpice' },
    });
    expect(project.tasks.map((t) => [t.type, t.status])).toEqual([
      ['PROPOSAL', 'open'],
      ['NOM', 'locked'],
      ['OTHER_PRE_EVENT', 'locked'],
      ['ACR', 'locked'],
      ['FINANCIAL_REPORT', 'locked'],
    ]);
    const proposal = project.tasks[0]!;
    expect(proposal.dueAt).toBe(
      new Date(`${addDays(manilaDate(new Date(before)), 14)}T23:59:59.999+08:00`).toISOString(),
    );
    expect(project.nextDeadline).toEqual({ type: 'PROPOSAL', dueAt: proposal.dueAt });
    expect(project.tasks.find((t) => t.type === 'ACR')!.dueAt).toBe(
      new Date(`${addDays(project.targetDate, 14)}T23:59:59.999+08:00`).toISOString(),
    );
    expect(
      await db.auditLog.count({ where: { action: 'project_create', entityId: project.id } }),
    ).toBe(1);
    expect(await db.projectTask.count({ where: { projectId: project.id } })).toBe(5);
  });

  it('requires all five fields and a target date that is not in the past', async () => {
    for (const field of ['name', 'targetDate', 'location', 'beneficiaries', 'description']) {
      const body: Record<string, unknown> = projectBody();
      delete body[field];
      await call('post', '/organizations/jpice/projects', 'officer', body).expect(400);
    }
    await call(
      'post',
      '/organizations/jpice/projects',
      'officer',
      projectBody({
        targetDate: addDays(today, -1),
      }),
    ).expect(400);
    await call(
      'post',
      '/organizations/jpice/projects',
      'officer',
      projectBody({
        status: 'completed',
      }),
    ).expect(400);
  });

  it('lists the organization’s projects only, soonest event first', async () => {
    await newProject({ name: 'Later project', targetDate: addDays(today, 90) });
    await newProject({ name: 'Sooner project', targetDate: addDays(today, 3) });
    const { items } = (await call('get', '/organizations/jpice/projects', 'officer').expect(200))
      .body as { items: { name: string; targetDate: string; organization: { slug: string } }[] };
    const dates = items.map((p) => p.targetDate);
    expect(dates).toEqual([...dates].sort());
    expect(items.every((p) => p.organization.slug === 'jpice')).toBe(true);
    const psme = (await call('get', '/organizations/psme/projects', 'psmeOfficer').expect(200))
      .body as { items: unknown[] };
    expect(psme.items).toEqual([]);
  });
});

describe('submitting tasks through the document pipeline', () => {
  it('submits the proposal once its file passes the scan, which unlocks NOM and MOM', async () => {
    const project = await newProject({ nomRequired: true, momRequired: true });

    const afterUpload = await fileTask(project.id, 'PROPOSAL', 'officer', 'governing');
    const proposal = afterUpload.tasks[0]!;
    // Still open while the scan runs; only the organization sees the file.
    expect(proposal).toMatchObject({ status: 'open', document: { status: 'scanning' } });
    const asCsc = (await call('get', `/projects/${project.id}`, 'governor').expect(200))
      .body as ProjectDetail;
    expect(asCsc.tasks[0]).toMatchObject({ status: 'open', document: null });
    expect(statusOf(asCsc, 'NOM')).toBe('locked');

    recomputed.length = 0;
    await scanClean(proposal.document!.id);
    // A submitted task may move the standings of its event's semester.
    expect(recomputed).toEqual([project.targetDate]);

    const after = (await call('get', `/projects/${project.id}`, 'governor').expect(200))
      .body as ProjectDetail;
    expect(after.tasks[0]).toMatchObject({
      status: 'submitted',
      document: { status: 'available', visibility: 'governing' },
    });
    expect(after.tasks[0]!.submittedAt).not.toBeNull();
    expect(statusOf(after, 'NOM')).toBe('open');
    expect(statusOf(after, 'MOM')).toBe('open');
    expect(statusOf(after, 'ACR')).toBe('locked');

    // The file is a normal Paperworks document with the visibility the officer chose.
    const doc = await db.document.findUniqueOrThrow({ where: { id: proposal.document!.id } });
    expect(doc).toMatchObject({
      organizationId: world.orgs.jpice.id,
      visibility: 'governing',
      status: 'available',
      title: `Project Proposal: ${project.name}`,
    });
    const stored = await db.projectTask.findUniqueOrThrow({
      where: { projectId_type: { projectId: project.id, type: 'PROPOSAL' } },
    });
    expect(stored).toMatchObject({ status: 'submitted', documentId: doc.id });
    await call('get', `/documents/${doc.id}`).expect(404);
    // A governing file: its CSC sees it, a sibling SBO does not.
    await call('get', `/documents/${doc.id}`, 'governor').expect(200);
    await call('get', `/documents/${doc.id}`, 'psmeOfficer').expect(404);
  });

  it('refuses a locked task, a task the project does not need, and non-PDF files', async () => {
    const project = await newProject();
    const url = (type: string) => `/projects/${project.id}/tasks/${type}/upload-url`;
    const acr = await call('post', url('ACR'), 'officer', PDF).expect(409);
    expect((acr.body as { error: { message: string } }).error.message).toMatch(/event day/);
    await call('post', url('NOM'), 'officer', PDF).expect(404);
    await call('post', url('PROPOSAL'), 'officer', {
      filename: 'proposal.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1000,
    }).expect(400);
  });

  it('opens the post-event reports on the event day and completes the project', async () => {
    const project = await newProject({ targetDate: today });
    expect(statusOf(project, 'ACR')).toBe('open');
    expect(statusOf(project, 'FINANCIAL_REPORT')).toBe('open');

    let latest = project;
    for (const type of ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'] as const) {
      const filed = await fileTask(project.id, type);
      await scanClean(filed.tasks.find((t) => t.type === type)!.document!.id);
      latest = (await call('get', `/projects/${project.id}`, 'officer').expect(200))
        .body as ProjectDetail;
    }
    expect(latest.status).toBe('completed');
    expect(latest.nextDeadline).toBeNull();
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).status).toBe(
      'completed',
    );
  });

  it('adds a re-upload as a new version of the same document', async () => {
    const project = await newProject();
    const first = await fileTask(project.id, 'PROPOSAL');
    const docId = first.tasks[0]!.document!.id;
    await scanClean(docId);
    const second = await fileTask(project.id, 'PROPOSAL');
    expect(second.tasks[0]).toMatchObject({ status: 'submitted', document: { id: docId } });
    expect(await db.documentVersion.count({ where: { documentId: docId } })).toBe(2);
  });
});

describe('pre-event documents (spec 2B, 2026-10-21)', () => {
  /** Uploads a PDF for a multi-file task with this label, or as a new version of `documentId`. */
  async function fileLabelled(
    projectId: string,
    type: ProjectTaskType,
    file: { label?: string; documentId?: string },
    visibility = 'private',
  ) {
    const url = await call(
      'post',
      `/projects/${projectId}/tasks/${type}/upload-url`,
      'officer',
      PDF,
    );
    expect(url.status, JSON.stringify(url.body)).toBe(201);
    const { uploadKey } = url.body as { uploadKey: string };
    return call('post', `/projects/${projectId}/tasks/${type}/documents`, 'officer', {
      uploadKey,
      visibility,
      actingAs: 'Juan Dela Cruz',
      ...file,
    });
  }
  const taskOf = (detail: ProjectDetail, type: ProjectTaskType) =>
    detail.tasks.find((t) => t.type === type)!;

  it('ticks letters and attendance on creation, dated on the event day and with the ACR', async () => {
    const project = await newProject({
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
    });
    expect(project).toMatchObject({
      communicationLetterRequired: true,
      attendanceSheetRequired: true,
    });
    expect(project.tasks.map((t) => t.type)).toEqual([
      'PROPOSAL',
      'COMMUNICATION_LETTER',
      'ATTENDANCE_SHEET',
      'OTHER_PRE_EVENT',
      'ACR',
      'FINANCIAL_REPORT',
    ]);
    expect(taskOf(project, 'COMMUNICATION_LETTER')).toMatchObject({
      status: 'locked',
      required: true,
      dueAt: endOfManilaDay(project.targetDate).toISOString(),
    });
    expect(taskOf(project, 'ATTENDANCE_SHEET').dueAt).toBe(project.postEventDueAt);
    expect(taskOf(project, 'OTHER_PRE_EVENT')).toMatchObject({ required: false, dueAt: null });
  });

  it('files several labelled letters; the task is submitted once one passes the scan', async () => {
    const project = await newProject({ communicationLetterRequired: true });
    const proposal = await fileTask(project.id, 'PROPOSAL');
    await scanClean(proposal.tasks[0]!.document!.id);

    const dean = await fileLabelled(project.id, 'COMMUNICATION_LETTER', {
      label: 'Letter to the Dean',
    });
    expect(dean.status, JSON.stringify(dean.body)).toBe(201);
    const guidance = await fileLabelled(project.id, 'COMMUNICATION_LETTER', {
      label: 'Letter to the Guidance Office',
    });
    const letters = taskOf(guidance.body as ProjectDetail, 'COMMUNICATION_LETTER');
    expect(letters.status).toBe('open');
    expect(letters.files.map((f) => f.label)).toEqual([
      'Letter to the Dean',
      'Letter to the Guidance Office',
    ]);

    recomputed.length = 0;
    await scanClean(letters.files[0]!.document.id);
    expect(recomputed).toEqual([project.targetDate]);
    const after = (await call('get', `/projects/${project.id}`, 'officer').expect(200))
      .body as ProjectDetail;
    expect(taskOf(after, 'COMMUNICATION_LETTER')).toMatchObject({ status: 'submitted' });
    expect(taskOf(after, 'COMMUNICATION_LETTER').submittedAt).not.toBeNull();

    // Each letter is its own private Paperworks document; the CSC sees neither file.
    const doc = await db.document.findUniqueOrThrow({
      where: { id: letters.files[0]!.document.id },
    });
    expect(doc).toMatchObject({
      visibility: 'private',
      title: `Communication Letter: Letter to the Dean (${project.name})`,
    });
    const asCsc = (await call('get', `/projects/${project.id}`, 'governor').expect(200))
      .body as ProjectDetail;
    expect(taskOf(asCsc, 'COMMUNICATION_LETTER')).toMatchObject({ status: 'submitted', files: [] });
  });

  it('uploads a new version of one letter, keeping its label', async () => {
    const project = await newProject({ communicationLetterRequired: true });
    await scanClean((await fileTask(project.id, 'PROPOSAL')).tasks[0]!.document!.id);
    const first = (
      await fileLabelled(project.id, 'COMMUNICATION_LETTER', { label: 'Letter to the Dean' })
    ).body as ProjectDetail;
    const id = taskOf(first, 'COMMUNICATION_LETTER').files[0]!.document.id;
    await scanClean(id);
    const again = await fileLabelled(project.id, 'COMMUNICATION_LETTER', { documentId: id });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(taskOf(again.body as ProjectDetail, 'COMMUNICATION_LETTER').files).toHaveLength(1);
    expect(await db.documentVersion.count({ where: { documentId: id } })).toBe(2);
  });

  it('400s a letter without a label, and a label on a one-file task', async () => {
    const project = await newProject({ communicationLetterRequired: true });
    await scanClean((await fileTask(project.id, 'PROPOSAL')).tasks[0]!.document!.id);
    await fileLabelled(project.id, 'COMMUNICATION_LETTER', {}).then((r) =>
      expect(r.status).toBe(400),
    );
    await fileLabelled(project.id, 'COMMUNICATION_LETTER', { label: 'x' }).then((r) =>
      expect(r.status).toBe(400),
    );
    await fileLabelled(project.id, 'PROPOSAL', { label: 'Proposal copy' }).then((r) =>
      expect(r.status).toBe(400),
    );
  });

  it('files other pre-event documents on any project, and completes without them', async () => {
    const project = await newProject({ targetDate: today });
    await scanClean((await fileTask(project.id, 'PROPOSAL')).tasks[0]!.document!.id);
    const other = await fileLabelled(project.id, 'OTHER_PRE_EVENT', { label: 'Venue reservation' });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    let latest = other.body as ProjectDetail;
    for (const type of ['ACR', 'FINANCIAL_REPORT'] as const) {
      const filed = await fileTask(project.id, type);
      await scanClean(taskOf(filed, type).document!.id);
      latest = (await call('get', `/projects/${project.id}`, 'officer').expect(200))
        .body as ProjectDetail;
    }
    // The other document is still scanning: optional, so the project completes anyway.
    expect(latest.status).toBe('completed');
  });

  it('refuses a letter the project did not tick (404), and before the proposal (409)', async () => {
    const plain = await newProject();
    await call(
      'post',
      `/projects/${plain.id}/tasks/COMMUNICATION_LETTER/upload-url`,
      'officer',
      PDF,
    ).expect(404);
    const ticked = await newProject({ attendanceSheetRequired: true });
    await call(
      'post',
      `/projects/${ticked.id}/tasks/ATTENDANCE_SHEET/upload-url`,
      'officer',
      PDF,
    ).expect(409);
  });

  it('keeps a tick that has a file (409) and lets the others change', async () => {
    const project = await newProject({ communicationLetterRequired: true });
    await scanClean((await fileTask(project.id, 'PROPOSAL')).tasks[0]!.document!.id);
    await fileLabelled(project.id, 'COMMUNICATION_LETTER', { label: 'Letter to the Dean' });
    await call('patch', `/projects/${project.id}`, 'officer', {
      communicationLetterRequired: false,
    }).expect(409);
    const ticked = (
      await call('patch', `/projects/${project.id}`, 'officer', {
        attendanceSheetRequired: true,
      }).expect(200)
    ).body as ProjectDetail;
    expect(taskOf(ticked, 'ATTENDANCE_SHEET').status).toBe('open');
    const unticked = (
      await call('patch', `/projects/${project.id}`, 'officer', {
        attendanceSheetRequired: false,
      }).expect(200)
    ).body as ProjectDetail;
    expect(unticked.tasks.map((t) => t.type)).not.toContain('ATTENDANCE_SHEET');
  });

  it('lets only the organization’s own account file a letter (401/403)', async () => {
    const project = await newProject({ communicationLetterRequired: true });
    const path = `/projects/${project.id}/tasks/COMMUNICATION_LETTER/documents`;
    const body = {
      uploadKey: 'uploads/x/y',
      visibility: 'private',
      actingAs: 'Juan',
      label: 'Dean',
    };
    await call('post', path, undefined, body).expect(401);
    await call('post', path, 'governor', body).expect(403);
    await call('post', path, 'psmeOfficer', body).expect(403);
  });
});

describe('extra project files (spec 2C)', () => {
  /** Full Paperworks details, as the upload form sends them. */
  const details = (visibility: string) => ({
    typeId: world.types.report.id,
    title: 'Site visit photos',
    description: 'Photos of the venue before the event.',
    academicYear: '2026-2027',
    semester: 'first',
    visibility,
    tags: ['venue', 'photos'],
    actingAs: 'Juan Dela Cruz',
  });

  async function addFile(projectId: string, visibility: string) {
    const url = await call('post', `/projects/${projectId}/files/upload-url`, 'officer', PDF);
    expect(url.status, JSON.stringify(url.body)).toBe(201);
    const { uploadKey } = url.body as { uploadKey: string };
    const res = await call('post', `/projects/${projectId}/files`, 'officer', {
      ...details(visibility),
      uploadKey,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as ProjectDetail;
  }

  it('lets only the organization’s own account add one (401/403)', async () => {
    const project = await newProject();
    for (const path of [`/projects/${project.id}/files/upload-url`, `/projects/${project.id}/files`]) {
      const body = path.endsWith('upload-url') ? PDF : { ...details('private'), uploadKey: 'uploads/x/y' };
      await call('post', path, undefined, body).expect(401);
      for (const who of ['student', 'governor', 'psmeOfficer', 'admin'] as const) {
        await call('post', path, who, body).expect(403);
      }
    }
  });

  it('files a Paperworks document with every detail; governing bodies see it once scanned', async () => {
    const project = await newProject();
    const added = await addFile(project.id, 'governing');
    expect(added.files).toHaveLength(1);
    const file = added.files[0]!.document;
    expect(file).toMatchObject({ title: 'Site visit photos', status: 'scanning', visibility: 'governing' });
    const stored = await db.document.findUniqueOrThrow({ where: { id: file.id } });
    expect(stored).toMatchObject({
      organizationId: world.orgs.jpice.id,
      typeId: world.types.report.id,
      description: 'Photos of the venue before the event.',
      semester: 'first',
      tags: ['venue', 'photos'],
    });
    // The checklist is untouched: the proposal is still open.
    expect(statusOf(added, 'PROPOSAL')).toBe('open');

    // While it is scanned only JPICE's account sees it; its CSC once it is clean.
    const before = (await call('get', `/projects/${project.id}`, 'governor')).body as ProjectDetail;
    expect(before.files).toEqual([]);
    await scanClean(file.id);
    const after = (await call('get', `/projects/${project.id}`, 'governor')).body as ProjectDetail;
    expect(after.files.map((f) => f.document.title)).toEqual(['Site visit photos']);
  });

  it('never shows a private one to a governing body', async () => {
    const project = await newProject();
    const added = await addFile(project.id, 'private');
    await scanClean(added.files[0]!.document.id);
    const council = (await call('get', `/projects/${project.id}`, 'governor')).body as ProjectDetail;
    expect(council.files).toEqual([]);
    const own = (await call('get', `/projects/${project.id}`, 'officer')).body as ProjectDetail;
    expect(own.files).toHaveLength(1);
  });

  it('takes extra files on a blocked project, whose checklist stays locked', async () => {
    const project = await newProject();
    // Created 20 days ago: the proposal deadline passed, so the check on read blocks it.
    await db.project.update({
      where: { id: project.id },
      data: { createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
    });
    const read = (await call('get', `/projects/${project.id}`, 'officer')).body as ProjectDetail;
    expect(read.status).toBe('blocked');
    const added = await addFile(project.id, 'private');
    expect(added.files).toHaveLength(1);
    await call('post', `/projects/${project.id}/tasks/PROPOSAL/upload-url`, 'officer', PDF).expect(409);
  });

  it('validates the details like any Paperworks upload', async () => {
    const project = await newProject();
    const res = await call('post', `/projects/${project.id}/files`, 'officer', {
      ...details('private'),
      title: '',
      uploadKey: 'uploads/x/y',
    });
    expect(res.status).toBe(400);
  });
});

describe('Financial Report figures', () => {
  it('requires the totals with a Financial Report file, and audits the first entry', async () => {
    const project = await newProject({ targetDate: today });
    const url = await call(
      'post',
      `/projects/${project.id}/tasks/FINANCIAL_REPORT/upload-url`,
      'officer',
      PDF,
    ).expect(201);
    const { uploadKey } = url.body as { uploadKey: string };
    const path = `/projects/${project.id}/tasks/FINANCIAL_REPORT/documents`;
    const file = { uploadKey, visibility: 'private', actingAs: 'Juan Dela Cruz' };
    await call('post', path, 'officer', file).expect(400);
    await call('post', path, 'officer', {
      ...file,
      figures: { incomeCentavos: -1, expensesCentavos: 0 },
    }).expect(400);

    const res = await call('post', path, 'officer', { ...file, figures: FIGURES }).expect(201);
    expect((res.body as ProjectDetail).financialFigures).toMatchObject({
      ...FIGURES,
      netCentavos: 1_034_550,
      underReview: null,
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'financial_figures_change', entityId: project.id },
    });
    expect(audit).toMatchObject({
      actorId: userIds.officer,
      actingAs: 'Juan Dela Cruz',
      metadata: { before: null, after: FIGURES },
    });
    // Its governing body reads the figures with the project.
    const read = await call('get', `/projects/${project.id}`, 'governor').expect(200);
    expect((read.body as ProjectDetail).financialFigures?.netCentavos).toBe(1_034_550);
  });

  it('lets only the organization’s own account correct them, audited with before and after', async () => {
    const project = await newProject({ targetDate: today });
    const path = `/projects/${project.id}/financial-figures`;
    const body = { incomeCentavos: 100, expensesCentavos: 300, actingAs: 'Maria Santos' };

    await call('patch', path, undefined, body).expect(401);
    await call('patch', path, 'governor', body).expect(403);
    await call('patch', path, 'psmeOfficer', body).expect(403);
    await call('patch', path, 'admin', body).expect(403);
    // Nothing to correct before the report is uploaded with its totals.
    await call('patch', path, 'officer', body).expect(409);

    await fileTask(project.id, 'FINANCIAL_REPORT', 'officer', 'private');
    await call('patch', path, 'officer', { incomeCentavos: 100, expensesCentavos: 300 }).expect(
      400,
    );
    const res = await call('patch', path, 'officer', body).expect(200);
    expect(res.body).toMatchObject({
      incomeCentavos: 100,
      expensesCentavos: 300,
      netCentavos: -200,
    });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'financial_figures_change', entityId: project.id, actingAs: 'Maria Santos' },
    });
    expect(audit.metadata).toEqual({
      before: FIGURES,
      after: { incomeCentavos: 100, expensesCentavos: 300 },
    });
  });
});

describe('PATCH /projects/:projectId', () => {
  it('moves the post-event deadlines with the target date, and audits the change', async () => {
    const project = await newProject();
    const later = addDays(today, 60);
    const res = await call('patch', `/projects/${project.id}`, 'officer', {
      targetDate: later,
      momRequired: true,
    }).expect(200);
    const updated = res.body as ProjectDetail;
    expect(updated.postEventDueAt).toBe(
      new Date(`${addDays(later, 14)}T23:59:59.999+08:00`).toISOString(),
    );
    expect(updated.tasks.map((t) => t.type)).toContain('MOM');
    expect(await db.projectTask.count({ where: { projectId: project.id, type: 'MOM' } })).toBe(1);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'project_update', entityId: project.id },
    });
    expect(audit.metadata).toEqual({ fields: ['targetDate', 'momRequired'] });
  });

  it('drops an optional task without a file, but not one that has a file', async () => {
    const project = await newProject({ nomRequired: true });
    await call('patch', `/projects/${project.id}`, 'officer', { nomRequired: false }).expect(200);
    expect(await db.projectTask.count({ where: { projectId: project.id, type: 'NOM' } })).toBe(0);

    const withNom = await newProject({ nomRequired: true });
    const proposal = await fileTask(withNom.id, 'PROPOSAL');
    await scanClean(proposal.tasks[0]!.document!.id);
    await fileTask(withNom.id, 'NOM');
    await call('patch', `/projects/${withNom.id}`, 'officer', { nomRequired: false }).expect(409);
  });

  it('refuses a past target date and an empty patch', async () => {
    const project = await newProject();
    await call('patch', `/projects/${project.id}`, 'officer', {
      targetDate: addDays(today, -3),
    }).expect(400);
    await call('patch', `/projects/${project.id}`, 'officer', {}).expect(400);
  });
});

describe('scheduled sync', () => {
  it('stores what the rules say for projects that are not completed', async () => {
    const project = await newProject({ targetDate: today });
    // Pretend the stored checklist is behind (e.g. created before the event day).
    await db.projectTask.updateMany({
      where: { projectId: project.id, type: { in: ['ACR', 'FINANCIAL_REPORT'] } },
      data: { status: 'locked' },
    });
    expect(await projectSync.syncAll()).toBeGreaterThan(0);
    const stored = await db.projectTask.findMany({
      where: { projectId: project.id, type: { in: ['ACR', 'FINANCIAL_REPORT'] } },
    });
    expect(stored.map((t) => t.status)).toEqual(['open', 'open']);
  });
});
