import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../security-headers.mjs';

const directives = (csp: string): Record<string, string[]> =>
  Object.fromEntries(
    csp.split('; ').map((d): [string, string[]] => {
      const [name = '', ...values] = d.split(' ');
      return [name, values];
    }),
  );

describe('securityHeaders', () => {
  const headers = securityHeaders({ storageOrigin: 'https://files.orghive.example' });
  const csp = directives(headers['Content-Security-Policy']!);

  it('forbids framing (clickjacking) and plugins, and pins base and form targets', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
  });

  it('runs only the app’s own scripts: no inline, no eval', () => {
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(headers['Content-Security-Policy']).not.toContain('unsafe-eval');
  });

  it('allows storage for images and direct uploads, and nothing else', () => {
    expect(csp['img-src']).toContain('https://files.orghive.example');
    expect(csp['connect-src']).toEqual(["'self'", 'https://files.orghive.example']);
  });

  it('sends HSTS, nosniff and a referrer policy', () => {
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('leaves the CSP out for the dev server only', () => {
    expect(securityHeaders({ csp: false })).not.toHaveProperty('Content-Security-Policy');
    expect(securityHeaders({ csp: false })['X-Frame-Options']).toBe('DENY');
  });
});
