# Orghive

Orghive is NwSSU's official digital archive for student-organization documents (proposals, reports, resolutions, accomplishment reports). Students browse and download; organization officers upload and decide who can see each file; ISSC admins manage everything. The project workflow (projects, deadlines, appeals, semestral reports) is specified in `docs/PROJECT_WORKFLOW_SPEC.md`.

The full plan is in `docs/PLAN.md` (exported from the planning doc). The design prototype PNGs are in `design/`. Build prompts for each feature are in `docs/BUILD_PROMPTS.md`.

## Domain model

There are three organization levels. Store all three in one `organizations` table with `type` and `parent_id`. Never hard-code them.

- **ISSC**: Institutional Supreme Student Council. Exactly one, university-wide.
- **CSC**: Collegiate Student Council. One per college: CAT, CCIS, CCJS, CEA, CoED, COM, CON.
- **SBO**: Student Body Organization. Belongs to a college. Example: CEA has JPICE, IECEP, ICpEP.SE, PSME, UAPSA and JIIEE.

"Paperworks" is the user-facing name for an organization's document archive. Use it in the UI. Use `documents` in code.

Roles are **per organization**, stored in `memberships(user_id, organization_id, role, is_head, title, term_start, term_end)`:
- `officer`: upload and edit that organization's documents, and set who can see each one.
- `adviser`: advises the organization. A member: sees its `members` files, cannot upload.
- `admin`: system-wide when held on the ISSC. Sees every document for support (audited), but never changes a document's visibility.
- `is_head` marks the organization's head (CSC Governor, SBO or ISSC President). Heads decide **appeals** (F11), not documents.

A membership past `term_end` grants nothing.

Document lifecycle: `uploading → scanning → available | quarantined → archived` (`uploading` is browser-side only). Deletes are soft (`deleted_at`). Re-uploads create a new row in `document_versions`. Never overwrite a file.

**Documents are never reviewed or approved** (`docs/PROJECT_WORKFLOW_SPEC.md` section 0). Do not add review statuses, approve/reject endpoints, a review queue or reviewer dashboards for documents. Who sees a document is its `visibility` alone, set by the owning organization's officers on upload and changeable any time (`PATCH /documents/:id/visibility`, `requireOwnOrgRole('officer')`, audited):
- `public`: anyone, signed in or not. `members`: active members of that organization. `private`: its officers.
- Until the virus scan passes, only the uploader sees a file. Archived documents: that organization's officers.
- Admins see every available or archived document; each view they get only as an admin is audited (`admin_override`).
- The only approvals in Orghive are **appeals** to unblock a project or an organization (F11).

**Projects** (spec 2A/2B) each have a milestone checklist (`ProjectTask`). Every unlock and deadline rule lives in one pure function, `apps/api/src/services/project-rules.ts`; never re-implement it elsewhere. Deadlines are 14 Manila calendar days (`packages/shared/src/manila-time.ts`). A task's file goes through the normal document pipeline, and the task is submitted once that file passes the scan.

**Compliance and appeals** (spec 3, `docs/DOMAIN_RULES.md`): `planProject` also decides when a project is blocked (proposal late) and which reports are overdue (the organization freezes, `OrgFreeze`). Who decides an appeal lives in one pure function, `apps/api/src/services/appeal-rules.ts`; never re-implement it. Checks run hourly (`check-compliance` job) and on read, and must stay idempotent: act on a block only when `applyPlan` reports the status change, and give every notification a dedupe key.

**Semestral End Report** (spec 4): the page order lives in one pure function, `planReport` (`apps/api/src/services/report-rules.ts`); semesters are fixed date ranges (`semesterRange` in `packages/shared/src/report.ts`). The worker renders the template with headless Chromium (`playwright-core`) and merges with `pdf-lib`; the result is an `available`, `private` document.

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
- **Services** (server presenters) hold business rules: permissions, appeal flow, versioning, cache invalidation. No `req`/`res`.
- **Repositories** are the only place that imports Prisma. Every document query applies the visibility filter here (`document-visibility.ts`), and nowhere else: services and views never re-implement who sees what.
- A validation rule is defined once, in `packages/shared`, and imported by both apps.

## Stack

- Web: React Router, TanStack Query, Tailwind CSS, shadcn/ui, Framer Motion (`motion`), Embla Carousel, React Hook Form + Zod, react-pdf
- API: Prisma + PostgreSQL, Redis (ioredis), BullMQ, `jose` for JWT, Argon2id, helmet, express-rate-limit, pino, Multer only for small images
- Files: S3-compatible object storage (MinIO locally). Bytes go browser ↔ storage via pre-signed URLs and never through Node.
- Tests: Vitest, React Testing Library, Supertest, Playwright

## Commands

```bash
pnpm install
docker compose up -d                 # postgres, redis, minio, mailpit, clamav (first start: a few minutes)
pnpm --filter api keys:generate >> apps/api/.env   # once: Ed25519 JWT signing keys
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
- Every mutating route has `requireAuth` plus `requireOrgRole(role)` scoped to the target organization. Decisions that belong to the organization alone (visibility) use `requireOwnOrgRole(role)`, which admins do not pass.
- Validate every body, query and param with Zod. Never trust `req.body` unvalidated.
- Uploads: allow-list PDF, DOCX, XLSX, PPTX, JPG and PNG. Check magic bytes. Max 25 MB. Each upload stays `scanning` (visible to its uploader only) until the ClamAV scan passes.
- Downloads use signed URLs that expire in 5 minutes. The bucket is private.
- Never log tokens, passwords or full request bodies. Secrets come from env only; keep `.env.example` current.
- Write an audit log entry for login, upload, visibility change, archive/restore, delete, role changes, appeal decisions (approve/reject), and every admin view of a document they see only as an admin.

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

## Responsive design rules

Every UI change follows these; the `orghive-responsive` skill has the full checklist and steps.
- Mobile first: unprefixed classes style phones; add `sm:` 640, `md:` 768, `lg:` 1024, `xl:` 1280, `2xl:` 1536 upward. Breakpoints live in `@theme` (`index.css`); in JS use `useBreakpoint`, never a raw media query.
- Page width comes from `<Container>` (max 1280px, gutters 16/24/32/80px, notch-safe). No ad-hoc `max-w-7xl px-…` wrappers.
- Type uses the fluid tokens (`text-display`, `text-title`, `text-h1`–`h3`, `text-lead`, `text-body`…). No breakpoint size jumps like `text-h1 lg:text-display`, and no `vw`-only font sizes.
- Every button and link has a hit area of at least 44×44px (`tap-area` for text links).
- No page-level horizontal scroll at 360px. Wide content (tables, code) scrolls inside its own container.
- Full-height sections use `dvh`, never `vh` or `h-screen`.
- Hover is never the only way to reach anything: every hover effect also runs on `:focus-visible`, and nothing is hidden until hover.
- Every UI change must be checked at 360, 768, 1366 and 1920 before it is called done. `pnpm --filter web test:e2e` enforces overflow, tap targets and axe in CI.

## Navigation rules

- Every page renders inside `AppShell` (`apps/web/src/app/app-shell.tsx`): one sticky header, the Back button, breadcrumbs, toasts. Never add a page-level header.
- Each route component calls `usePageChrome(chrome.…())` from `src/navigation/trails.ts` to publish its trail, section and logical parent.
- Back uses only `<BackButton/>` / `useBackNavigation` (rendered by the shell). No hand-written back links, no `navigate(-1)`.
- Links into sub-screens (upload, document, edit, appeal) use `<OriginLink>` or `useOriginNavigate`, which pass `state.from`.
- Without an origin, Back falls back to the logical parent: upload, edit and My documents go to `/dashboard`; a document goes to its Paperworks; an org page goes to its college, then `/colleges`, then home.
- After a successful upload, edit or appeal decision, call `finish(toast)`: back to the origin with `replace`. Forms with unsaved changes use `useUnsavedChangesGuard`.

## Working agreements for Claude

- Before a feature touching more than 3 files, propose a plan and wait for approval.
- Work in this order: shared Zod schema → Prisma/repository → service → route → presenter hook → view → tests.
- Every service method gets a unit test. Every route gets a Supertest test that covers its 401/403 paths.
- Run `pnpm lint && pnpm typecheck && pnpm test` before saying a task is done, and report the result.
- Don't add a dependency without saying why. Prefer the libraries listed above.
- Use Conventional Commits: `feat(documents): …`, `fix(auth): …`.
- When unsure about a domain rule (who decides appeals, deadlines, required documents), ask. Don't invent one.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
