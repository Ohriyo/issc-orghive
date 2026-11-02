import { describe, expect, it, vi } from 'vitest';
import type { DocumentViewer } from '#src/repositories/document-visibility';
import type { DecisionRecord } from '#src/repositories/task-file-decision.repository';
import { createTaskFileDecisionService } from '#src/services/task-file-decision.service';

const CSC: DocumentViewer = {
  kind: 'account',
  userId: 'u-csc',
  organizationId: 'csc-cea',
  organizationType: 'CSC',
};
const ISSC: DocumentViewer = {
  kind: 'account',
  userId: 'u-issc',
  organizationId: 'issc',
  organizationType: 'ISSC',
};
const AT = new Date('2026-10-16T00:00:00Z');
const TARGET = new Date('2026-11-05T00:00:00Z');
const project = { id: 'p1', name: 'Seminar', targetDate: TARGET, deletedAt: null };

/** JPICE's Proposal (or a letter), current version v1, its checks warning by default. */
function record(patch: Partial<DecisionRecord> = {}, warn = true): DecisionRecord {
  return {
    id: 'd1',
    title: 'Project Proposal: Seminar',
    status: 'available',
    deletedAt: null,
    visibility: 'governing',
    currentVersionId: 'v1',
    currentVersion: {
      scanStatus: 'clean',
      checks: [
        {
          kind: 'keywords',
          result: warn ? 'warn' : 'pass',
          message: warn ? 'Could not find: JPICE.' : 'Found them all.',
        },
      ],
      integrity: {
        legacy: false,
        checkedAt: AT,
        warningsClearedAt: null,
        flaggedAt: null,
        flagReason: null,
        replacesFlagged: false,
      },
    },
    versions: [{ id: 'v1', scanStatus: 'clean', failureReason: null }],
    organization: {
      id: 'jpice',
      type: 'SBO',
      parentId: 'csc-cea',
      slug: 'jpice',
      acronym: 'JPICE',
    },
    projectTask: { type: 'PROPOSAL', project },
    taskFile: null,
    ...patch,
  };
}

function setup(
  options: {
    viewer?: DocumentViewer;
    found?: DecisionRecord | null;
    officers?: string[];
    candidates?: DecisionRecord[];
  } = {},
) {
  const found = 'found' in options ? options.found : record();
  const decisions = {
    findForDecision: vi.fn(() => Promise.resolve(found ?? null)),
    attentionCandidates: vi.fn(() => Promise.resolve(options.candidates ?? [])),
    clearWarnings: vi.fn(() => Promise.resolve(true)),
    flag: vi.fn(() => Promise.resolve(true)),
  };
  const notify = vi.fn(() => Promise.resolve());
  const record_ = vi.fn(() => Promise.resolve());
  const forEventDates = vi.fn(() => Promise.resolve());
  const service = createTaskFileDecisionService({
    decisions,
    viewers: { forUser: () => Promise.resolve(options.viewer ?? CSC) },
    recipients: { officersOf: () => Promise.resolve(options.officers ?? ['u-jpice']) },
    notifications: { notify },
    audit: { record: record_ },
    leaderboard: { forEventDates },
    now: () => AT,
  });
  return { service, decisions, notify, audit: record_, forEventDates };
}

const ctx = { ip: '127.0.0.1', userAgent: 'test' };

describe('taskFileDecisionService.clearWarnings', () => {
  it('clears a file with warnings for its CSC, and tells the organization', async () => {
    const { service, decisions, notify, audit, forEventDates } = setup();
    await service.clearWarnings('u-csc', 'd1', { actingAs: 'Ana Reyes', note: '  ' }, ctx);
    expect(decisions.clearWarnings).toHaveBeenCalledWith('v1', {
      byId: 'u-csc',
      actingAs: 'Ana Reyes',
      note: null,
      at: AT,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'task_file_clear_warnings', actingAs: 'Ana Reyes' }),
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_file_checked',
        title: 'Verified ✓: Project Proposal, Seminar',
        body: expect.stringMatching(/^Your CSC looked at the warnings/) as string,
      }),
    );
    expect(forEventDates).toHaveBeenCalledWith(TARGET);
  });

  it('409s when another decision got there first', async () => {
    const { service, decisions, audit } = setup();
    decisions.clearWarnings.mockResolvedValueOnce(false);
    await expect(
      service.clearWarnings('u-csc', 'd1', { actingAs: 'Ana Reyes' }, ctx),
    ).rejects.toMatchObject({ status: 409 });
    expect(audit).not.toHaveBeenCalled();
  });

  it('tells nobody when the organization has no active account', async () => {
    const { service, notify } = setup({ officers: [] });
    await service.clearWarnings('u-csc', 'd1', { actingAs: 'Ana Reyes' }, ctx);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('taskFileDecisionService.flag', () => {
  it('flags a letter for the ISSC, naming the letter', async () => {
    const letter = record(
      {
        projectTask: null,
        taskFile: { label: 'Letter to the Dean', task: { type: 'COMMUNICATION_LETTER', project } },
      },
      false,
    );
    const { service, decisions, notify } = setup({ viewer: ISSC, found: letter });
    await service.flag('u-issc', 'd1', { reason: 'Pasted signatures.', actingAs: 'Ben Cruz' }, ctx);
    expect(decisions.flag).toHaveBeenCalledWith('v1', {
      byId: 'u-issc',
      actingAs: 'Ben Cruz',
      reason: 'Pasted signatures.',
      at: AT,
    });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'task_file_flagged',
        title: 'Flagged invalid: Letter to the Dean (Communication Letter), Seminar',
        body: expect.stringMatching(/^The ISSC flagged this file/) as string,
      }),
    );
  });

  it('409s while the file is still being checked', async () => {
    const checking = record({
      versions: [{ id: 'v2', scanStatus: 'checking', failureReason: null }],
    });
    const { service } = setup({ found: checking });
    await expect(
      service.flag('u-csc', 'd1', { reason: 'Pasted signatures.', actingAs: 'Ana' }, ctx),
    ).rejects.toMatchObject({
      status: 409,
      message: 'Wait until the file is checked before flagging it',
    });
  });

  it('409s when it was flagged in the meantime', async () => {
    const { service, decisions } = setup();
    decisions.flag.mockResolvedValueOnce(false);
    await expect(
      service.flag('u-csc', 'd1', { reason: 'Pasted signatures.', actingAs: 'Ana' }, ctx),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('taskFileDecisionService: what it never decides on', () => {
  const input = { reason: 'Pasted signatures.', actingAs: 'Ana' };

  it('404s a viewer acting for no organization', async () => {
    const { service, decisions } = setup({ viewer: { kind: 'public' } });
    await expect(service.flag('u', 'd1', input, ctx)).rejects.toMatchObject({ status: 404 });
    expect(decisions.findForDecision).not.toHaveBeenCalled();
  });

  it('404s a file of a deleted project, and one of an unchecked task', async () => {
    const deleted = record({
      projectTask: { type: 'PROPOSAL', project: { ...project, deletedAt: AT } },
    });
    await expect(
      setup({ found: deleted }).service.flag('u-csc', 'd1', input, ctx),
    ).rejects.toMatchObject({
      status: 404,
    });
    const other = record({
      projectTask: null,
      taskFile: { label: 'Venue', task: { type: 'OTHER_PRE_EVENT', project } },
    });
    await expect(
      setup({ found: other }).service.flag('u-csc', 'd1', input, ctx),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('403s the organization itself', async () => {
    const own: DocumentViewer = { ...CSC, organizationId: 'jpice', organizationType: 'SBO' };
    await expect(setup({ viewer: own }).service.flag('u', 'd1', input, ctx)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('taskFileDecisionService.attentionFiles', () => {
  it('keeps files needing attention or flagged, by organization', async () => {
    const flagged = record({ id: 'd2' }, false);
    flagged.currentVersion!.integrity!.flaggedAt = AT;
    flagged.currentVersion!.integrity!.flagReason = 'Pasted signatures.';
    const cleared = record({ id: 'd3' });
    cleared.currentVersion!.integrity!.warningsClearedAt = AT;
    const { service } = setup({ candidates: [record(), flagged, cleared] });
    const files = await service.attentionFiles(CSC, ['jpice'], '2026-08-01', '2026-12-31');
    expect(files.get('jpice')?.map((f) => [f.documentId, f.integrity.state])).toEqual([
      ['d1', 'needs_attention'],
      ['d2', 'flagged_invalid'],
    ]);
  });

  it('lists nothing for a viewer acting for no organization', async () => {
    const { service, decisions } = setup();
    await expect(
      service.attentionFiles({ kind: 'public' }, ['jpice'], '2026-08-01', '2026-12-31'),
    ).resolves.toEqual(new Map());
    expect(decisions.attentionCandidates).not.toHaveBeenCalled();
  });
});
