import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LeaderboardResponse, SemesterKey } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { createLeaderboardStream } from '#src/lib/leaderboard-stream';
import { memoryLeaderboardStore } from '#src/lib/leaderboard-store';
import { createPublicUrl } from '#src/lib/public-url';
import { createFinancialFiguresRepository } from '#src/repositories/financial-figures.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { createPublicLeaderboardService } from '#src/services/public-leaderboard.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { buildComplianceWorld, seedProject } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';

const FIRST = { academicYear: '2026-2027', semester: 'first' as const };

function board(rows: LeaderboardResponse['rows'] = []): LeaderboardResponse {
  return { ...FIRST, type: 'SBO', latePoints: 0.5, rows };
}

function stubbed() {
  const leaderboard = {
    read: vi.fn(() => Promise.resolve(board())),
    semesterOf: vi.fn(() => FIRST),
    boards: vi.fn((semester: SemesterKey) =>
      Promise.resolve({ ...semester, latePoints: 0.5, boards: { SBO: [], CSC: [] } }),
    ),
  };
  const stream = createLeaderboardStream({
    boards: leaderboard.boards,
    logger: { warn: vi.fn() },
  });
  const app = buildTestApp({
    leaderboard: leaderboard,
    leaderboardStream: stream,
  });
  return { app, leaderboard, stream };
}

describe('GET /api/v1/leaderboard', () => {
  it('answers signed out, cached publicly for 15 s with an ETag', async () => {
    const { app, leaderboard } = stubbed();
    const res = await request(app).get('/api/v1/leaderboard?type=SBO&college=cea');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(board());
    expect(res.headers['cache-control']).toBe('public, max-age=15');
    expect(res.headers.etag).toBeTruthy();
    expect(leaderboard.read).toHaveBeenCalledWith({ type: 'SBO', college: 'cea' });

    const again = await request(app)
      .get('/api/v1/leaderboard?type=SBO&college=cea')
      .set('If-None-Match', res.headers.etag as string);
    expect(again.status).toBe(304);
  });

  it.each([
    ['no type', ''],
    ['an unknown board', '?type=ALL'],
    ['the ISSC', '?type=ISSC'],
    ['half a semester', '?type=SBO&semester=first'],
    ['an unknown parameter', '?type=SBO&page=2'],
  ])('refuses %s with 400', async (_name, query) => {
    const { app, leaderboard } = stubbed();
    const res = await request(app).get(`/api/v1/leaderboard${query}`);
    expect(res.status).toBe(400);
    expect(leaderboard.read).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/leaderboard/stream', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.closeAllConnections();
      server.close(() => resolve());
    });
    server = undefined;
  });

  it('streams the boards signed out', async () => {
    const { app, leaderboard, stream } = stubbed();
    server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const body = await new Promise<string>((resolve, reject) => {
      const req = get(
        `http://127.0.0.1:${port}/api/v1/leaderboard/stream?academicYear=2026-2027&semester=first`,
        (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
            if (text.includes('event: standings')) {
              req.destroy();
              resolve(text);
            }
          });
        },
      );
      req.on('error', (err) => (req.destroyed ? undefined : reject(err)));
    });
    expect(body).toContain('"academicYear":"2026-2027"');
    expect(leaderboard.semesterOf).toHaveBeenCalledWith(FIRST);
    await vi.waitFor(() => expect(stream.connections()).toBe(0));
  });

  it('refuses a malformed semester with 400', async () => {
    const { app } = stubbed();
    const res = await request(app).get('/api/v1/leaderboard/stream?academicYear=2026');
    expect(res.status).toBe(400);
  });
});

describe('the public board, from the database (spec 5F)', () => {
  const db = testDb();
  const ACTING_AS = 'Juana Actingas';
  const OFFICER = 'Pedro Officername';
  const REMARK = 'Receipts do not add up';
  let response: LeaderboardResponse;

  beforeAll(async () => {
    const { orgs, ids } = await buildComplianceWorld(db);
    // The account's open term (the world opens one per account) names a real person.
    await db.officerTerm.updateMany({
      where: { userId: ids.officer, endedAt: null },
      data: { officerName: OFFICER, officerEmail: 'pedro.private@test.local' },
    });
    const project = await seedProject(db, {
      organizationId: orgs.jpice.id,
      createdById: ids.officer,
      createdAt: new Date('2026-09-01T02:00:00Z'),
      targetDate: '2026-09-15',
      filed: ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'],
    });
    await db.projectTask.updateMany({
      where: { projectId: project.id, documentId: { not: null } },
      // Within every deadline (the proposal's is Sep 15), so the project earns a full point.
      data: { status: 'submitted', submittedAt: new Date('2026-09-14T02:00:00Z') },
    });
    await db.documentVersion.updateMany({
      where: { document: { organizationId: orgs.jpice.id } },
      data: { actingAs: ACTING_AS },
    });
    const figures = createFinancialFiguresRepository(db);
    await figures.save(project.id, { incomeCentavos: 500_000, expensesCentavos: 123_400 });
    await figures.flag(project.id, { remark: REMARK, flaggedById: ids.admin, at: new Date() });

    const now = () => new Date('2026-12-01T02:00:00Z');
    const settings = createSystemSettingsService({
      settings: createSystemSettingRepository(db),
      audit: createAuditLogRepository(db),
    });
    const leaderboardReads = createLeaderboardRepository(db);
    const leaderboard = createLeaderboardService({
      leaderboard: leaderboardReads,
      settings,
      store: memoryLeaderboardStore(),
      now,
    });
    const app = buildTestApp({
      leaderboard: createPublicLeaderboardService({
        leaderboard,
        organizations: leaderboardReads,
        settings,
        cache: memoryCache(),
        publicUrl: createPublicUrl(TEST_ASSET_BASE_URL),
        now,
      }),
    });
    const res = await request(app).get(
      '/api/v1/leaderboard?type=SBO&academicYear=2026-2027&semester=first',
    );
    expect(res.status).toBe(200);
    response = res.body as LeaderboardResponse;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('ranks the organization with its breakdown and public fields only', () => {
    expect(response.rows).toHaveLength(1);
    const [jpice] = response.rows;
    expect(Object.keys(jpice!).sort()).toEqual(
      [
        'college',
        'implementedCount',
        'lateCount',
        'netProfitCentavos',
        'organization',
        'points',
        'rank',
        'rankChange',
        'underReviewCount',
      ].sort(),
    );
    // The flagged figures are left out of the total; the points still count.
    expect(jpice).toMatchObject({
      rank: 1,
      points: 1,
      implementedCount: 1,
      netProfitCentavos: 0,
      underReviewCount: 1,
    });
    expect(jpice!.organization.slug).toBe('jpice');
  });

  it('carries no officer names, acting-as names, remarks, emails or file links', () => {
    const text = JSON.stringify(response);
    for (const secret of [ACTING_AS, OFFICER, REMARK, '@test.local', 'storageKey', 'test/']) {
      expect(text).not.toContain(secret);
    }
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
