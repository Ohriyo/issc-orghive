# Orghive

Orghive is NwSSU's official digital archive for student-organization documents (proposals, reports, resolutions, accomplishment reports). Students browse and download; organization officers upload; advisers and CSC reviewers approve; ISSC admins manage everything.

The full plan is in `docs/PLAN.md` (exported from the planning doc). The design prototype PNGs are in `design/`. Build prompts for each feature are in `docs/BUILD_PROMPTS.md`.

## Domain model

There are three organization levels. Store all three in one `organizations` table with `type` and `parent_id`. Never hard-code them.

- **ISSC**: Institutional Supreme Student Council. Exactly one, university-wide.
- **CSC**: Collegiate Student Council. One per college: CAT, CCIS, CCJS, CEA, CoED, COM, CON.
- **SBO**: Student Body Organization. Belongs to a college. Example: CEA has JPICE, IECEP, ICpEP.SE, PSME, UAPSA and JIIEE.

"Paperworks" is the user-facing name for an organization's document archive. Use it in the UI. Use `documents` in code.

Roles are **per organization**, stored in `memberships(user_id, organization_id, role, term_start, term_end)`:
- `officer`: upload and edit that organization's documents.
- `adviser`: review and approve them.
- `admin`: system-wide.

A membership past `term_end` grants nothing.

Document lifecycle: `draft → pending → approved | rejected → archived`. Deletes are soft (`deleted_at`). Re-uploads create a new row in `document_versions`. Never overwrite a file.

## Architecture: hybrid Model-View-Presenter

```
apps/web     React 19 + Vite + TS. Views = components, Presenters = hooks
apps/api     Node 22 + Express 5 + TS. routes → controllers → services → repositories
packages/shared  Zod schemas, types, constants used by BOTH apps
```

Layer rules. These are the ones most often broken, so check every change against them:
- **Views** (`apps/web/src/**/views`, `components`) render props and emit events. No `fetch`, no TanStack Query calls, no business rules.
- **Client presenters** (`apps/web/src/features/*/presenters/use*.ts`) own data fetching via TanStack Query, shaping, and loading, error and optimistic state. No JSX.
- **Routes/controllers** parse the request, validate with the shared Zod schema, call one service, and send the response. No Prisma, no business logic.
- **Services** (server presenters) hold business rules: permissions, approval flow, versioning, cache invalidation. No `req`/`res`.
- **Repositories** are the only place that imports Prisma. Every document query applies the visibility filter here.
- A validation rule is defined once, in `packages/shared`, and imported by both apps.

## Stack

- Web: React Router, TanStack Query, Tailwind CSS, shadcn/ui, Framer Motion (`motion`), Embla Carousel, React Hook Form + Zod, react-pdf
- API: Prisma + PostgreSQL, Redis (ioredis), BullMQ, `jose` for JWT, Argon2id, helmet, express-rate-limit, pino, Multer only for small images
- Files: S3-compatible object storage (MinIO locally). Bytes go browser ↔ storage via pre-signed URLs and never through Node.
- Tests: Vitest, React Testing Library, Supertest, Playwright

## Commands

```bash
pnpm install
docker compose up -d                 # postgres, redis, minio, mailpit
pnpm --filter api prisma migrate dev
pnpm --filter api db:seed            # 7 colleges, ISSC, CSCs, sample SBOs
pnpm dev                             # web :5173, api :4000, worker
pnpm test                            # all unit + API tests
pnpm --filter web test:e2e           # Playwright
pnpm lint && pnpm typecheck          # run before every commit
```

## Security rules (non-negotiable)

- Access token: JWT, 15 min, EdDSA or RS256 via `jose`. Held in **memory only**, never in `localStorage` or `sessionStorage`.
- Refresh token: random 256-bit string, stored **hashed**, sent as an `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth` cookie, rotated on every use. If a revoked token is reused, revoke the whole family.
- Every mutating route has `requireAuth` plus `requireOrgRole(role)` scoped to the target organization.
- Validate every body, query and param with Zod. Never trust `req.body` unvalidated.
- Uploads: allow-list PDF, DOCX, XLSX, PPTX, JPG and PNG. Check magic bytes. Max 25 MB. Each upload stays `pending` until the ClamAV scan passes.
- Downloads use signed URLs that expire in 5 minutes. The bucket is private.
- Never log tokens, passwords or full request bodies. Secrets come from env only; keep `.env.example` current.
- Write an audit log entry for login, upload, approve/reject, delete and role changes.

## Caching

- Redis cache-aside for public reads, with keys like `college:list`, `org:{slug}`, `org:{slug}:docs:{query-hash}`. TTL 5–15 min.
- Any write to an organization's documents must delete `org:{slug}:docs:*` in the same service method.
- Public GETs send `Cache-Control: public, max-age=60, stale-while-revalidate=300` plus an ETag. Anything user-specific sends `private, no-store`.
- Client: TanStack Query `staleTime` 1–5 min. Call `invalidateQueries` after every mutation.

## UI conventions

- Follow the prototype in `design/`: NwSSU greens, hexagon frames, wave dividers, Poppins, pill buttons.
- Motion is inspired by getlayers.ai: animated hero background, spotlight carousels, scroll reveals. Keep durations at 300–500 ms.
- Respect `prefers-reduced-motion`: turn off the WebGL background and carousel blur.
- Reuse the signature components (`HexFrame`, `HexGrid`, `SpotlightCarousel`, `WaveDivider`, `OrgHero`, `DocumentCard`) instead of writing one-off variants.
- Colors and fonts come from Tailwind theme tokens only. No raw hex values in components.
- Meet WCAG 2.2 AA: carousels work with arrow keys, logos have alt text, and green text passes contrast.
- Every screen has loading, empty and error states.
- Mobile first. Hexagon grids stack, and carousels become swipeable below 768 px.

## Working agreements for Claude

- Before a feature touching more than 3 files, propose a plan and wait for approval.
- Work in this order: shared Zod schema → Prisma/repository → service → route → presenter hook → view → tests.
- Every service method gets a unit test. Every route gets a Supertest test that covers its 401/403 paths.
- Run `pnpm lint && pnpm typecheck && pnpm test` before saying a task is done, and report the result.
- Don't add a dependency without saying why. Prefer the libraries listed above.
- Use Conventional Commits: `feat(documents): …`, `fix(auth): …`.
- When unsure about a domain rule (who approves what, required documents), ask. Don't invent one.
