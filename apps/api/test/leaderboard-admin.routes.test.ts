import request from 'supertest';
import { pino } from 'pino';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AdminSemestersResponse,
  Disqualification,
  DisqualificationsResponse,
  SemesterCalendarResponse,
} from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { memoryLeaderboardStore } from '#src/lib/leaderboard-store';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDisqualificationRepository } from '#src/repositories/disqualification.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createLeaderboardRepository } from '#src/repositories/leaderboard.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createSemesterDatesRepository } from '#src/repositories/semester-dates.repository';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createAccessService } from '#src/services/access.service';
import { createDisqualificationService } from '#src/services/disqualification.service';
import { createLeaderboardService } from '#src/services/leaderboard.service';
import { createNotificationService } from '#src/services/notification.service';
import { createRecipients } from '#src/services/recipients.service';
import {
  createSemesterCalendarService,
  createSemesterReader,
} from '#src/services/semester-calendar.service';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildWorld, resetDb, testDb, type World } from './db';
import { buildTestApp } from './helpers';

/*
 * /semesters, /admin/semesters and /admin/disqualifications (spec 5B): anyone reads the dates;
 * only the ISSC account sets them and disqualifies. Against the real database.
 */

const db = testDb();
const tokens = createTokenService(testKeys());
let world: World;
let app: ReturnType<typeof buildTestApp>;
const tokenOf = {} as Record<'issc' | 'officer' | 'governor', string>;
/** Today is in the 1st semester of 2026-2027. */
let at = new Date('2026-11-02T04:00:00Z');
const forSemesters = vi.fn((..._keys: object[]) => Promise.resolve());

const SEMESTER = { academicYear: '2026-2027', semester: 'first' };
const OLD = { academicYear: '2025-2026', semester: 'first' };
const SEMESTER_PATH = '/admin/semesters/2026-2027/first';
const DATES = { start: '2026-08-17', end: '2026-12-18', actingAs: 'Ana Reyes' };

const call = (method: 'get' | 'put' | 'post', path: string, token?: string) => {
  const req = request(app)[method](`/api/v1${path}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

beforeAll(async () => {
  await resetDb(db);
  world = await buildWorld(db);
  for (const [who, user] of [
    ['issc', world.users.issc],
    ['officer', world.users.officer],
    ['governor', world.users.governor],
  ] as const) {
    tokenOf[who] = (await tokens.sign({ userId: user.id, passwordChangeRequired: false })).token;
  }
  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const audit = createAuditLogRepository(db);
  const cache = memoryCache();
  const dates = createSemesterDatesRepository(db);
  const semesters = createSemesterReader({ dates, cache });
  const settings = createSystemSettingsService({
    settings: createSystemSettingRepository(db),
    audit,
  });
  const leaderboard = createLeaderboardService({
    leaderboard: createLeaderboardRepository(db),
    settings,
    semesters,
    store: memoryLeaderboardStore(),
    now: () => at,
  });
  const recompute = { forSemesters };
  app = buildTestApp({
    tokens,
    access: createAccessService({
      accounts,
      organizations,
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
    }),
    semesters: createSemesterCalendarService({
      dates,
      semesters,
      leaderboard,
      settings,
      recompute,
      cache,
      audit,
      now: () => at,
    }),
    disqualifications: createDisqualificationService({
      disqualifications: createDisqualificationRepository(db),
      leaderboard,
      recompute,
      recipients: createRecipients({ accounts, organizations }),
      notifications: createNotificationService({
        notifications: createNotificationRepository(db),
        queue: { enqueueEmails: () => Promise.resolve() },
        logger: pino({ level: 'silent' }),
      }),
      audit,
      now: () => at,
    }),
  });
});

describe('admin access', () => {
  it('401s signed out, and 403s an SBO and a CSC account, on every route', async () => {
    const id = '0195f3c0-0000-7000-8000-0000000000d1';
    const routes: ['get' | 'put' | 'post', string][] = [
      ['get', '/admin/semesters'],
      ['put', SEMESTER_PATH],
      ['get', '/admin/disqualifications?academicYear=2026-2027&semester=first'],
      ['post', '/admin/disqualifications'],
      ['post', `/admin/disqualifications/${id}/lift`],
    ];
    for (const [method, path] of routes) {
      await call(method, path).expect(401);
      await call(method, path, tokenOf.officer).expect(403);
      await call(method, path, tokenOf.governor).expect(403);
    }
  });
});

describe('the semester calendar', () => {
  it('starts with no dates set, read by anyone and cached publicly', async () => {
    const res = await call('get', '/semesters').expect(200);
    expect((res.body as SemesterCalendarResponse).semesters).toEqual([]);
    expect(res.headers['cache-control']).toContain('public');
  });

  it('400s a request without "Acting as" or with dates out of order', async () => {
    await call('put', SEMESTER_PATH, tokenOf.issc)
      .send({ start: DATES.start, end: DATES.end })
      .expect(400);
    await call('put', SEMESTER_PATH, tokenOf.issc)
      .send({ ...DATES, end: '2026-08-01' })
      .expect(400);
    await call('put', '/admin/semesters/2026-2027/summer', tokenOf.issc).send(DATES).expect(400);
  });

  it('lets the ISSC account set them: public, audited, and the standings recomputed', async () => {
    forSemesters.mockClear();
    const res = await call('put', SEMESTER_PATH, tokenOf.issc).send(DATES).expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect((res.body as AdminSemestersResponse).semesters[0]).toMatchObject({
      ...SEMESTER,
      start: '2026-08-17',
      end: '2026-12-18',
      isSet: true,
      status: 'provisional',
      provisionalUntil: '2026-12-25',
    });
    expect(forSemesters).toHaveBeenCalledWith(SEMESTER, {
      academicYear: '2026-2027',
      semester: 'second',
    });

    const read = await call('get', '/semesters').expect(200);
    expect((read.body as SemesterCalendarResponse).semesters).toEqual([
      { ...SEMESTER, start: '2026-08-17', end: '2026-12-18' },
    ]);
    await expect(
      db.auditLog.findFirst({ where: { action: 'semester_dates_change' } }),
    ).resolves.toMatchObject({ actorId: world.users.issc.id, actingAs: 'Ana Reyes' });
  });

  it('409s a date that overlaps another semester', async () => {
    await call('put', '/admin/semesters/2026-2027/second', tokenOf.issc)
      .send({ start: '2026-12-10', end: '2027-05-20', actingAs: 'Ana Reyes' })
      .expect(409);
  });

  it('409s a final semester', async () => {
    await call('put', '/admin/semesters/2025-2026/first', tokenOf.issc)
      .send({ start: '2025-08-17', end: '2025-12-18', actingAs: 'Ana Reyes' })
      .expect(409);
  });
});

describe('disqualifications', () => {
  const body = () => ({
    organizationId: world.orgs.jpice.id,
    ...SEMESTER,
    reason: 'Falsified attendance sheets.',
    actingAs: 'Ana Reyes',
  });
  const list = async () =>
    (
      await call(
        'get',
        '/admin/disqualifications?academicYear=2026-2027&semester=first',
        tokenOf.issc,
      ).expect(200)
    ).body as DisqualificationsResponse;

  it('400s without a real reason or "Acting as"', async () => {
    await call('post', '/admin/disqualifications', tokenOf.issc)
      .send({ ...body(), reason: 'no' })
      .expect(400);
    await call('post', '/admin/disqualifications', tokenOf.issc)
      .send({ ...body(), actingAs: '' })
      .expect(400);
  });

  it('offers SBOs and CSCs, never the ISSC, and 404s the ISSC', async () => {
    const { organizations } = await list();
    expect(organizations.map((o) => o.type)).not.toContain('ISSC');
    expect(organizations.map((o) => o.id)).toContain(world.orgs.jpice.id);
    await call('post', '/admin/disqualifications', tokenOf.issc)
      .send({ ...body(), organizationId: world.orgs.issc.id })
      .expect(404);
  });

  it('disqualifies with a reason: audited, the organization told, once only', async () => {
    forSemesters.mockClear();
    const res = await call('post', '/admin/disqualifications', tokenOf.issc)
      .send(body())
      .expect(201);
    const created = res.body as Disqualification;
    expect(created).toMatchObject({ reason: 'Falsified attendance sheets.', lifted: null });
    expect(forSemesters).toHaveBeenCalledWith(SEMESTER);
    await expect(
      db.auditLog.findFirst({ where: { action: 'leaderboard_disqualify', entityId: created.id } }),
    ).resolves.toMatchObject({
      actorId: world.users.issc.id,
      actingAs: 'Ana Reyes',
      organizationId: world.orgs.jpice.id,
    });
    await expect(
      db.notification.findFirst({
        where: { kind: 'leaderboard_penalty', userId: world.users.officer.id },
      }),
    ).resolves.toMatchObject({ link: '/leaderboard' });
    await expect(
      createLeaderboardRepository(db).disqualifiedIn({
        academicYear: '2026-2027',
        semester: 'first',
      }),
    ).resolves.toEqual([world.orgs.jpice.id]);

    // The partial unique index: one standing per organization and semester.
    await call('post', '/admin/disqualifications', tokenOf.issc).send(body()).expect(409);
  });

  it('lifts it with a reason, and it may be disqualified again', async () => {
    const [standing] = (await list()).items;
    const lift = { reason: 'The sheets were checked again.', actingAs: 'Ben Cruz' };
    await call('post', `/admin/disqualifications/${standing!.id}/lift`, tokenOf.issc)
      .send({ ...lift, reason: 'no' })
      .expect(400);
    const res = await call('post', `/admin/disqualifications/${standing!.id}/lift`, tokenOf.issc)
      .send(lift)
      .expect(200);
    expect((res.body as Disqualification).lifted).toMatchObject(lift);
    await expect(
      createLeaderboardRepository(db).disqualifiedIn({
        academicYear: '2026-2027',
        semester: 'first',
      }),
    ).resolves.toEqual([]);
    await call('post', `/admin/disqualifications/${standing!.id}/lift`, tokenOf.issc)
      .send(lift)
      .expect(409);
    await call('post', '/admin/disqualifications', tokenOf.issc).send(body()).expect(201);
    const { items } = await list();
    expect(items[0]!.lifted).toBeNull();
    expect(items[1]!.lifted).not.toBeNull();
  });

  it('409s a final semester', async () => {
    await call('post', '/admin/disqualifications', tokenOf.issc)
      .send({ ...body(), ...OLD })
      .expect(409);
    const final = (
      await call(
        'get',
        '/admin/disqualifications?academicYear=2025-2026&semester=first',
        tokenOf.issc,
      ).expect(200)
    ).body as DisqualificationsResponse;
    expect(final.status).toBe('final');
  });

  it('goes final with the calendar: today past the last day plus the grace days', async () => {
    at = new Date('2026-12-26T04:00:00Z');
    expect((await list()).status).toBe('final');
    const [standing] = (await list()).items;
    await call('post', `/admin/disqualifications/${standing!.id}/lift`, tokenOf.issc)
      .send({ reason: 'The sheets were checked again.', actingAs: 'Ben Cruz' })
      .expect(409);
    at = new Date('2026-11-02T04:00:00Z');
  });
});

describe('final standings in the database (spec 5B)', () => {
  const OLD_KEY = { academicYear: '2024-2025', semester: 'second' as const };
  const repo = () => createLeaderboardRepository(db);

  it('stores one final board per semester and type: a second finisher changes nothing', async () => {
    const first = [{ organizationId: 'first-finisher', rank: 1 }];
    const second = [{ organizationId: 'second-finisher', rank: 1 }];
    const boards = (rows: object[]) => [
      { type: 'SBO' as const, rows },
      { type: 'CSC' as const, rows: [] },
    ];
    await expect(repo().finalSnapshots(OLD_KEY)).resolves.toEqual([]);

    await repo().saveFinal(OLD_KEY, boards(first), 0.5, new Date('2025-06-10T00:00:00Z'));
    await repo().saveFinal(OLD_KEY, boards(second), 0.25, new Date('2025-06-11T00:00:00Z'));

    const finals = await repo().finalSnapshots(OLD_KEY);
    expect(finals).toHaveLength(2);
    expect(finals.find((f) => f.type === 'SBO')).toMatchObject({ rows: first, latePoints: 0.5 });
  });

  it('keeps ordinary snapshots out of the final ones', async () => {
    const key = { academicYear: '2024-2025', semester: 'first' as const };
    await repo().saveSnapshot({ ...key, type: 'SBO' }, [], new Date('2025-01-01T00:00:00Z'));
    await expect(repo().finalSnapshots(key)).resolves.toEqual([]);
  });
});
