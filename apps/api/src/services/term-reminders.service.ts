import { addDays, daysBetween, manilaDate, TERM_ENDING_SOON_DAYS } from '@orghive/shared';
import type { AccountRepository, EndingTerm } from '#src/repositories/account.repository';
import type { NotificationService } from './notification.service';

export interface TermRemindersDeps {
  accounts: Pick<AccountRepository, 'findTermsEndingBetween'>;
  notifications: Pick<NotificationService, 'notify'>;
  now?: () => Date;
}

const longDay = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeZone: 'UTC' });

/** A DATE column's day, `YYYY-MM-DD` (stored at UTC midnight). */
const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const asDate = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`);

function whenText(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** "the JPICE term of Juan Dela Cruz (President)". */
function termName(term: EndingTerm): string {
  return `the ${term.organization.acronym} term of ${term.officerName} (${term.officerPosition})`;
}

/**
 * The term-ending notice (docs/DOMAIN_RULES.md, "Notifications"): each organization account
 * whose current officer term ends within TERM_ENDING_SOON_DAYS Manila calendar days is told
 * once per end date. Run by the hourly check-compliance job; the dedupe key makes reruns
 * harmless, and a term that is extended to a new end date is announced again for that date.
 */
export function createTermReminders({
  accounts,
  notifications,
  now = () => new Date(),
}: TermRemindersDeps) {
  return {
    /** Returns how many terms are ending within the window. */
    async run(): Promise<number> {
      const today = manilaDate(now());
      const terms = await accounts.findTermsEndingBetween(
        asDate(today),
        asDate(addDays(today, TERM_ENDING_SOON_DAYS)),
      );
      for (const term of terms) {
        const end = dayOf(term.termEnd!);
        const when = whenText(daysBetween(today, end));
        await notifications.notify({
          userIds: [term.userId],
          kind: 'term_ending',
          title: `${term.organization.acronym}: this officer term ends ${when}`,
          body: `${termName(term)} (${term.organization.name}) ends on ${longDay.format(term.termEnd!)}. At the end of term the ISSC signs every organization account out and issues new passwords to the incoming officers. Prepare the handover of your projects and files before then.`,
          link: '/dashboard',
          dedupeKey: `term-ending:${term.id}:${end}`,
        });
      }
      return terms.length;
    },
  };
}

export type TermReminders = ReturnType<typeof createTermReminders>;
