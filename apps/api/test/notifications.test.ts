import pino from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, manilaDate } from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import { memoryMailer } from '#src/lib/mailer';
import { createAnnouncementRepository } from '#src/repositories/announcement.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createAnnouncementService } from '#src/services/announcement.service';
import { createNotificationMailer } from '#src/services/notification.service';
import { createTermReminders } from '#src/services/term-reminders.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceServices, buildComplianceWorld, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
let w: Awaited<ReturnType<typeof buildComplianceWorld>>;
let s: ReturnType<typeof buildComplianceServices>;

beforeEach(async () => {
  w = await buildComplianceWorld(db);
  s = buildComplianceServices(db);
});

/** `count` notifications for `who`, oldest first. */
async function notifyMany(who: Person, count: number) {
  for (let i = 0; i < count; i++) {
    await s.notifications.notify({
      userIds: [w.ids[who]],
      kind: 'deadline_soon',
      title: `Reminder ${i}`,
      body: 'Due soon.',
      link: null,
    });
  }
}

const kindsOf = async (who: Person) =>
  (await s.notifications.list(w.ids[who])).items.map((n) => n.kind);

describe('notificationService.list', () => {
  it('pages newest first and says when older ones remain', async () => {
    await notifyMany('officer', 3);
    const first = await s.notifications.list(w.ids.officer, { limit: 2 });
    expect(first.items.map((n) => n.title)).toEqual(['Reminder 2', 'Reminder 1']);
    expect(first.nextCursor).toBe(first.items[1]!.id);
    const second = await s.notifications.list(w.ids.officer, {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((n) => n.title)).toEqual(['Reminder 0']);
    expect(second.nextCursor).toBeNull();
  });

  it('lists only unread ones on request', async () => {
    await notifyMany('officer', 2);
    const [newest] = (await s.notifications.list(w.ids.officer)).items;
    await s.notifications.markRead(w.ids.officer, newest!.id);
    const unread = await s.notifications.list(w.ids.officer, { unread: true });
    expect(unread.items.map((n) => n.title)).toEqual(['Reminder 0']);
    expect(unread.unreadCount).toBe(1);
  });

  it("refuses another user's notification as a cursor", async () => {
    await notifyMany('officer', 1);
    const [theirs] = (await s.notifications.list(w.ids.officer)).items;
    await expect(
      s.notifications.list(w.ids.governor, { cursor: theirs!.id }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('email preferences', () => {
  it('start with every kind on, and save only what changes', async () => {
    const before = await s.notifications.preferences(w.ids.officer);
    expect(Object.values(before.email).every(Boolean)).toBe(true);
    const after = await s.notifications.updatePreferences(w.ids.officer, {
      email: { deadline_soon: false },
    });
    expect(after.email.deadline_soon).toBe(false);
    expect(after.email.appeal_decided).toBe(true);
    // Someone else's settings are untouched.
    expect((await s.notifications.preferences(w.ids.governor)).email.deadline_soon).toBe(true);
  });

  it('skip queueing the email for those who turned the kind off; in-app stays', async () => {
    await s.notifications.updatePreferences(w.ids.officer, { email: { deadline_soon: false } });
    s.queued.emails.length = 0;
    await s.notifications.notify({
      userIds: [w.ids.officer, w.ids.psmeOfficer],
      kind: 'deadline_soon',
      title: 'Due soon',
      body: 'Due soon.',
      link: null,
    });
    expect(s.queued.emails).toHaveLength(1);
    expect(await kindsOf('officer')).toEqual(['deadline_soon']);
  });

  it('also stop an email already queued before the user turned it off', async () => {
    await notifyMany('officer', 1);
    const [queued] = (await s.notifications.list(w.ids.officer)).items;
    await s.notifications.updatePreferences(w.ids.officer, { email: { deadline_soon: false } });
    const mailer = memoryMailer();
    const mail = createNotificationMailer({
      notifications: createNotificationRepository(db),
      mailer,
      webOrigin: 'http://localhost:5173',
    });
    expect(await mail.sendEmail(queued!.id)).toBe('skipped');
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('a new update notifies the accounts under its council', () => {
  function announcementsWith() {
    return createAnnouncementService({
      announcements: createAnnouncementRepository(db),
      organizations: createOrganizationRepository(db),
      accounts: createAccountRepository(db),
      audit: createAuditLogRepository(db),
      cache: memoryCache(),
      notifications: s.notifications,
      logger: pino({ level: 'silent' }),
    });
  }

  const told = async (who: Person) => (await kindsOf(who)).includes('announcement_posted');

  it("a CSC's update: its college's SBO accounts, not the author or other colleges", async () => {
    const posted = await announcementsWith().create(
      { userId: w.ids.governor },
      { id: w.orgs.cscCea.id, slug: 'csc-cea' },
      { title: 'Engineering Week', body: 'Booths open Monday.\n\nBring your IDs.' },
    );
    for (const who of ['officer', 'psmeOfficer'] as Person[]) {
      expect(await told(who)).toBe(true);
    }
    for (const who of ['governor', 'catSboOfficer', 'catGovernor', 'isscPresident'] as Person[]) {
      expect(await told(who)).toBe(false);
    }
    const [notice] = (await s.notifications.list(w.ids.officer)).items;
    expect(notice).toMatchObject({
      title: 'CSC-CEA: Engineering Week',
      body: 'Booths open Monday.',
      link: `/updates/${posted.id}`,
    });
  });

  it("the ISSC's update: every organization account but its own", async () => {
    await announcementsWith().create(
      { userId: w.ids.isscPresident },
      { id: w.orgs.issc.id, slug: 'issc' },
      { title: 'General assembly', body: 'Friday, 3 PM.' },
    );
    for (const who of ['officer', 'catSboOfficer', 'catGovernor', 'governor'] as Person[]) {
      expect(await told(who)).toBe(true);
    }
    // The ISSC account is the author (and the admin).
    expect(await told('isscPresident')).toBe(false);
    expect(await told('outsider')).toBe(false);
  });
});

describe('termReminders.run', () => {
  const today = manilaDate(new Date());
  const asDay = (iso: string) => new Date(`${iso}T00:00:00Z`);

  async function endTerm(who: Person, end: string) {
    await db.officerTerm.updateMany({
      where: { userId: w.ids[who], endedAt: null },
      data: { termEnd: asDay(end) },
    });
  }

  function reminders() {
    return createTermReminders({
      accounts: createAccountRepository(db),
      notifications: s.notifications,
    });
  }

  it('tells each account whose officer term ends within 14 days, once per end date', async () => {
    await endTerm('officer', addDays(today, 10));
    await endTerm('catGovernor', addDays(today, 14));
    await endTerm('psmeOfficer', addDays(today, 15));
    expect(await reminders().run()).toBe(2);
    await reminders().run();

    const notices = (await s.notifications.list(w.ids.officer)).items;
    expect(notices.filter((n) => n.kind === 'term_ending')).toHaveLength(1);
    expect(notices[0]!.title).toBe('JPICE: this officer term ends in 10 days');
    expect(await kindsOf('catGovernor')).toEqual(['term_ending']);
    expect(await kindsOf('psmeOfficer')).toEqual([]);
    expect(await kindsOf('governor')).toEqual([]);
  });

  it('announces again when the term is moved to a new end date', async () => {
    await endTerm('officer', addDays(today, 3));
    await reminders().run();
    await endTerm('officer', addDays(today, 5));
    await reminders().run();
    expect(await kindsOf('officer')).toEqual(['term_ending', 'term_ending']);
  });
});

describe('notification routes', () => {
  function appWith() {
    return buildTestApp({ tokens, notifications: s.notifications });
  }
  async function as(who: Person) {
    const { token } = await tokens.sign({
      userId: w.ids[who],
      passwordChangeRequired: false,
    });
    return `Bearer ${token}`;
  }

  it('need a session (401)', async () => {
    const app = appWith();
    await request(app).get('/api/v1/me/notification-preferences').expect(401);
    await request(app)
      .put('/api/v1/me/notification-preferences')
      .send({ email: { term_ending: false } })
      .expect(401);
    await request(app).get('/api/v1/me/notifications?unread=true').expect(401);
  });

  it('read and change the email settings, never cached', async () => {
    const app = appWith();
    const auth = await as('officer');
    const got = await request(app)
      .get('/api/v1/me/notification-preferences')
      .set('Authorization', auth)
      .expect(200);
    expect(got.headers['cache-control']).toBe('private, no-store');
    expect((got.body as { email: Record<string, boolean> }).email.term_ending).toBe(true);
    const put = await request(app)
      .put('/api/v1/me/notification-preferences')
      .set('Authorization', auth)
      .send({ email: { term_ending: false } })
      .expect(200);
    expect((put.body as { email: Record<string, boolean> }).email.term_ending).toBe(false);
  });

  it('refuse an empty change or an unknown kind (400)', async () => {
    const app = appWith();
    const auth = await as('officer');
    for (const body of [
      { email: {} },
      { email: { nope: true } },
      { email: { term_ending: 'no' } },
    ]) {
      await request(app)
        .put('/api/v1/me/notification-preferences')
        .set('Authorization', auth)
        .send(body)
        .expect(400);
    }
  });

  it('page the list through the query string', async () => {
    await notifyMany('officer', 3);
    const app = appWith();
    const auth = await as('officer');
    const page = await request(app)
      .get('/api/v1/me/notifications?limit=2&unread=true')
      .set('Authorization', auth)
      .expect(200);
    const body = page.body as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
    await request(app)
      .get(`/api/v1/me/notifications?cursor=${body.nextCursor}`)
      .set('Authorization', await as('governor'))
      .expect(404);
  });
});
