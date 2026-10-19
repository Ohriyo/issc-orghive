import { describe, expect, it } from 'vitest';
import type { ProjectRecord } from '#src/repositories/project.repository';
import {
  countByStatus,
  overdueTasks,
  planAll,
  upcomingDeadlines,
} from '#src/services/project-figures';

function project(id: string, createdAt: string, targetDate: string): ProjectRecord {
  return {
    id,
    name: id,
    organizationId: 'jpice',
    createdAt: new Date(createdAt),
    targetDate: new Date(`${targetDate}T00:00:00Z`),
    nomRequired: false,
    momRequired: false,
    proposalDueOverride: null,
    postEventDueOverride: null,
    organization: { type: 'SBO' },
    tasks: [],
  } as unknown as ProjectRecord;
}

/** 08:00 on October 16, 2026, Manila. */
const NOW = new Date('2026-10-16T00:00:00Z');
const planned = planAll(
  [
    project('late', '2026-09-20T02:00:00Z', '2026-10-30'), // proposal due Oct 4
    project('later', '2026-09-28T02:00:00Z', '2026-11-30'), // proposal due Oct 12
    project('soon', '2026-10-10T02:00:00Z', '2026-11-20'), // proposal due Oct 24
    project('sooner', '2026-10-05T02:00:00Z', '2026-11-25'), // proposal due Oct 19
  ],
  NOW,
);

describe('project figures', () => {
  it('lists overdue tasks oldest first with whole Manila days late', () => {
    expect(overdueTasks(planned, NOW).map((t) => [t.projectId, t.task, t.daysOverdue])).toEqual([
      ['late', 'PROPOSAL', 12],
      ['later', 'PROPOSAL', 4],
    ]);
  });

  it('counts a task due today as not yet overdue (it is due at 23:59:59 Manila)', () => {
    const dueToday = planAll([project('today', '2026-10-02T02:00:00Z', '2026-11-30')], NOW);
    expect(overdueTasks(dueToday, NOW)).toEqual([]);
    expect(upcomingDeadlines(dueToday, NOW)).toHaveLength(1);
  });

  it('lists deadlines ahead of open tasks, soonest first, skipping blocked projects', () => {
    expect(upcomingDeadlines(planned, NOW).map((t) => t.projectId)).toEqual(['sooner', 'soon']);
  });

  it('counts projects by the status the rules give them', () => {
    expect(countByStatus(planned)).toEqual({ active: 2, blocked: 2, completed: 0 });
  });
});
