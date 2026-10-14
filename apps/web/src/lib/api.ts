import type { z } from 'zod';
import { apiErrorBodySchema } from '@orghive/shared';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * The access token lives in memory only (never localStorage or sessionStorage).
 * A page reload drops it; the auth flow restores it from the httpOnly refresh cookie.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

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

export async function apiFetch<T = unknown>(
  path: string,
  { json, schema, headers, ...init }: RequestOptions<T> = {},
): Promise<T> {
  const requestHeaders = new Headers(headers);
  requestHeaders.set('Accept', 'application/json');
  if (json !== undefined) requestHeaders.set('Content-Type', 'application/json');
  if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: requestHeaders,
      credentials: 'include',
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  if (!response.ok) {
    const parsed = apiErrorBodySchema.safeParse(await response.json().catch(() => null));
    if (parsed.success) {
      throw new ApiError(response.status, parsed.data.error.code, parsed.data.error.message);
    }
    throw new ApiError(response.status, 'HTTP_ERROR', response.statusText || 'Request failed');
  }

  if (response.status === 204) return undefined as T;

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
