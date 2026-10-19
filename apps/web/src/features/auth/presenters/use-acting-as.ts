import { useState } from 'react';
import { actingAsSchema } from '@orghive/shared';
import { useAuth } from './use-auth';

/*
 * "Acting as" (docs/DOMAIN_RULES.md, "Accounts"): an organization's officers share one
 * account, so uploads, archives and deletions name the officer acting. The last name used is
 * remembered on this device, per account, so the next action starts filled in.
 */

function storageKey(userId: string) {
  return `orghive:acting-as:${userId}`;
}

/** The name last used on this device for this account. Storage can be unavailable; then none. */
export function readActingAs(userId: string | undefined): string {
  if (!userId) return '';
  try {
    return window.localStorage.getItem(storageKey(userId)) ?? '';
  } catch {
    return '';
  }
}

export function rememberActingAs(userId: string | undefined, name: string) {
  if (!userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), name);
  } catch {
    // A private window or blocked storage: the name is asked again next visit.
  }
}

export interface ActingAsModel {
  value: string;
  onChange: (value: string) => void;
  /** Shown once an action was refused for the name. */
  error?: string;
  /**
   * Checks the name with the shared rule. Returns it trimmed and remembers it, or returns
   * null and shows why; the action must not go ahead then.
   */
  take: () => string | null;
}

/** Controlled "Acting as" for screens whose actions are one click (a file picked, Archive). */
export function useActingAs(): ActingAsModel {
  const { user } = useAuth();
  const userId = user?.id;
  const [draft, setDraft] = useState<{ userId?: string; value: string }>(() => ({
    userId,
    value: readActingAs(userId),
  }));
  const [error, setError] = useState<string>();
  // Another account signed in on this device starts from its own remembered name.
  const value = draft.userId === userId ? draft.value : readActingAs(userId);

  return {
    value,
    onChange: (next) => {
      setDraft({ userId, value: next });
      if (error && actingAsSchema.safeParse(next).success) setError(undefined);
    },
    error,
    take: () => {
      const parsed = actingAsSchema.safeParse(value);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message);
        return null;
      }
      setError(undefined);
      rememberActingAs(userId, parsed.data);
      return parsed.data;
    },
  };
}
