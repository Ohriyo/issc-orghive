import { z } from 'zod';

/**
 * In-app notifications; each is also emailed by the worker. F16 adds more kinds and the
 * preferences page.
 */
export const NOTIFICATION_KINDS = [
  'deadline_soon',
  'deadline_missed',
  'appeal_submitted',
  'appeal_decided',
  /** The Semestral End Report the user asked for is ready (or could not be made). */
  'report_ready',
] as const;
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

/** A task deadline is announced this many days ahead. */
export const DEADLINE_REMINDER_DAYS = 3;

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

export const notificationListResponseSchema = z
  .object({ items: z.array(notificationSchema), unreadCount: z.number().int().min(0) })
  .meta({ id: 'NotificationListResponse' });
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const notificationIdParamsSchema = z.object({ notificationId: z.uuid() });
