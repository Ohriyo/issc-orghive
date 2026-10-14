import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthResponseSchema } from '@orghive/shared';
import { api, ApiError, setAccessToken } from './api';

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
  setAccessToken(null);
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
    setAccessToken('abc123');

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
