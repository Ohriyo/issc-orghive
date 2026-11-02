import type { SemesterDates, SemesterKey } from '@orghive/shared';
import type { Db } from './prisma';

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** The dates the ISSC account set for semesters (spec 5B). */
export function createSemesterDatesRepository(db: Db) {
  return {
    async all(): Promise<SemesterDates[]> {
      const rows = await db.semesterDates.findMany({
        orderBy: [{ start: 'asc' }],
        select: { academicYear: true, semester: true, start: true, end: true },
      });
      return rows.map((row) => ({ ...row, start: isoDay(row.start), end: isoDay(row.end) }));
    },

    async save(
      key: SemesterKey,
      dates: { start: string; end: string },
      updatedById: string,
    ): Promise<void> {
      const data = { start: dayOf(dates.start), end: dayOf(dates.end), updatedById };
      await db.semesterDates.upsert({
        where: { academicYear_semester: key },
        create: { ...key, ...data },
        update: data,
      });
    },
  };
}

export type SemesterDatesRepository = ReturnType<typeof createSemesterDatesRepository>;
