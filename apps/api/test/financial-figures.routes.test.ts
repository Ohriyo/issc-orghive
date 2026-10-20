import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FinancialFiguresListResponse } from '@orghive/shared';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createFinancialFiguresService } from '#src/services/financial-figures.service';
import { createNotificationService } from '#src/services/notification.service';
import { createRecipients } from '#src/services/recipients.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, createTestDocument, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

/*
 * /admin/financial-figures: the ISSC account puts reported Financial Report figures under
 * review (docs/PROJECT_WORKFLOW_SPEC.md, 5D). Only the ISSC account; never a file approval.
 */

const db = testDb();
const tokens = createTokenService(testKeys());
let world: World;
let app: ReturnType<typeof buildTestApp>;
const tokenOf = {} as Record<'admin' | 'officer' | 'governor', string>;
/** JPICE's project with submitted figures, and one whose report is still being scanned. */
let submittedId: string;
let scanningId: string;

/** A JPICE project on Oct 20 whose Financial Report is in the given state, with totals. */
async function projectWithFigures(name: string, status: 'available' | 'scanning') {
  const project = await db.project.create({
    data: {
      organizationId: world.orgs.jpice.id,
      name,
      targetDate: new Date('2026-10-20T00:00:00Z'),
      location: 'CEA',
      beneficiaries: 'Students',
      description: 'x',
      proposalDueAt: new Date('2026-10-15T15:59:59.999Z'),
      postEventDueAt: new Date('2026-11-03T15:59:59.999Z'),
      createdById: world.users.officer.id,
    },
  });
  const doc = await createTestDocument(db, {
    organizationId: world.orgs.jpice.id,
    typeId: world.types.report.id,
    title: `Financial Report: ${name}`,
    status,
    createdById: world.users.officer.id,
    visibility: 'private',
  });
  await db.projectTask.create({
    data: {
      projectId: project.id,
      type: 'FINANCIAL_REPORT',
      status: status === 'available' ? 'submitted' : 'open',
      documentId: doc.id,
      submittedAt: status === 'available' ? new Date('2026-10-25T02:00:00Z') : null,
    },
  });
  await db.financialFigures.create({
    data: { projectId: project.id, incomeCentavos: 500_000, expensesCentavos: 120_000 },
  });
  return project.id;
}

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  for (const [who, user] of [
    ['admin', world.users.issc],
    ['officer', world.users.officer],
    ['governor', world.users.governor],
  ] as const) {
    tokenOf[who] = (await tokens.sign({ userId: user.id, passwordChangeRequired: false })).token;
  }
  submittedId = await projectWithFigures('Tree Planting', 'available');
  scanningId = await projectWithFigures('Coastal Cleanup', 'scanning');

  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const projects = createProjectRepository(db);
  const documents = createDocumentRepository(db);
  app = buildTestApp({
    tokens,
    access: createAccessService({ accounts, organizations, documents, projects }),
    financialFigures: createFinancialFiguresService({
      figures: createFinancialFiguresRepository(db),
      projects,
      recipients: createRecipients({ accounts, organizations }),
      notifications: createNotificationService({
        notifications: createNotificationRepository(db),
        queue: { enqueueEmails: () => Promise.resolve() },
        logger: pino({ level: 'silent' }),
      }),
      audit: createAuditLogRepository(db),
    }),
  });
});

const call = (method: 'get' | 'put' | 'delete', path: string, token?: string) => {
  const req = request(app)[method](`/api/v1/admin${path}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

const LIST = '/financial-figures?academicYear=2026-2027&semester=first';
const flagPath = (id: string) => `/projects/${id}/financial-figures/flag`;

describe('/admin/financial-figures access', () => {
  const routes = (): ['get' | 'put' | 'delete', string][] => [
    ['get', LIST],
    ['put', flagPath(submittedId)],
    ['delete', flagPath(submittedId)],
  ];

  it('401s signed out, and 403s an SBO and a CSC account', async () => {
    for (const [method, path] of routes()) {
      await call(method, path).expect(401);
      await call(method, path, tokenOf.officer).expect(403);
      await call(method, path, tokenOf.governor).expect(403);
    }
  });
});

describe('/admin/financial-figures', () => {
  it('lists the semester’s submitted figures only, never cached', async () => {
    const res = await call('get', LIST, tokenOf.admin).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const { items } = res.body as FinancialFiguresListResponse;
    expect(items.map((i) => i.projectId)).toEqual([submittedId]);
    expect(items[0]).toMatchObject({
      projectName: 'Tree Planting',
      netCentavos: 380_000,
      underReview: null,
      organization: { slug: 'jpice' },
    });
    await call('get', '/financial-figures?academicYear=2026&semester=first', tokenOf.admin).expect(
      400,
    );
    const other = await call(
      'get',
      '/financial-figures?academicYear=2026-2027&semester=second',
      tokenOf.admin,
    ).expect(200);
    expect((other.body as FinancialFiguresListResponse).items).toEqual([]);
  });

  it('flags with a remark, tells JPICE, audits, and clears once', async () => {
    await call('put', flagPath(submittedId), tokenOf.admin).send({ remark: '' }).expect(400);
    const flagged = await call('put', flagPath(submittedId), tokenOf.admin)
      .send({ remark: 'Receipts do not add up' })
      .expect(200);
    expect(flagged.body).toMatchObject({ underReview: { remark: 'Receipts do not add up' } });
    expect(
      await db.notification.count({
        where: { userId: world.users.officer.id, kind: 'figures_review' },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: {
          action: 'financial_figures_flag',
          entityId: submittedId,
          actorId: world.users.issc.id,
        },
      }),
    ).toBe(1);
    // The flag is about the figures only: the file keeps its visibility.
    const task = await db.projectTask.findFirstOrThrow({
      where: { projectId: submittedId },
      select: { document: { select: { visibility: true } } },
    });
    expect(task.document?.visibility).toBe('private');

    const cleared = await call('delete', flagPath(submittedId), tokenOf.admin).expect(200);
    expect(cleared.body).toMatchObject({ underReview: null });
    await call('delete', flagPath(submittedId), tokenOf.admin).expect(200);
    expect(
      await db.auditLog.count({
        where: { action: 'financial_figures_unflag', entityId: submittedId },
      }),
    ).toBe(1);
  });

  it('404s a project without figures or one that does not exist', async () => {
    const bare = await db.project.create({
      data: {
        organizationId: world.orgs.jpice.id,
        name: 'No report yet',
        targetDate: new Date('2026-10-20T00:00:00Z'),
        location: 'CEA',
        beneficiaries: 'Students',
        description: 'x',
        proposalDueAt: new Date('2026-10-15T15:59:59.999Z'),
        postEventDueAt: new Date('2026-11-03T15:59:59.999Z'),
        createdById: world.users.officer.id,
      },
    });
    await call('put', flagPath(bare.id), tokenOf.admin).send({ remark: 'Check' }).expect(404);
    await call('put', flagPath('0195f3c0-0000-7000-8000-00000000ffff'), tokenOf.admin)
      .send({ remark: 'Check' })
      .expect(404);
    await call('put', '/projects/not-a-uuid/financial-figures/flag', tokenOf.admin)
      .send({ remark: 'Check' })
      .expect(400);
    // A report still being scanned can be flagged too: the figures exist.
    await call('put', flagPath(scanningId), tokenOf.admin).send({ remark: 'Check' }).expect(200);
  });
});
