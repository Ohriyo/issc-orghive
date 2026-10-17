import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SemestralReport } from '@orghive/shared';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createMembershipRepository } from '#src/repositories/membership.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceWorld, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';
import { buildReportService } from './report-fixtures';

const db = testDb();
const tokens = createTokenService(testKeys());
let app: ReturnType<typeof buildTestApp>;
let s: ReturnType<typeof buildReportService>;
const tokenOf = {} as Record<Person, string>;
const BODY = { academicYear: '2026-2027', semester: 'first' };

beforeAll(async () => {
  const w = await buildComplianceWorld(db);
  s = buildReportService(db);
  for (const [who, userId] of Object.entries(w.ids)) {
    tokenOf[who as Person] = (
      await tokens.sign({ userId, roles: [], isAdmin: false, passwordChangeRequired: false })
    ).token;
  }
  app = buildTestApp({
    tokens,
    access: createAccessService({
      memberships: createMembershipRepository(db),
      organizations: createOrganizationRepository(db),
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
      audit: createAuditLogRepository(db),
    }),
    reports: s.service,
  });
}, 60_000);

function call(method: 'get' | 'post', who?: Person, body?: object) {
  let req = request(app)[method]('/api/v1/organizations/jpice/semestral-reports');
  if (who) req = req.set('Authorization', `Bearer ${tokenOf[who]}`);
  return body ? req.send(body) : req;
}

describe('/organizations/:slug/semestral-reports', () => {
  it('401s without a session', async () => {
    await call('get').expect(401);
    await call('post', undefined, BODY).expect(401);
  });

  it('403s anyone but the organization’s own officers asking for one (admins too)', async () => {
    for (const who of ['adviser', 'psmeOfficer', 'admin', 'governor'] as const) {
      await call('post', who, BODY).expect(403);
    }
  });

  it('403s the list to advisers and other organizations; admins see it (audited)', async () => {
    await call('get', 'adviser').expect(403);
    await call('get', 'psmeOfficer').expect(403);
    await call('get', 'admin').expect(200);
  });

  it('400s an invalid semester or academic year', async () => {
    await call('post', 'officer', { academicYear: '2026-2028', semester: 'first' }).expect(400);
    await call('post', 'officer', { academicYear: '2026-2027', semester: 'summer' }).expect(400);
  });

  it('queues a report for the officer (202), once per semester at a time', async () => {
    const res = await call('post', 'officer', BODY).expect(202);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const report = res.body as SemestralReport;
    expect(report).toMatchObject({ status: 'queued', progress: 0, semester: 'first' });
    expect(s.queued).toContain(report.id);
    await call('post', 'officer', BODY).expect(409);

    const list = await call('get', 'officer').expect(200);
    expect((list.body as { items: SemestralReport[] }).items.map((r) => r.id)).toEqual([report.id]);
  });
});
