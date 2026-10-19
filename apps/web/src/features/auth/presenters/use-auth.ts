import { useSyncExternalStore } from 'react';
import type { AuthUser } from '@orghive/shared';
import { authStore, type AuthSnapshot } from '@/lib/auth-store';

/** The current session: 'unknown' until the silent refresh on load has answered. */
export function useAuth(): AuthSnapshot {
  return useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot);
}

/** Backslashes, whitespace and control characters: URL parsers rewrite or drop these. */
function hasUnsafeCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '\\' || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Where to go after signing in. Only same-site paths are accepted: "//evil.example",
 * "/\evil.example" and "/<tab>/evil.example" (parsers drop the tab) would leave the site,
 * an open redirect, so they fall back. The final check resolves it against a placeholder
 * origin and requires it to stay there.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || hasUnsafeCharacter(next)) {
    return fallback;
  }
  const base = 'https://orghive.invalid';
  return new URL(next, base).origin === base ? next : fallback;
}

/** A super admin console account: SUPER_ADMIN, which belongs to no organization. */
export function isConsoleOnly(user: AuthUser): boolean {
  return user.systemRole === 'SUPER_ADMIN' && !user.organization;
}

/**
 * Whether the signed-in shared account is the organization's own: the only one that uploads,
 * edits, archives or appeals for it. A UI hint only; the API checks it again.
 */
export function isOwnOrganization(
  user: AuthUser | null | undefined,
  org: { id?: string | null; slug?: string | null },
): boolean {
  const own = user?.organization;
  if (!own) return false;
  return (!!org.id && own.id === org.id) || (!!org.slug && own.slug === org.slug);
}

/**
 * Where a user goes after signing in: MFA setup first for a super admin who has not
 * confirmed an authenticator, then a temporary password change, then `next`, falling back
 * to /system for a console-only super admin and /dashboard for everyone else.
 */
export function landingFor(user: AuthUser, next: string | null | undefined): string {
  if (user.mfaSetupRequired) return '/mfa-setup';
  const target = safeNext(next, isConsoleOnly(user) ? '/system' : '/dashboard');
  return user.mustChangePassword ? `/change-password?next=${encodeURIComponent(target)}` : target;
}
