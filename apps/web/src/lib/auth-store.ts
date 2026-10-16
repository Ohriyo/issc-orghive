import type { AuthResponse, AuthUser } from '@orghive/shared';

/**
 * The signed-in session, held in memory only (CLAUDE.md: never localStorage or
 * sessionStorage). A reload drops it; the httpOnly refresh cookie restores it.
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface AuthSnapshot {
  status: AuthStatus;
  user: AuthUser | null;
}

let accessToken: string | null = null;
let snapshot: AuthSnapshot = { status: 'unknown', user: null };
const listeners = new Set<() => void>();

function emit(next: AuthSnapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Arrow functions throughout, so members can be passed around unbound (useSyncExternalStore). */
export const authStore = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Stable between changes, as useSyncExternalStore requires. */
  getSnapshot: (): AuthSnapshot => snapshot,
  getAccessToken: (): string | null => accessToken,
  setSession: (auth: AuthResponse): void => {
    accessToken = auth.accessToken;
    emit({ status: 'authenticated', user: auth.user });
  },
  /** Keeps the token, replaces the user (e.g. after /auth/me). */
  setUser: (user: AuthUser): void => {
    if (snapshot.status === 'authenticated') emit({ status: 'authenticated', user });
  },
  clear: (): void => {
    accessToken = null;
    emit({ status: 'anonymous', user: null });
  },
  /** Tests only: back to the state before the first refresh. */
  reset: (): void => {
    accessToken = null;
    emit({ status: 'unknown', user: null });
  },
};
