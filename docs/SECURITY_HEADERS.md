# Security headers

Pre-launch review, item 2: the security headers Orghive sends, checked on a running instance on
2026-10-18 (API with `NODE_ENV=production`, web app as a production build on `vite preview`).
All checks passed.

Re-check any instance, local or deployed:

```bash
node scripts/check-headers.mjs --web <web origin> --api <api origin>   # or: pnpm check:headers
```

It exits non-zero if a required header is missing or too weak. Run it against staging and
production once a host is chosen.

## Web app (every page of `apps/web/dist`)

Defined once in `apps/web/security-headers.mjs` and sent by `vite preview`. **The production
host must send the same headers** (`securityHeaders({ storageOrigin })`), with `storageOrigin`
set to the public storage endpoint instead of `http://localhost:9000`.

| Header | Value | Why |
|---|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: <storage>; font-src 'self' data:; connect-src 'self' <storage>; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Only the app's own scripts run (no inline, no eval). Images and direct uploads may use storage. Nothing can frame the app (clickjacking). |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` | HTTPS only for a year. Browsers ignore it over plain http (local). |
| X-Content-Type-Options | `nosniff` | Files are never run as another type. |
| X-Frame-Options | `DENY` | Framing protection for browsers without CSP `frame-ancestors`. |
| Referrer-Policy | `strict-origin-when-cross-origin` | Other sites never see page paths. |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | No device access. |
| Cross-Origin-Opener-Policy | `same-origin` | Other windows cannot reach this one. |
| X-Powered-By | not sent | |

`style-src 'unsafe-inline'` is needed: Radix and the toast library insert `<style>` elements,
and components set `style` attributes. Scripts stay strict. Every route of the app renders
under this policy with no violations, and the visual suite fails CI on any violation.

The Vite **dev** server sends all of these except the CSP, because hot reload runs inline
scripts.

## API (`/api/v1/*`, `/health`)

helmet with its defaults (`apps/api/src/app.ts`), pinned by `apps/api/test/security-headers.test.ts`.

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `SAMEORIGIN` |
| Referrer-Policy | `no-referrer` |
| Cross-Origin-Opener-Policy / Resource-Policy | `same-origin` / `same-origin` |
| X-Powered-By | not sent |

The API serves JSON only, so its CSP is a backstop. CORS allows exactly `WEB_ORIGIN` with
credentials.

## Still to do at deployment

- Choose the host for `apps/web/dist` and make it send `securityHeaders()`; then run
  `scripts/check-headers.mjs` against it.
- Serve object storage from its own origin (not the app's), as the CSP assumes.
