import { z } from 'zod';
import { TERM_ENDING_SOON_DAYS } from './dashboard';

/**
 * In-app notifications. Each is also emailed by the worker unless the user turned email off
 * for its kind (docs/DOMAIN_RULES.md, "Notifications"); in-app notifications are always on.
 */
export const NOTIFICATION_KINDS = [
  'deadline_soon',
  'deadline_missed',
  'appeal_submitted',
  'appeal_decided',
  /** The Semestral End Report the user asked for is ready (or could not be made). */
  'report_ready',
  /** A file the user uploaded failed the virus scan (told to its uploader only). */
  'upload_quarantined',
  /** The user's own officer or adviser term ends within TERM_ENDING_SOON_DAYS. */
  'term_ending',
  /** Their ISSC or CSC posted an update. */
  'announcement_posted',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** A task deadline is announced this many days ahead. */
export const DEADLINE_REMINDER_DAYS = 3;

/** What each kind is called on the email settings page, and what sets it off. */
export const NOTIFICATION_KIND_INFO: Record<NotificationKind, { label: string; hint: string }> = {
  deadline_soon: {
    label: 'Deadline reminders',
    hint: `A project task is due in ${DEADLINE_REMINDER_DAYS} days.`,
  },
  deadline_missed: {
    label: 'Missed deadlines',
    hint: 'A project is blocked or your organization is frozen.',
  },
  appeal_submitted: {
    label: 'Appeals to decide',
    hint: 'An organization you decide for submitted an appeal.',
  },
  appeal_decided: {
    label: 'Appeal decisions',
    hint: "Your organization's appeal was approved or rejected.",
  },
  report_ready: {
    label: 'Semestral End Reports',
    hint: 'A report you asked for is ready, or could not be made.',
  },
  upload_quarantined: {
    label: 'Files refused by the virus scan',
    hint: 'A file you uploaded failed the scan and was quarantined.',
  },
  term_ending: {
    label: 'Term ending',
    hint: `Your officer or adviser term ends within ${TERM_ENDING_SOON_DAYS} days.`,
  },
  announcement_posted: {
    label: 'Updates from your council',
    hint: 'The ISSC or your college’s CSC posted an update.',
  },
};

/** How the settings page groups the kinds, in order. */
export const NOTIFICATION_KIND_GROUPS: { title: string; kinds: NotificationKind[] }[] = [
  { title: 'Projects', kinds: ['deadline_soon', 'deadline_missed'] },
  { title: 'Appeals', kinds: ['appeal_submitted', 'appeal_decided'] },
  { title: 'Files and reports', kinds: ['upload_quarantined', 'report_ready'] },
  { title: 'Your organization', kinds: ['term_ending', 'announcement_posted'] },
];

export const notificationSchema = z
  .object({
    id: z.uuid(),
    kind: notificationKindSchema,
    title: z.string(),
    body: z.string(),
    /** An app path, e.g. "/projects/…". */
    link: z.string().nullable(),
    readAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Notification' });
export type Notification = z.infer<typeof notificationSchema>;

export const NOTIFICATION_PAGE_MAX = 50;

/** GET /me/notifications: newest first; `unread=true` lists only unread ones. */
export const notificationListQuerySchema = z.object({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_PAGE_MAX).optional(),
  unread: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationListResponseSchema = z
  .object({
    items: z.array(notificationSchema),
    unreadCount: z.number().int().min(0),
    /** Set while older notifications remain. */
    nextCursor: z.uuid().nullable(),
  })
  .meta({ id: 'NotificationListResponse' });
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationIdParamsSchema = z.object({ notificationId: z.uuid() });

/** Email on or off for every kind (in-app is always on). */
export const notificationPreferencesSchema = z
  .object({ email: z.record(notificationKindSchema, z.boolean()) })
  .meta({ id: 'NotificationPreferences' });
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/** PUT /me/notification-preferences: only the kinds that change. */
export const updateNotificationPreferencesSchema = z.strictObject({
  email: z
    .partialRecord(notificationKindSchema, z.boolean())
    .refine((email) => Object.keys(email).length > 0, 'Change at least one setting'),
});
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;

/** Every kind emails unless the user turned it off. */
export function emailPreferences(
  optedOut: Iterable<NotificationKind>,
): NotificationPreferences['email'] {
  const off = new Set(optedOut);
  return Object.fromEntries(NOTIFICATION_KINDS.map((kind) => [kind, !off.has(kind)])) as Record<
    NotificationKind,
    boolean
  >;
}
