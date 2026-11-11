import {
  manilaDate,
  previousSemesterKey,
  SHOWCASE_RANK_MAX,
  type OrganizationType,
  type SemesterCalendar,
  type SemesterKey,
  type ShowcaseProject,
  type ShowcaseRank,
  type ShowcaseSemester,
  type StandingsStatus,
} from '@orghive/shared';

/*
 * What /orgs/:slug derives from an organization's records (docs/DOMAIN_RULES.md,
 * "Organization page"). Pure functions: the one place these rules live.
 */

/**
 * The semester whose standings the badge shows: the current one, except in the break before
 * it starts, when the one that just ended keeps its (final) rank until the next one begins.
 * `currentKey` already moves to the next semester the day after one ends.
 */
export function badgeSemester(calendar: SemesterCalendar, at: Date): SemesterKey {
  const current = calendar.currentKey(at);
  return manilaDate(at) < calendar.rangeOf(current).start ? previousSemesterKey(current) : current;
}

/** Which board an organization is ranked on; the ISSC is never ranked. */
export function boardOf(type: OrganizationType): 'SBO' | 'CSC' | null {
  return type === 'ISSC' ? null : type;
}

/** The badge: only a top-10 place on its own board, never for the ISSC. */
export function rankBadge(input: {
  organizationId: string;
  organizationType: OrganizationType;
  semester: SemesterKey;
  status: StandingsStatus;
  rows: readonly { organizationId: string; rank: number }[];
}): ShowcaseRank | null {
  const board = boardOf(input.organizationType);
  if (!board) return null;
  const row = input.rows.find((r) => r.organizationId === input.organizationId);
  if (!row || row.rank < 1 || row.rank > SHOWCASE_RANK_MAX) return null;
  return {
    board,
    rank: row.rank,
    academicYear: input.semester.academicYear,
    semester: input.semester.semester,
    status: input.status,
  };
}

/**
 * Completed projects grouped by the semester their event date falls in (the semester
 * calendar decides), newest semester first and newest project first within each.
 */
export function groupBySemester(
  projects: readonly ShowcaseProject[],
  calendar: SemesterCalendar,
): ShowcaseSemester[] {
  const sorted = [...projects].sort(
    (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
  );
  const groups: ShowcaseSemester[] = [];
  for (const project of sorted) {
    const key = calendar.keyOf(project.date);
    const last = groups.at(-1);
    if (last && last.academicYear === key.academicYear && last.semester === key.semester) {
      last.projects.push(project);
    } else {
      groups.push({ ...key, projects: [project] });
    }
  }
  return groups;
}
