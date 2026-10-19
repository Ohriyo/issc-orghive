import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationKind } from '@orghive/shared';
import type { AuditAction } from '#src/generated/prisma/client';
import { memoryMailer } from '#src/lib/mailer';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createNotificationMailer } from '#src/services/notification.service';
import {
  buildComplianceServices,
  buildComplianceWorld,
  seedAttachment,
  seedProject,
  type Person,
} from './compliance-fixtures';
import { testDb } from './db';

// docs/PROJECT_WORKFLOW_SPEC.md, section 3. A JPICE project created Oct 1, 10:00 Manila,
// event Oct 20: the proposal is due Oct 15 and the reports Nov 3, 23:59:59 Manila.
const CREATED = new Date('2026-10-01T02:00:00Z');
const PROPOSAL_DUE = new Date('2026-10-15T15:59:59.999Z');
const REPORTS_DUE = new Date('2026-11-03T15:59:59.999Z');
const after = (at: Date, ms = 1) => new Date(at.getTime() + ms);

const db = testDb();
let w: Awaited<ReturnType<typeof buildComplianceWorld>>;
let s: ReturnType<typeof buildComplianceServices>;
const as = (who: Person) => ({ userId: w.ids[who] });
const jpice = () => ({ id: w.orgs.jpice.id, slug: w.orgs.jpice.slug });
const reason = 'Our adviser was on leave, so the proposal could not be signed in time.';

const audits = (action: AuditAction, entityId?: string) =>
  db.auditLog.count({ where: { action, ...(entityId && { entityId }) } });
const notified = (who: Person, kind: NotificationKind) =>
  db.notification.count({ where: { userId: w.ids[who], kind } });

function at(time: Date) {
  vi.setSystemTime(time);
}

function jpiceProject(
  extra: { filed?: ('PROPOSAL' | 'ACR' | 'FINANCIAL_REPORT')[]; name?: string } = {},
) {
  return seedProject(db, {
    organizationId: w.orgs.jpice.id,
    createdById: w.ids.officer,
    createdAt: CREATED,
    targetDate: '2026-10-20',
    ...extra,
  });
}

/** A JPICE project past its proposal deadline, blocked by the hourly check. */
async function blockedProject() {
  const project = await jpiceProject();
  at(after(PROPOSAL_DUE, 60_000));
  await s.sync.syncAll();
  return project;
}

// Each test rebuilds the database, which can be slow on Docker Desktop (fsync) when the
// whole suite runs; the default 10 s hook limit then overlaps two rebuilds.
const DB_TIMEOUT = 60_000;
vi.setConfig({ testTimeout: DB_TIMEOUT, hookTimeout: DB_TIMEOUT });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  at(CREATED);
  w = await buildComplianceWorld(db);
  s = buildComplianceServices(db);
}, DB_TIMEOUT);

afterEach(() => {
  vi.useRealTimers();
});

describe('the hourly compliance check', () => {
  it('blocks a project only after its proposal deadline, once however often it runs', async () => {
    const project = await jpiceProject();

    at(PROPOSAL_DUE);
    await s.sync.syncAll();
    expect((await s.repos.projects.findById(project.id))!.status).toBe('active');

    at(after(PROPOSAL_DUE));
    await s.sync.syncAll();
    await s.sync.syncAll();
    const blocked = (await s.repos.projects.findById(project.id))!;
    expect(blocked.status).toBe('blocked');
    expect(blocked.tasks.map((t) => t.status)).toEqual(['locked', 'locked', 'locked']);
    expect(await audits('project_block', project.id)).toBe(1);
    expect(await notified('officer', 'deadline_missed')).toBe(1);
    // Only the organization's own account is told, and each email is queued once.
    expect(await notified('psmeOfficer', 'deadline_missed')).toBe(0);
    // Plus the "due in 3 days" reminder sent earlier: one email per notification.
    expect(await notified('officer', 'deadline_soon')).toBe(1);
    expect(s.queued.emails).toHaveLength(await db.notification.count());
  });

  it('freezes the organization once when a report is overdue; a late upload does not lift it', async () => {
    const project = await jpiceProject({ filed: ['PROPOSAL'] });

    at(REPORTS_DUE);
    await s.sync.syncAll();
    expect(await s.repos.freezes.listOpen(w.orgs.jpice.id)).toEqual([]);

    at(after(REPORTS_DUE));
    await s.sync.syncAll();
    await s.sync.syncAll();
    const open = await s.repos.freezes.listOpen(w.orgs.jpice.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ projectId: project.id, reports: ['ACR', 'FINANCIAL_REPORT'] });
    expect(await audits('org_freeze', open[0]!.id)).toBe(1);
    expect(await notified('officer', 'deadline_missed')).toBe(1);

    await expect(
      s.projectService.create(as('officer'), jpice(), {
        name: 'Seminar',
        targetDate: '2026-12-01',
        location: 'CEA',
        beneficiaries: 'Students',
        description: 'A seminar.',
      }),
    ).rejects.toMatchObject({ status: 403, code: 'ORGANIZATION_FROZEN' });

    // The reports arrive late: the freeze stays until an appeal is approved.
    const late = await jpiceProject({ filed: ['PROPOSAL', 'ACR', 'FINANCIAL_REPORT'] });
    expect(late).toBeDefined();
    await s.sync.syncAll();
    expect(await s.repos.freezes.listOpen(w.orgs.jpice.id)).toHaveLength(1);
  });

  it('applies a passed deadline on read, before the hourly job runs', async () => {
    const project = await jpiceProject();
    at(after(PROPOSAL_DUE));
    const read = await s.projectService.get(as('officer'), jpice(), project.id);
    expect(read.status).toBe('blocked');
    expect(await audits('project_block', project.id)).toBe(1);
    await s.sync.syncAll();
    expect(await audits('project_block', project.id)).toBe(1);
  });

  it('reminds the officers 3 days before a deadline, once', async () => {
    await jpiceProject();
    // Oct 12, 09:00 Manila.
    at(new Date('2026-10-12T01:00:00Z'));
    await s.sync.syncAll();
    await s.sync.syncAll();
    expect(await notified('officer', 'deadline_soon')).toBe(1);
  });
});

describe('appeals of a blocked SBO project', () => {
  it('go to the college CSC Governor, and only to them', async () => {
    const project = await blockedProject();
    const appeal = await s.appeals.submit(as('officer'), jpice(), {
      type: 'PROJECT_BLOCK',
      projectId: project.id,
      reason,
      attachmentIds: [],
    });
    expect(appeal).toMatchObject({
      status: 'pending',
      decider: { acronym: 'CSC-CEA' },
      canDecide: false,
    });
    expect(await audits('appeal_submit', appeal.id)).toBe(1);
    expect(await notified('governor', 'appeal_submitted')).toBe(1);
    expect(await notified('catGovernor', 'appeal_submitted')).toBe(0);

    expect((await s.appeals.queue(as('governor'), { status: 'pending' })).items).toEqual([
      expect.objectContaining({ id: appeal.id, canDecide: true }),
    ]);
    for (const who of ['catGovernor', 'isscPresident', 'psmeOfficer'] as const) {
      expect((await s.appeals.queue(as(who), { status: 'pending' })).items, who).toEqual([]);
      await expect(
        s.appeals.decide(as(who), appeal.id, { decision: 'reject', remarks: 'Not convinced.' }),
        who,
      ).rejects.toMatchObject({
        status: 403,
        message: 'Only the CSC-CEA account decides this appeal.',
      });
    }
  });

  it('cannot be submitted twice while one is pending, nor for a project that is not blocked', async () => {
    const project = await blockedProject();
    const input = {
      type: 'PROJECT_BLOCK' as const,
      projectId: project.id,
      reason,
      attachmentIds: [],
    };
    await s.appeals.submit(as('officer'), jpice(), input);
    await expect(s.appeals.submit(as('officer'), jpice(), input)).rejects.toMatchObject({
      status: 409,
    });
    const fine = await jpiceProject({ filed: ['PROPOSAL'] });
    await expect(
      s.appeals.submit(as('officer'), jpice(), { ...input, projectId: fine.id }),
    ).rejects.toMatchObject({ status: 409 });
    // Another organization's project is not found.
    await expect(
      s.appeals.submit(as('psmeOfficer'), { id: w.orgs.psme.id, slug: 'psme' }, input),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reject keeps it blocked with remarks shown; appeal again; approve unblocks until the new date', async () => {
    const project = await blockedProject();
    const input = {
      type: 'PROJECT_BLOCK' as const,
      projectId: project.id,
      reason,
      attachmentIds: [],
    };
    const first = await s.appeals.submit(as('officer'), jpice(), input);

    const rejected = await s.appeals.decide(as('governor'), first.id, {
      decision: 'reject',
      remarks: 'Attach the adviser’s leave notice.',
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      remarks: 'Attach the adviser’s leave notice.',
      decidedBy: { name: 'csc-cea' },
    });
    expect((await s.repos.projects.findById(project.id))!.status).toBe('blocked');
    expect(await audits('reject', first.id)).toBe(1);
    expect(await notified('officer', 'appeal_decided')).toBe(1);
    await expect(
      s.appeals.decide(as('governor'), first.id, { decision: 'approve', newDueDate: '2026-10-25' }),
    ).rejects.toMatchObject({ status: 409 });

    const compliance = await s.appeals.compliance(jpice());
    expect(compliance.blockedProjects).toEqual([
      expect.objectContaining({
        id: project.id,
        pendingAppeal: null,
        lastRejection: expect.objectContaining({
          remarks: 'Attach the adviser’s leave notice.',
        }) as unknown,
      }),
    ]);

    const second = await s.appeals.submit(as('officer'), jpice(), input);
    const approved = await s.appeals.decide(as('governor'), second.id, {
      decision: 'approve',
      newDueDate: '2026-10-25',
    });
    expect(approved).toMatchObject({ status: 'approved', newDueAt: '2026-10-25T15:59:59.999Z' });
    const unblocked = (await s.repos.projects.findById(project.id))!;
    expect(unblocked.status).toBe('active');
    expect(unblocked.proposalDueAt.toISOString()).toBe('2026-10-25T15:59:59.999Z');
    expect(unblocked.tasks.find((t) => t.type === 'PROPOSAL')!.status).toBe('open');
    expect(await audits('approve', second.id)).toBe(1);
    expect(await audits('project_unblock', project.id)).toBe(1);

    const history = await s.appeals.listForProject(as('officer'), jpice(), project.id);
    expect(history.items.map((a) => a.status)).toEqual(['approved', 'rejected']);

    // The new deadline passes without a proposal: blocked again.
    at(after(new Date('2026-10-25T15:59:59.999Z')));
    await s.sync.syncAll();
    expect((await s.repos.projects.findById(project.id))!.status).toBe('blocked');
    expect(await audits('project_block', project.id)).toBe(2);
  });

  it('nobody decides their own appeal: a CSC’s goes to the ISSC, not to itself', async () => {
    const project = await seedProject(db, {
      organizationId: w.orgs.cscCea.id,
      createdById: w.ids.governor,
      createdAt: CREATED,
      targetDate: '2026-10-20',
    });
    at(after(PROPOSAL_DUE));
    await s.sync.syncAll();
    const appeal = await s.appeals.submit(
      as('governor'),
      { id: w.orgs.cscCea.id, slug: w.orgs.cscCea.slug },
      { type: 'PROJECT_BLOCK', projectId: project.id, reason, attachmentIds: [] },
    );
    expect((await s.appeals.queue(as('governor'), { status: 'pending' })).items).toEqual([]);
    await expect(
      s.appeals.decide(as('governor'), appeal.id, {
        decision: 'approve',
        newDueDate: '2026-10-25',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('appeals of a CSC, and of an SBO whose CSC has no active account', () => {
  it('a CSC appeal is decided only by the ISSC account', async () => {
    const project = await seedProject(db, {
      organizationId: w.orgs.cscCea.id,
      createdById: w.ids.governor,
      createdAt: CREATED,
      targetDate: '2026-10-20',
    });
    at(after(PROPOSAL_DUE));
    await s.sync.syncAll();
    const csc = { id: w.orgs.cscCea.id, slug: w.orgs.cscCea.slug };
    const appeal = await s.appeals.submit(as('governor'), csc, {
      type: 'PROJECT_BLOCK',
      projectId: project.id,
      reason,
      attachmentIds: [],
    });
    expect(appeal.decider.acronym).toBe('ISSC');
    expect(await notified('isscPresident', 'appeal_submitted')).toBe(1);
    await expect(
      s.appeals.decide(as('catGovernor'), appeal.id, {
        decision: 'approve',
        newDueDate: '2026-10-25',
      }),
    ).rejects.toMatchObject({ message: 'Only the ISSC account decides this appeal.' });
    await expect(
      s.appeals.decide(as('isscPresident'), appeal.id, {
        decision: 'approve',
        newDueDate: '2026-10-25',
      }),
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it('the ISSC account decides while the CSC’s seat is vacant, as an audited override', async () => {
    // CSC-CAT's account is locked (for example, unassigned after the end of term).
    await db.user.update({ where: { id: w.ids.catGovernor }, data: { lockedAt: new Date() } });
    const project = await seedProject(db, {
      organizationId: w.orgs.catSbo.id,
      createdById: w.ids.catSboOfficer,
      createdAt: CREATED,
      targetDate: '2026-10-20',
    });
    at(after(PROPOSAL_DUE));
    await s.sync.syncAll();
    const appeal = await s.appeals.submit(
      as('catSboOfficer'),
      { id: w.orgs.catSbo.id, slug: 'cat-sbo' },
      { type: 'PROJECT_BLOCK', projectId: project.id, reason, attachmentIds: [] },
    );
    expect(await notified('admin', 'appeal_submitted')).toBe(1);
    expect((await s.appeals.queue(as('admin'), { status: 'pending' })).items).toHaveLength(1);
    await s.appeals.decide(as('admin'), appeal.id, {
      decision: 'approve',
      newDueDate: '2026-10-25',
    });
    expect(
      await db.auditLog.count({ where: { action: 'admin_override', entityId: appeal.id } }),
    ).toBe(1);
  });
});

describe('a freeze appeal', () => {
  it('lifts the freeze and moves the report deadline when approved', async () => {
    const project = await jpiceProject({ filed: ['PROPOSAL'] });
    at(after(REPORTS_DUE));
    await s.sync.syncAll();
    const before = await s.appeals.compliance(jpice());
    expect(before.frozen).toBe(true);
    const freezeId = before.freezes[0]!.id;

    const appeal = await s.appeals.submit(as('officer'), jpice(), {
      type: 'ORG_FREEZE',
      freezeId,
      reason,
      attachmentIds: [],
    });
    expect(appeal.freeze).toEqual({ id: freezeId, reports: ['ACR', 'FINANCIAL_REPORT'] });
    expect((await s.appeals.compliance(jpice())).freezes[0]!.pendingAppeal).toMatchObject({
      id: appeal.id,
    });

    await s.appeals.decide(as('governor'), appeal.id, {
      decision: 'approve',
      newDueDate: '2026-11-20',
    });
    const afterward = await s.appeals.compliance(jpice());
    expect(afterward).toMatchObject({ frozen: false, freezes: [] });
    expect(await audits('org_unfreeze', freezeId)).toBe(1);
    expect((await s.repos.projects.findById(project.id))!.postEventDueAt.toISOString()).toBe(
      '2026-11-20T15:59:59.999Z',
    );
    // A second check does not freeze it again before the new deadline.
    await s.sync.syncAll();
    expect((await s.appeals.compliance(jpice())).frozen).toBe(false);
    await expect(
      s.appeals.submit(as('officer'), jpice(), {
        type: 'ORG_FREEZE',
        freezeId,
        reason,
        attachmentIds: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('appeal attachments', () => {
  it('must pass the virus scan before an appeal can include them', async () => {
    const project = await blockedProject();
    const attachment = await seedAttachment(s, jpice(), w.ids.officer);
    expect(attachment).toMatchObject({ scanStatus: 'pending', filename: 'adviser-letter.pdf' });
    expect(s.queued.scans).toEqual([attachment.id]);

    const input = {
      type: 'PROJECT_BLOCK' as const,
      projectId: project.id,
      reason,
      attachmentIds: [attachment.id],
    };
    await expect(s.appeals.submit(as('officer'), jpice(), input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('still being checked') as unknown,
    });

    expect(await s.attachments.processAttachment(attachment.id)).toBe('clean');
    expect(await s.attachments.processAttachment(attachment.id)).toBe('skipped');
    const appeal = await s.appeals.submit(as('officer'), jpice(), input);
    expect(appeal.attachments).toEqual([expect.objectContaining({ scanStatus: 'clean' })]);

    // JPICE's account and the deciding account may open it; nobody else learns it exists.
    await expect(
      s.appeals.attachmentDownload(as('governor'), appeal.id, attachment.id),
    ).resolves.toMatchObject({ url: expect.stringContaining('?get') as unknown });
    await s.appeals.attachmentDownload(as('officer'), appeal.id, attachment.id);
    for (const who of ['psmeOfficer', 'outsider', 'catGovernor', 'isscPresident'] as const) {
      await expect(
        s.appeals.attachmentDownload(as(who), appeal.id, attachment.id),
        who,
      ).rejects.toMatchObject({ status: 404 });
    }
    const views = await db.auditLog.findMany({
      where: { action: 'appeal_attachment_view', entityId: attachment.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(views.map((v) => (v.metadata as { access: string }).access)).toEqual([
      'decider',
      'organization',
    ]);
    // Already part of an appeal.
    await expect(s.appeals.getAttachment(jpice(), attachment.id)).resolves.toBeDefined();
  });

  it('a refused file is quarantined and cannot be attached; another org’s file is not found', async () => {
    const project = await blockedProject();
    s.verdict.clean = false;
    const infected = await seedAttachment(s, jpice(), w.ids.officer);
    expect(await s.attachments.processAttachment(infected.id)).toBe('infected');
    const stored = await db.appealAttachment.findUniqueOrThrow({ where: { id: infected.id } });
    expect(stored.storageKey).toMatch(/^quarantine\//);
    expect(await audits('quarantine', infected.id)).toBe(1);

    const input = {
      type: 'PROJECT_BLOCK' as const,
      projectId: project.id,
      reason,
      attachmentIds: [infected.id],
    };
    await expect(s.appeals.submit(as('officer'), jpice(), input)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('refused') as unknown,
    });

    s.verdict.clean = true;
    const psmeFile = await seedAttachment(
      s,
      { id: w.orgs.psme.id, slug: 'psme' },
      w.ids.psmeOfficer,
    );
    await expect(
      s.appeals.submit(as('officer'), jpice(), { ...input, attachmentIds: [psmeFile.id] }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(s.appeals.getAttachment(jpice(), psmeFile.id)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('notifications', () => {
  it('are listed newest first, marked read, and emailed once each', async () => {
    await blockedProject();
    const list = await s.notifications.list(w.ids.officer);
    expect(list.unreadCount).toBe(1);
    const [first] = list.items;
    expect(first).toMatchObject({ kind: 'deadline_missed', readAt: null });
    expect(first!.link).toMatch(/^\/projects\//);

    await expect(s.notifications.markRead(w.ids.governor, first!.id)).rejects.toMatchObject({
      status: 404,
    });
    await s.notifications.markRead(w.ids.officer, first!.id);
    expect((await s.notifications.list(w.ids.officer)).unreadCount).toBe(0);

    const mailer = memoryMailer();
    const mail = createNotificationMailer({
      notifications: createNotificationRepository(db),
      mailer,
      webOrigin: 'http://localhost:5173',
    });
    expect(await mail.sendEmail(first!.id)).toBe('sent');
    expect(await mail.sendEmail(first!.id)).toBe('skipped');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: 'jpice@test.local',
      subject: expect.stringContaining('is blocked') as unknown,
    });
    expect(mailer.sent[0]!.text).toContain('http://localhost:5173/projects/');
  });

  it('mark all read', async () => {
    await blockedProject();
    await s.notifications.markAllRead(w.ids.officer);
    expect((await s.notifications.list(w.ids.officer)).unreadCount).toBe(0);
  });
});
