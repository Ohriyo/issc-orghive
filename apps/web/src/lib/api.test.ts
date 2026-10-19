import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@orghive/shared';
import type { AuthResponse } from '@orghive/shared';
import { api, ApiError, refreshSession } from './api';
import { authStore } from './auth-store';

const USER = {
  id: '0195f3c0-0000-7000-8000-000000000001',
  name: 'Juan',
  email: 'juan@nwssu.test',
  mustChangePassword: false,
  organization: null,
  officerInCharge: null,
};

function session(accessToken: string): AuthResponse {
  return { accessToken, expiresIn: 900, user: USER };
}

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url, init: init!, headers: new Headers(init!.headers) };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  authStore.reset();
});

describe('api client', () => {
  it('prefixes the base URL and sends cookies', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }));

    await api.get('/health');

    const { url, init } = lastRequest();
    expect(url).toBe('/api/v1/health');
    expect(init.credentials).toBe('include');
  });

  it('attaches the in-memory access token as a bearer token', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    authStore.setSession(session('abc123'));

    await api.get('/me');

    expect(lastRequest().headers.get('Authorization')).toBe('Bearer abc123');
  });

  it('sends JSON bodies with a JSON content type', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 201));

    await api.post('/things', { name: 'x' });

    const { init, headers } = lastRequest();
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"x"}');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('validates the response with a shared schema', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'down' }));

    await expect(api.get('/health', { schema: healthResponseSchema })).rejects.toThrow();
  });

  it('turns { error: { code, message } } into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'FORBIDDEN', message: 'Not allowed' } }, 403),
    );

    await expect(api.get('/secret')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Not allowed',
    });
  });

  it('reports network failures as status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await api.get('/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });
});

describe('refreshSession', () => {
  it('keeps a working session when the refresh is rate limited or the server fails', async () => {
    authStore.setSession(session('still-valid'));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'Too many attempts.' } }, 429),
    );
    expect(await refreshSession()).toBe(false);
    expect(authStore.getSnapshot().status).toBe('authenticated');
    expect(authStore.getAccessToken()).toBe('still-valid');
  });

  it('settles a first check that fails as signed out, so pages do not wait forever', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    expect(await refreshSession()).toBe(false);
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });
});

describe('refresh on 401', () => {
  const unauthorized = () =>
    jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Your session has expired' } }, 401);

  it('refreshes once and retries with the new access token', async () => {
    authStore.setSession(session('expired'));
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(jsonResponse(session('fresh')))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    expect(await api.get('/documents')).toEqual({ ok: true });

    const [, refreshCall, retry] = fetchMock.mock.calls;
    expect(refreshCall![0]).toBe('/api/v1/auth/refresh');
    expect(refreshCall![1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(new Headers(retry![1]!.headers).get('Authorization')).toBe('Bearer fresh');
    expect(authStore.getSnapshot().status).toBe('authenticated');
  });

  it('gives up after one failed refresh and signs out locally', async () => {
    authStore.setSession(session('expired'));
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized());

    await expect(api.get('/documents')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authStore.getSnapshot()).toEqual({ status: 'anonymous', user: null });
  });

  it('never refreshes for auth routes (a wrong password is not an expired session)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } },
        401,
      ),
    );
    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between simultaneous callers', async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

    const both = Promise.all([refreshSession(), refreshSession()]);
    release(jsonResponse(session('fresh')));

    expect(await both).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authStore.getAccessToken()).toBe('fresh');
  });
});
