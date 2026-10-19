import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from './helpers';

/**
 * The API's security headers (helmet, apps/api/src/app.ts), pinned so a config change cannot
 * drop them silently. The web app's own headers are apps/web/security-headers.mjs; both are
 * checked on a running instance by scripts/check-headers.mjs.
 */
describe('API security headers', () => {
  for (const env of ['production', 'development'] as const) {
    it(`are sent in ${env}, on public and error responses alike`, async () => {
      const app = buildTestApp({}, { NODE_ENV: env });
      for (const path of ['/api/v1/health', '/api/v1/no-such-route']) {
        const res = await request(app).get(path);
        expect(res.headers['strict-transport-security']).toMatch(/max-age=(\d{8,})/);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['referrer-policy']).toBe('no-referrer');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
        expect(res.headers['content-security-policy']).toContain("object-src 'none'");
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });
  }
});
