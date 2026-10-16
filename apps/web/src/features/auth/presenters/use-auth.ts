import { useSyncExternalStore } from 'react';
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
export function safeNext(next: string | null | undefined, fallback = '/account'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || hasUnsafeCharacter(next)) {
    return fallback;
  }
  const base = 'https://orghive.invalid';
  return new URL(next, base).origin === base ? next : fallback;
}

export interface AccountLink {
  label: 'Login' | 'Account';
  href: '/login' | '/account';
}

/** The header's sign-in entry: "Account" once signed in, "Login" otherwise. */
export function useAccountLink(): AccountLink {
  const { status } = useAuth();
  return status === 'authenticated'
    ? { label: 'Account', href: '/account' }
    : { label: 'Login', href: '/login' };
}
