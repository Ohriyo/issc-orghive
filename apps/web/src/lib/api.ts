import type { z } from 'zod';
import { apiErrorBodySchema, authResponseSchema } from '@orghive/shared';
import { authStore } from './auth-store';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

/** Any failed API call. `status` is 0 when the request never reached the server. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions<T> extends Omit<RequestInit, 'body'> {
  /** Sent as JSON with the matching Content-Type. */
  json?: unknown;
  /** Validates the response body; use the schema from @orghive/shared. */
  schema?: z.ZodType<T>;
}

let inFlightRefresh: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Single-flight within the
 * tab, and serialized across tabs with the Web Locks API: the refresh token rotates on
 * every use, so two tabs sending the same cookie at once would look like token theft and
 * end the session. Resolves false (and signs out locally) when there is no session.
 */
export function refreshSession(): Promise<boolean> {
  inFlightRefresh ??= withRefreshLock(async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (response.status === 401 || response.status === 403) {
        authStore.clear();
        return false;
      }
      if (!response.ok) {
        // Rate limited or server trouble: the session may be fine, so keep it. Only an
        // unanswered first check falls back to signed out, so pages do not wait forever.
        if (authStore.getSnapshot().status === 'unknown') authStore.clear();
        return false;
      }
      authStore.setSession(authResponseSchema.parse(await response.json()));
      return true;
    } catch {
      // Offline: keep whatever we had; the next call tries again.
      if (authStore.getSnapshot().status === 'unknown') authStore.clear();
      return false;
    }
  }).finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

function withRefreshLock(run: () => Promise<boolean>): Promise<boolean> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request('orghive-auth-refresh', run) : run();
}

/**
 * Other tabs hold their own in-memory access token. Signing out in one tab tells the rest,
 * so none keeps working for the rest of its 15-minute token.
 */
const authChannel =
  typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('orghive-auth');
authChannel?.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.data === 'signed-out') authStore.clear();
});

/** Ends the session on the server (revokes the refresh family) and forgets it in every tab. */
export async function signOut(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
  } finally {
    authStore.clear();
    authChannel?.postMessage('signed-out');
  }
}

async function send(path: string, init: RequestInit, json: unknown): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const token = authStore.getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      credentials: 'include',
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  { json, schema, ...init }: RequestOptions<T> = {},
): Promise<T> {
  let response = await send(path, init, json);

  // An expired access token: refresh once and retry. Auth routes answer 401 for wrong
  // credentials, which a refresh cannot fix, so they are never retried.
  if (response.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
    response = await send(path, init, json);
  }

  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError(response.status, 'HTTP_ERROR', response.statusText || 'Request failed');
  }

  if (response.status === 204 || response.status === 202) {
    const text = await response.text();
    if (!text) return undefined as T;
    const data: unknown = JSON.parse(text);
    return schema ? schema.parse(data) : (data as T);
  }

  const data: unknown = await response.json();
  return schema ? schema.parse(data) : (data as T);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions<T>) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, json?: unknown, options?: RequestOptions<T>) =>
    apiFetch<T>(path, { ...options, method: 'POST', json }),
  put: <T>(path: string, json?: unknown, options?: RequestOptions<T>) =>
    apiFetch<T>(path, { ...options, method: 'PUT', json }),
  patch: <T>(path: string, json?: unknown, options?: RequestOptions<T>) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', json }),
  delete: <T>(path: string, options?: RequestOptions<T>) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};
