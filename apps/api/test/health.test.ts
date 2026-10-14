import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@orghive/shared';
import { buildTestApp, TEST_WEB_ORIGIN } from './helpers';

describe('GET /health', () => {
  const app = buildTestApp();

  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(healthResponseSchema.parse(res.body)).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('is also served under /api/v1', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
  });

  it('sets security headers via helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for WEB_ORIGIN', async () => {
    const allowed = await request(app).get('/health').set('Origin', TEST_WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);

    // cors always advertises the single allowed origin; browsers block any other origin.
    const other = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(other.headers['access-control-allow-origin']).not.toBe('*');
  });
});
