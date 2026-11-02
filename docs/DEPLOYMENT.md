# Deployment notes

What a production host must set up beyond `docker compose` and the env files. See also
`docs/SECURITY_HEADERS.md` ("Still to do at deployment").

## Pre-deployment checklist

1. **Remove demo data:** `pnpm --filter api db:unseed:demo`, then confirm the super admin
   banner ("Demo data present — remove before deployment") is gone from `/system`.
2. Work through `docs/SECURITY_HEADERS.md`, "Still to do at deployment".
3. Set up the reverse proxy for the live leaderboard (below).
4. **Set `TASK_QR_SECRET`** (32 random bytes, base64; `pnpm --filter api keys:generate --qr-only`).
   The API refuses to start in production without it. It signs the QR codes on task templates
   (`docs/PROJECT_WORKFLOW_SPEC.md`, section 6): keep it secret and never rotate it casually,
   since templates already handed out would stop matching (their short codes still work).

## Demo data

`pnpm --filter api db:seed:demo` fills empty features with sample activity on the seeded
organizations, for development and demos: completed projects that rank ASIT, TAG and ISO
#1 to #3 (through the real ranking rules), CEA SBOs and five CSCs below them, blocked and
frozen projects with appeals, announcements and notifications. Dates follow the current
semester. It is idempotent and needs the normal seed first. Its rules and data are in
`apps/api/src/services/demo-rules.ts`.

- Every demo row has `is_demo = true`; demo files are stored under `demo/`. The normal seed
  never creates any.
- Task files (spec section 6): each checked task's file is its filled-in template with a real
  QR code (`apps/api/src/lib/task-template-pdf.ts`), its task code and passing checks, so it
  is verified and ranks. JIIEE's files (`DEMO_LEGACY_ORGS`) stay the plain samples
  (`apps/api/prisma/seed/demo-assets/`, watermarked "SAMPLE — DEMO DATA") marked legacy, to
  show the dashboard notice and a held project. Without `TASK_QR_SECRET` every demo task file
  is legacy and the boards stay empty.
- If the seed stops with `P1017 Server has closed the connection`, run it again: it is a
  local Docker networking hiccup on a burst of new connections, and the seed is idempotent.
- Public pages showing it carry a small "Sample data" chip (`SHOW_DEMO_BADGE`, default true).
- `pnpm --filter api db:unseed:demo`, or **Remove demo data** in the `/system` banner (a
  preview, then a step-up code), deletes every demo row and file, plus what the app derived
  from them (notifications and audit entries about demo projects, standings computed while
  demo data existed, their page images). Real rows are never touched.
- In production the API and worker **refuse to start** while any demo row exists, unless
  `ALLOW_DEMO_DATA=true` is set explicitly. CI checks that the normal seed creates none
  (`pnpm --filter api check:no-demo`).

## Live leaderboard (Server-Sent Events)

`GET /api/v1/leaderboard/stream` keeps one HTTP response open per viewer and writes an event
whenever the standings change, plus a `: ping` comment every 25 s. A reverse proxy must pass
those writes through at once and must not close a quiet connection.

The API already sends `X-Accel-Buffering: no` on the stream, which turns off Nginx buffering
for it. Still give the stream its own location so the timeouts apply:

```nginx
location = /api/v1/leaderboard/stream {
    proxy_pass http://orghive_api;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    # Longer than the 25 s heartbeat, so only a dead connection times out.
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

- **`TRUST_PROXY` must be set** (`apps/api/.env`) to the proxy hops in front of the API.
  Without it every viewer appears to come from the proxy's IP, and the per-IP cap below
  would be reached after the first 50 viewers of the whole site.
- **Limits per API instance** (`STREAM_LIMITS`, `apps/api/src/lib/leaderboard-stream.ts`):
  50 open streams per client IP (generous, since a campus often shares one IP) and 2,000 in
  total. Past either, the API answers 429 and the web app polls `GET /api/v1/leaderboard`
  every 60 s instead. Each API instance can hold its own 2,000; Redis pub/sub
  (`leaderboard:changed`) tells every instance about a change.
- **Node** keeps idle connections open by default (`server.timeout` is 0). Do not lower it
  below the heartbeat.
- **HTTP/2** at the proxy lifts the browser's limit of 6 connections per origin, so a viewer
  with many tabs open does not starve the app's other requests.
- On shutdown the API ends every stream first; browsers reconnect (after the 5 s `retry`) to
  another instance.
