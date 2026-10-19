import { describe, expect, it } from 'vitest';
import {
  emailPreferences,
  NOTIFICATION_KIND_GROUPS,
  NOTIFICATION_KINDS,
  notificationListQuerySchema,
  updateNotificationPreferencesSchema,
} from './notification';

describe('notification preferences', () => {
  it('emails every kind unless it was turned off', () => {
    const email = emailPreferences(['announcement_posted']);
    expect(email.announcement_posted).toBe(false);
    expect(email.upload_quarantined).toBe(true);
    expect(Object.keys(email)).toEqual([...NOTIFICATION_KINDS]);
  });

  it('accepts a partial change, but not an empty one or an unknown kind', () => {
    expect(
      updateNotificationPreferencesSchema.safeParse({ email: { term_ending: false } }).success,
    ).toBe(true);
    expect(updateNotificationPreferencesSchema.safeParse({ email: {} }).success).toBe(false);
    expect(updateNotificationPreferencesSchema.safeParse({ email: { nope: true } }).success).toBe(
      false,
    );
  });

  it('groups every kind exactly once on the settings page', () => {
    const grouped = NOTIFICATION_KIND_GROUPS.flatMap((g) => g.kinds);
    expect([...grouped].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});

describe('notification list query', () => {
  it('reads unread=true as a boolean', () => {
    expect(notificationListQuerySchema.parse({ unread: 'true' }).unread).toBe(true);
    expect(notificationListQuerySchema.parse({}).unread).toBeUndefined();
    expect(notificationListQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});
