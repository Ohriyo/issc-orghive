#!/usr/bin/env node
/**
 * Checks the security headers of a running Orghive (pre-launch review, item 2): the web app's
 * pages and the API's responses. Works against any instance, local or deployed:
 *
 *   node scripts/check-headers.mjs --web http://localhost:4173 --api http://localhost:4000
 *   node scripts/check-headers.mjs --web https://orghive.example --api https://orghive.example
 *
 * Exits 1 if any required header is missing or too weak. Web pages must carry
 * apps/web/security-headers.mjs; the API carries helmet's (apps/api/src/app.ts).
 */
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    web: { type: 'string', default: 'http://localhost:4173' },
    api: { type: 'string', default: 'http://localhost:4000' },
    json: { type: 'boolean', default: false },
  },
});

/** Each rule: a header and a test; `why` explains a failure in plain words. */
const has = (name, test, why) => ({ name, test, why });
const hstsYear = (v) =>
  /max-age=(\d+)/.test(v ?? '') && Number(/max-age=(\d+)/.exec(v)[1]) >= 31536000;
const cspDirective = (csp, name) =>
  (csp ?? '')
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `));

const COMMON = [
  has('strict-transport-security', hstsYear, 'HSTS for at least a year'),
  has('x-content-type-options', (v) => v === 'nosniff', 'nosniff'),
  has('x-powered-by', (v) => v === undefined, 'must not reveal the server (X-Powered-By)'),
];

const WEB_RULES = [
  ...COMMON,
  has(
    'content-security-policy',
    (v) => cspDirective(v, 'frame-ancestors') === "frame-ancestors 'none'",
    "CSP frame-ancestors 'none' (no framing)",
  ),
  has(
    'content-security-policy',
    (v) => cspDirective(v, 'script-src') === "script-src 'self'",
    "CSP script-src 'self' only (no inline, no eval)",
  ),
  has(
    'content-security-policy',
    (v) => cspDirective(v, 'object-src') === "object-src 'none'",
    "CSP object-src 'none'",
  ),
  has('x-frame-options', (v) => v === 'DENY', 'X-Frame-Options DENY (older browsers)'),
  has(
    'referrer-policy',
    (v) => v === 'strict-origin-when-cross-origin' || v === 'no-referrer',
    'a strict referrer policy',
  ),
  has(
    'permissions-policy',
    (v) => /camera=\(\)/.test(v ?? ''),
    'camera, microphone and location off',
  ),
];

const API_RULES = [
  ...COMMON,
  has(
    'content-security-policy',
    (v) => /default-src 'self'/.test(v ?? '') && /frame-ancestors/.test(v ?? ''),
    "a CSP (helmet's default)",
  ),
  has('x-frame-options', (v) => v === 'SAMEORIGIN' || v === 'DENY', 'framing limited'),
  has(
    'referrer-policy',
    (v) => v === 'no-referrer' || v === 'strict-origin-when-cross-origin',
    'a strict referrer policy',
  ),
];

const TARGETS = [
  { label: 'web /', url: new URL('/', values.web), rules: WEB_RULES },
  { label: 'web /colleges/cea', url: new URL('/colleges/cea', values.web), rules: WEB_RULES },
  {
    label: 'web /orgs/jpice/paperworks',
    url: new URL('/orgs/jpice/paperworks', values.web),
    rules: WEB_RULES,
  },
  { label: 'api /api/v1/health', url: new URL('/api/v1/health', values.api), rules: API_RULES },
  { label: 'api /api/v1/colleges', url: new URL('/api/v1/colleges', values.api), rules: API_RULES },
];

let failed = 0;
const report = [];
for (const target of TARGETS) {
  let response;
  try {
    response = await fetch(target.url, { redirect: 'manual' });
  } catch (err) {
    failed += 1;
    report.push({
      target: target.label,
      ok: false,
      problems: [`unreachable: ${err.cause?.code ?? err.message}`],
    });
    continue;
  }
  const headers = Object.fromEntries(response.headers);
  const problems = target.rules
    .filter((rule) => !rule.test(headers[rule.name]))
    .map((rule) => `${rule.name}: ${rule.why} (got ${JSON.stringify(headers[rule.name] ?? null)})`);
  if (problems.length) failed += 1;
  report.push({
    target: target.label,
    status: response.status,
    ok: problems.length === 0,
    problems,
    headers,
  });
}

if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of report) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.target}${r.status ? ` (${r.status})` : ''}`);
    for (const p of r.problems) console.log(`      ${p}`);
  }
}
process.exit(failed ? 1 : 0);
