# Orghive build prompts

These are step-by-step prompts for building Orghive with Claude Code, one per feature, in build order. Each one states which skills and tools to use and what "done" means.

> **Documents are never reviewed or approved** (`docs/PROJECT_WORKFLOW_SPEC.md`, section 0; decided 2026-10-17). Who sees a document is its visibility alone, set by its organization's officers. The prompts below were corrected accordingly: the old F11 "Approval workflow" is gone, and **F11 is now Appeals**, the only approvals in Orghive. Never re-run an older copy of a prompt that adds review statuses, approve/reject endpoints or a document review queue.

**How to use them**

1. Start each feature in a **fresh session** (`/clear`) so the context holds only CLAUDE.md and that feature.
2. Paste the prompt in **plan mode** (Shift+Tab until it says *plan mode*). Read the plan, correct it, then approve.
3. When it finishes, check the *Done when* list yourself, then commit.
4. Run `/security-review` after F7, F8, F9 and before launch.

---

## Skills and tools

| Skill or tool | What it does for Orghive | Use in |
| --- | --- | --- |
| **frontend-design** (Anthropic skill) | Pushes the UI past generic templates. Gets the getlayers.ai-level polish while keeping your prototype's identity. | F1, F4–F6, F10, F10b |
| **impeccable** | Critique/polish/audit pass on finished screens: hierarchy, spacing, motion, accessibility, responsive. | After each UI feature, and F18 |
| **vercel-react-best-practices** | React performance rules: re-renders, bundle splitting, data-fetching waterfalls. | F4–F6, F10, F12, F13 |
| **webapp-testing** (Anthropic skill, Playwright) | Drives the running app in a real browser, checks flows, takes screenshots to compare against `design/`. | F4–F6, F10, F10b, F11, F17 |
| **orghive-responsive** (project skill) | The responsive checklist, viewport matrix and screenshot checks for `apps/web`. | Every UI change |
| **pdf** | Generates realistic sample PDFs for seed data and upload tests, and handles PDF thumbnail/text-extraction checks. | F2, F9, F11b, F12 |
| **skill-creator** | Builds your own project skills (see "Create these project skills" below). | Once, after F3 |
| `/security-review` (built-in command) | Reviews pending changes for vulnerabilities. | After F7, F8, F9, F11, F18 |
| `/review` (built-in command) | Reviews a branch or pull request before merge. | End of every feature |
| Plan mode and the **Plan** / **Explore** subagents | Plan first. Explore searches the codebase without filling your context. | Every feature |
| **Context7 MCP** (add it) | Pulls current docs for Prisma, TanStack Query, Express 5, Motion and shadcn, so code isn't written against outdated APIs. | Every feature |
| **Playwright MCP** (optional, add it) | Lets Claude click through your running site itself. Overlaps with webapp-testing; pick one. | F4–F6, F17 |
| **Hooks** (settings.json) | Auto-run `pnpm lint --fix` and `typecheck` after edits, so errors surface immediately. | Set up in F0 |

### Create these project skills (with skill-creator, after F3)

You'll repeat the same patterns 20+ times. Turning each into a skill makes Claude follow the layer rules exactly every time.

- **`orghive-endpoint`**: "Add an API endpoint". Order: Zod schema in `packages/shared` → repository → service with unit test → route with `requireAuth`/`requireOrgRole` → Supertest test covering 200/400/401/403 → cache invalidation.
- **`orghive-screen`**: "Add a screen". Order: presenter hook with TanStack Query → view component using the design tokens and `Hex*` components → loading/empty/error states → mobile layout → Playwright check against the matching `design/` PNG.
- **`orghive-migration`**: Prisma migration plus seed update plus repository change, with a rollback note.

Prompt to create them:
```
Use the skill-creator skill to create three project skills in .claude/skills/: orghive-endpoint, orghive-screen, orghive-migration. Base them on CLAUDE.md and on how F3's colleges endpoint and F4's home page were actually built in this repo (read those files first). Each skill should be a checklist Claude follows step by step, with the exact file paths and commands from this repo.
```

---

## F0 — Project setup

**Skills:** Plan mode, Context7
```
Set up the Orghive monorepo as described in CLAUDE.md. Step by step:
1. pnpm workspace with apps/web (React 19 + Vite + TS), apps/api (Node 22 + Express 5 + TS), packages/shared.
2. Shared tsconfig base, ESLint (flat config) + Prettier, path aliases.
3. docker-compose.yml with postgres:16, redis:7, minio and a bucket-init job, plus mailpit for email testing.
4. apps/api: config loader that validates env with Zod and fails fast; pino logger; helmet; CORS limited to WEB_ORIGIN; central error handler returning { error: { code, message } }; GET /health.
5. apps/web: Tailwind, shadcn/ui init, React Router, TanStack Query provider, an api client in src/lib/api.ts.
6. .env.example for both apps. No real secrets.
7. GitHub Actions: install, lint, typecheck, test on every push.
8. .claude/settings.json hook: after Edit/Write on .ts/.tsx files, run eslint --fix on that file.
Show me the plan first. When done, run everything and show that `pnpm dev` starts both apps and /health returns 200.
```
**Done when:** `docker compose up -d && pnpm dev` works on a clean clone, CI is green, and `/health` returns ok.

## F1 — Design tokens and signature components

**Skills:** frontend-design, Context7 (Motion, Embla, shadcn)
```
Use the frontend-design skill. Read every PNG in design/ first.
1. Sample the exact colors from the PNGs (primary dark green, leaf green, olive, light gray surface) and add them as Tailwind theme tokens. Add Poppins and a type scale.
2. Build these components in apps/web/src/components with Storybook-style demo routes at /dev/components:
   - HexFrame: hexagon clip-path frame with the white inner border, as in the prototype.
   - HexGrid: honeycomb layout of HexFrames; stacks on mobile.
   - WaveDivider: the green/olive sweeping wave, as SVG.
   - SpotlightCarousel: centered item enlarged with name, motto and Proceed. Side items smaller, blurred and faded. Arrow buttons, swipe, keyboard arrows, click on the centered card. Embla + Motion. Respects prefers-reduced-motion.
   - PillButton: the prototype's pill CTA.
   - DocumentCard: thumbnail, type badge, title, date, "New" badge.
3. Motion should feel like getlayers.ai (smooth, layered, cinematic) but stay light and green like the prototype.
Then use the impeccable skill to critique the components and fix what it finds.
```
**Done when:** `/dev/components` shows each component in light layout, mobile width works, and keyboard navigation works on the carousel.

## F2 — Database schema and seed

**Skills:** Context7 (Prisma), pdf (sample files)
```
Write the Prisma schema from the "Data model" section of docs/PLAN.md: colleges, organizations (type ISSC/CSC/SBO, parent_id, college_id), users, memberships (role, term_start, term_end), documents, document_versions, refresh_tokens, audit_logs, announcements. Documents are never reviewed (docs/PROJECT_WORKFLOW_SPEC.md, section 0): no approvals table, and no review statuses.
Step by step:
1. Schema with enums, indexes on documents(organization_id, academic_year, type), documents(status), unique slugs.
2. Raw SQL migration adding a tsvector column + GIN index on documents for full-text search.
3. Seed: the ISSC, 7 colleges (CAT, CCIS, CCJS, CEA, CoED, COM, CON) each with its CSC, CEA's six SBOs (JPICE, IECEP, ICpEP.SE, PSME, UAPSA, JIIEE) with the descriptions from the design, one admin, one officer and one adviser for JPICE.
4. Use the pdf skill to generate 10 realistic sample PDFs (activity proposal, accomplishment report, resolution) and seed them into MinIO as documents.
5. Repository layer in apps/api/src/repositories with the visibility filter applied in every document query.
Plan first.
```
**Done when:** `prisma migrate reset` produces a seeded database and the repository unit tests pass.

## F3 — Public read API (colleges, organizations)

**Skills:** Context7
```
Implement the public read endpoints from docs/PLAN.md, following the layer order in CLAUDE.md:
GET /api/v1/colleges, GET /api/v1/colleges/:slug (with CSC + SBOs), GET /api/v1/organizations/:slug.
1. Zod response schemas in packages/shared.
2. Services and controllers.
3. Redis cache-aside (keys college:list, college:{slug}, org:{slug}, TTL 10 min) plus ETag and Cache-Control: public, max-age=60, stale-while-revalidate=300.
4. Logo URLs served from object storage via the CDN-able public path.
5. Supertest tests including 404 for unknown slugs and a test that the second call is served from cache.
6. Generate OpenAPI from the Zod schemas and serve Swagger at /api/docs in development.
```
**Done when:** tests pass, `/api/docs` lists the endpoints, and a repeat call shows a cache hit in the logs.

## F4 — Home page

**Skills:** frontend-design, vercel-react-best-practices, webapp-testing, then impeccable
```
Build the home page from design/HOME PAGE.png using the F1 components and the F3 API.
Sections: header (Search pill, Login link), hero (tagline "Organizing Unity, Archiving Transparency", Browse Repository CTA, HexGrid of college logos linking to each college), About Us, ISSC card (logo, description, Paperworks / CSC / Updates pills), contact footer.
Add a getlayers.ai-style animated hero background: a slow green gradient or particle field using a lightweight shader. Lazy-load it, and fall back to a static gradient when prefers-reduced-motion is on or on low-end devices.
Scroll-reveal for each section with Motion whileInView.
Presenter hook: useHomeData (colleges + ISSC). The view gets props only.
Then use the webapp-testing skill to screenshot the page at 1366px and 390px and compare it with the design PNG, and list any differences. Apply vercel-react-best-practices (code-split the WebGL background). Finish with an impeccable polish pass.
```
**Done when:** the page matches the PNG, Lighthouse performance is ≥ 90 on mobile, and there are no layout jumps.

## F5 — College and SBO selection carousels

**Skills:** frontend-design, webapp-testing
```
Build /colleges (the "Collegiate Student Councils" carousel, design/COLLEGE SELECTION PAGE(*).png) and /colleges/:slug/organizations (the "Student Body Organizations" carousel, design/JPICE.png and siblings). Use ONE SpotlightCarousel driven by API data. The 7 + 6 PNGs are states of the same component, not separate pages.
Requirements: shield watermark background, centered item shows name and motto, Proceed navigates, the URL reflects the selected item (?focus=cea) so it is shareable, and arrow keys, swipe and click all work.
Use webapp-testing to step through every college and SBO and screenshot each state against its PNG.
```
**Done when:** every PNG state is reproduced, and keyboard and touch both work.

## F6 — College page and organization page

**Skills:** frontend-design, impeccable
```
Build two templates:
1. /colleges/:slug from design/COLLEGIATE PAGE.png: college title + description listing its SBOs, HexGrid of SBO logos, WaveDivider, CSC card with Paperworks and SBO pills.
2. /orgs/:slug from design/jpice description.png (and jiiee, uapsa): large HexFrame logo, acronym, full name, description, Paperworks pill.
Both get presenter hooks, loading skeletons shaped like the final layout, and a friendly 404.
Add SEO: title, meta description and Open Graph image per organization.
Finish with an impeccable audit and fix the findings.
```
**Done when:** every college and SBO in the seed renders correctly, and an unknown slug shows the 404.

## F7 — Authentication (JWT)

**Skills:** Context7 (jose), then `/security-review`
```
Implement authentication exactly per the "Security rules" in CLAUDE.md. Plan first, then step by step:
1. POST /auth/login: Argon2id verify, rate limit 5 per 15 min per IP + per account (Redis store), audit log.
2. Access JWT (15 min, EdDSA via jose, claims sub, roles[{orgId, role}], jti). Refresh token: random, hashed in refresh_tokens, httpOnly cookie, rotation with family reuse detection.
3. POST /auth/refresh and POST /auth/logout (revoke family).
4. Forgot password / reset via emailed one-time token (mailpit locally) and forced password change on first login.
5. Web: auth store holding the access token in memory only; fetch wrapper that refreshes once on 401 and retries; silent refresh on app load; login page styled per the design system; protected routes.
6. Tests: wrong password, rate limit, expired access token, refresh rotation, reuse of an old refresh token revokes the family, logout.
When done, run /security-review and fix every finding.
```
**Done when:** all tests pass, no token is visible in localStorage, and `/security-review` is clean.

## F8 — Role-based access per organization

**Skills:** `/security-review`
```
Implement authorization:
1. Middleware requireAuth and requireOrgRole(...roles) that resolves the organization from :slug or the document's organization_id and checks a membership with an active term.
2. Admin bypass, with an audit log entry. Decisions that belong to the organization alone (who can see its documents) use requireOwnOrgRole, which admins do not pass.
3. Visibility filter (public = anyone / members = the organization's members / private = its officers; only the uploader before the virus scan passes) enforced in the document repository, not in controllers.
4. Supertest matrix: for each role (anonymous, student, JPICE officer, IECEP officer, CEA adviser, admin) × each document action, assert the expected 200/401/403. A JPICE officer must NOT be able to touch IECEP documents.
Run /security-review afterwards.
```
**Done when:** the permission matrix test passes, and an expired term blocks access.

## F9 — Document upload pipeline

**Skills:** pdf (test files), Context7 (BullMQ, S3 SDK), `/security-review`
```
Build uploads so file bytes never pass through Node:
1. POST /organizations/:slug/documents/upload-url: officer only. Validate type and size, return a pre-signed PUT URL to a random object key.
2. Browser uploads directly to storage with a progress bar (drag and drop, multiple files).
3. POST /organizations/:slug/documents: save metadata (title, type, academic year, semester, visibility, tags), create version 1, status scanning (only the uploader sees it), enqueue jobs.
4. BullMQ worker (separate process): verify magic bytes, ClamAV scan, generate a thumbnail of PDF page 1, extract text into the tsvector column, compute sha256. A clean file makes the document available to whoever its visibility allows; on a scan failure, quarantine the file and mark the document quarantined. Nothing is reviewed.
5. Re-upload to an existing document creates a new version, and old versions stay downloadable.
6. Use the pdf skill to create test fixtures: a valid PDF, a PDF renamed to .docx, an oversized file, and an EICAR test file.
7. Upload form UI with React Hook Form + the shared Zod schema.
Run /security-review at the end.
```
**Done when:** a valid PDF goes scanning → available → thumbnail visible, the EICAR file is quarantined, and spoofed extensions are refused.

## F9b — Organization dashboard (signed-in home)

**Skills:** frontend-design, orghive-responsive, webapp-testing, impeccable
```
Build the signed-in workspace that users land on after login. It is not in the prototype, so design it first in the same visual language (greens, hexagon accents, pill buttons; calm, not cinematic) and show me before building.

1. Route /dashboard, protected. After login, redirect here instead of the current page with only Sign out / Change password. Move those two into a user menu in the header (avatar + name).
2. API: GET /api/v1/me/dashboard returns the user's active memberships (org, role, term_end) and, per organization: counts of available documents by visibility (public, members, private) plus scanning, quarantined and archived, the 5 most recent documents, and the user's own uploads the virus scan blocked. Service + repository + Zod schema in packages/shared + Supertest tests (401 when signed out; an officer only sees their own orgs).
3. Layout:
   - Org switcher at the top if the user belongs to more than one organization (e.g. JPICE officer who is also a CSC member). Remember the last one chosen.
   - Org header: logo in HexFrame, acronym, role badge, "Term ends <date>". Show a warning when it ends in under 14 days.
   - Stat tiles: Public, Members only, Private, Blocked by scan. Each opens My documents filtered to it.
   - Primary action "Upload document" (opens the F9 upload flow for this org) + "View public Paperworks".
   - "Needs your attention": the user's uploads the virus scan blocked, with "Upload a clean copy".
   - "Recent activity": the last uploads, visibility changes and archive/restore for this org.
   - Empty state for a new org with no documents: a short welcome + upload button.
4. /dashboard/documents: the org's documents the user may see, including files still being scanned. Tabs by lifecycle state, search by title, edit details, change visibility (officers only), archive.
5. Role-aware panels (render only when the role applies; leave clear extension points):
   - admin: link to /admin.
   - Projects (F10b) and appeals to decide (F11) plug in here.
6. Mobile: stat tiles 2×2, actions in a sticky bottom bar, org switcher as a sheet. Check at 360, 768, 1366, 1920.
Use webapp-testing to log in as the seeded JPICE officer, the CEA adviser and the admin, and screenshot each dashboard. Finish with an impeccable polish pass.
```
**Done when:** each seeded account lands on a dashboard that fits its role, the JPICE officer sees only JPICE data, and an upload from the dashboard shows up as Scanning, then Available.

## F10 — Paperworks page and document detail

**Skills:** frontend-design, vercel-react-best-practices, webapp-testing, impeccable
```
Design and build the Paperworks archive (it is not in the prototype, so design it in the same visual language first, and show me before building):
1. /orgs/:slug/paperworks: grid/list toggle of DocumentCards, tabs by document type, filter chips by academic year and semester, sort, cursor pagination with "Load more", and an empty state for orgs with no documents yet.
2. /documents/:id: inline PDF preview (react-pdf, lazy-loaded, with a "NwSSU Orghive" watermark), metadata, version history, and a download button that fetches a 5-minute signed URL.
3. For officers: Upload, Edit, Change visibility and Archive actions, shown only when permitted.
4. Presenter hooks with TanStack Query, prefetch on card hover, and optimistic archive.
Use vercel-react-best-practices (no request waterfalls, split the PDF viewer bundle). Use webapp-testing to run the browse → open → download flow. Finish with impeccable.
```
**Done when:** a student can find and download a document in two clicks from the org page.

## F10b — Projects and milestone checklist (built 2026-10-17)

**Skills:** orghive-responsive, webapp-testing, Context7 (Prisma, BullMQ)
```
Implement sections 2A and 2B of docs/PROJECT_WORKFLOW_SPEC.md, following CLAUDE.md layer order:
1. Prisma: Project (org, name, targetDate, location, beneficiaries, description, status: active | blocked | completed, proposalDueAt, postEventDueAt, nomRequired, momRequired) and ProjectTask (type: PROPOSAL | NOM | MOM | ACR | FINANCIAL_REPORT, status: locked | open | submitted, dueAt, documentId).
2. Shared Zod schemas. Create a project with all five fields required; targetDate cannot be in the past.
3. The service creates tasks on project creation: PROPOSAL open, due in 14 days; NOM/MOM locked until the proposal is submitted (and only if required); ACR and FINANCIAL_REPORT locked until the target date, then due 14 days after it. Put all unlock rules in one pure function with unit tests for every transition.
4. Submitting a task = uploading through the existing F9 pipeline linked to that task. The task becomes submitted once the file passes the scan. The officer picks the file's visibility as usual.
5. Routes: POST/GET /organizations/:slug/projects, GET/PATCH /projects/:id, POST /projects/:id/tasks/:type/upload-url, all requireOrgRole('officer') for writes.
6. UI in the dashboard: a "Projects" list (status chips, next deadline), a "New project" form, and a project page with a vertical stepper (Pre-event → Event → Post-event). Each task shows locked / open (countdown to due date) / submitted, with upload buttons. Follow the responsive and navigation rules in CLAUDE.md.
```
**Done when:** a project goes proposal upload → scanned → submitted → NOM/MOM unlock → event day → reports → completed, and the e2e checks pass for the three new screens at 360, 768, 1366 and 1920.

## F11 — Appeals (compliance, blocking and appeals) (built 2026-10-17)

Built from a revised brief: the hourly `check-compliance` job replaced `sync-projects`; routes are `POST /organizations/:slug/appeals` (both types), `GET /projects/:projectId/appeals`, `GET /organizations/:slug/compliance`, `GET /appeals/queue`, `POST /appeals/:appealId/decision`, plus appeal attachments and `/me/notifications` (a basic bell; F16 adds the rest). Not done yet: the dashboard panel's count of pending appeals, the two-user browser run, and `/security-review`.

**Skills:** webapp-testing, `/security-review`
```
Implement section 3 of docs/PROJECT_WORKFLOW_SPEC.md, following CLAUDE.md layer order. Documents are never reviewed; appeals are the only approvals in Orghive. Confirm the provisional rules in docs/DOMAIN_RULES.md (who decides, deadlines) with me before coding.
1. Deadlines (BullMQ job next to the existing sync-projects job, Asia/Manila): a project whose proposal is not submitted by proposalDueAt becomes blocked, and its tasks lock. An organization with an ACR or Financial Report still missing after a project's postEventDueAt is frozen: it cannot create projects, but existing projects stay workable. Audit both.
2. Prisma: Appeal (the blocked project or the frozen organization, written reason, optional supporting files through the upload pipeline, status pending | approved | rejected, decidedBy, remarks, new deadline) and a record of freezes. At most one pending appeal per block or freeze.
3. Who decides: an SBO's appeal by its college's CSC; a CSC's appeal only by the ISSC; the ISSC's by the ISSC adviser. Within the deciding organization, its head (is_head) decides; an ISSC admin may decide when the seat is vacant (audited override).
4. Approving unblocks the project or lifts the freeze and sets a new deadline for the missing task(s). Rejecting keeps the block, shows the remarks, and allows a new appeal. Audit every decision (approve/reject) and invalidate the affected caches.
5. Routes: POST /projects/:id/appeals, POST /organizations/:slug/appeals, GET /appeals (to decide, and my own), POST /appeals/:id/decision. Supertest 401/403 for every route, plus "a CSC officer who is not its head cannot decide".
6. UI: an appeal form on a blocked project and on a frozen organization's dashboard; a decision queue at /dashboard/appeals with approve/reject dialogs (remarks, new deadline); a dashboard panel with the count for deciders. Follow the responsive and navigation rules in CLAUDE.md.
Use webapp-testing to run, as two different users: missed proposal → blocked → appeal → reject → appeal again → approve → new deadline → upload.
Run /security-review afterwards.
```
**Done when:** the end-to-end flow passes, a blocked project's tasks refuse uploads, and a frozen organization cannot create projects but can still finish existing ones.

## F11b — Semestral End Report (built 2026-10-17)

Built with fixed semester ranges (midyear included), headless Chromium for the template, `pdf-lib` for the merge, and the result filed as an `available`, `private` document (`docs/DOMAIN_RULES.md`). Routes: `POST` and `GET /organizations/:slug/semestral-reports`; the `reports` queue in the worker. Not done yet: the production worker image needs Chromium (F19, `CHROMIUM_EXECUTABLE_PATH`).

**Skills:** pdf, Context7 (BullMQ, pdf-lib)
```
Implement section 4 of docs/PROJECT_WORKFLOW_SPEC.md: a "Generate Semestral End Report" button for officers on the organization's dashboard. A background job compiles every submitted task file of the organization's projects in the chosen semester into one PDF: cover page, table of contents, then per project (by target date) a divider page and Proposal → NOM → MOM → ACR → Financial Report, with a "Not submitted" placeholder for anything missing. Cover and dividers use one Orghive template. Images become PDF pages. The officer is notified when it is ready; the result is archived as a document with private visibility. Ask me how semesters map to dates before building.
```
**Done when:** a seeded semester produces one PDF in the fixed order, missing documents show the placeholder, and it appears in the organization's documents as private.

## F12 — Search

**Skills:** vercel-react-best-practices, pdf
```
Implement GET /api/v1/search?q=&college=&org=&type=&year= using the PostgreSQL tsvector (title weight A, tags B, extracted text C), with ts_headline snippets and visibility filtering.
Web: wire the home Search pill to a command-palette style overlay (Cmd/Ctrl+K) with debounced instant results, plus a full /search results page with filters.
Cache popular queries in Redis for 5 minutes.
Test that text inside a seeded PDF (created with the pdf skill) is findable.
```
**Done when:** searching a phrase that only exists inside a PDF finds it in under 300 ms locally.

## F13 — Caching pass

**Skills:** vercel-react-best-practices
```
Audit and complete caching per CLAUDE.md:
1. List every GET endpoint with its cache key, TTL and Cache-Control header in a table, and fix any that are missing or wrong.
2. Make sure every mutation invalidates the right Redis keys and TanStack Query keys. Add a test for each invalidation.
3. Confirm user-specific responses are private, no-store.
4. Static assets: hashed filenames, 1-year immutable cache, preload Poppins.
5. Run a quick load test with autocannon on GET /colleges/:slug and GET /organizations/:slug/documents, with and without Redis, and report requests/sec.
```
**Done when:** the table is complete, invalidation tests pass, and the load test shows the cache benefit.

## F14 — Admin console

**Skills:** frontend-design, impeccable
```
Build /admin (admin role only):
1. Manage colleges and organizations: create/edit, upload logo, reorder carousel position, activate/deactivate.
2. Manage users and memberships, including a "new academic year" wizard that ends the current officers' terms and assigns the incoming officers in bulk (CSV import).
3. Audit log viewer with filters.
4. Storage and activity stats.
Use shadcn data tables. Keep it calm and functional, not cinematic.
```
**Done when:** an admin can add a new SBO with a logo and it appears in the carousel without a deploy.

## F15 — Updates (announcements) and compliance overview

**Skills:** frontend-design
```
1. Announcements: ISSC and CSC officers post updates. Build the /updates page linked from the ISSC card, with a list and a detail view.
2. Compliance overview for the CSC and the ISSC: for each organization under them, its projects this semester with each task's state (open, submitted, overdue), blocked projects and frozen organizations (from F10b and F11). Read-only: nothing here approves documents. Ask me what else the councils need to see before building.
```

## F16 — Notifications

**Skills:** Context7 (BullMQ, Nodemailer)
```
Send email (via a BullMQ job, mailpit locally) and in-app notifications for: a task deadline in 3 days and on the day, a project blocked or an organization frozen, an appeal submitted (to its deciders), an appeal decided (with remarks), an upload blocked by the virus scan, the Semestral End Report ready, and a term ending in 14 days. Add a bell icon with unread count and a notification preferences page.
```

## F17 — Test suite and CI hardening

**Skills:** webapp-testing
```
1. Raise coverage: services ≥ 80%, every route has auth tests.
2. Playwright end-to-end suite for: browse home → college → org → paperworks → download; login → create project → upload proposal → submitted; missed deadline → appeal → approve; search; admin creates org. Run it in CI against docker-compose services.
3. Visual regression screenshots for home, college carousel, college page and org page, compared with design/.
4. Add axe accessibility checks to the Playwright runs.
```

## F18 — Security, performance and accessibility review

**Skills:** `/security-review`, impeccable, vercel-react-best-practices
```
Pre-launch review:
1. Run /security-review on the whole codebase. Then check the OWASP Top 10 manually against our code and list each item with pass/fix.
2. Verify headers (CSP, HSTS, X-Content-Type-Options) using a running instance.
3. Run impeccable in audit mode on every screen: accessibility, contrast of green-on-gray text, responsive behavior, reduced motion.
4. Run Lighthouse on home, college and paperworks pages (mobile). Fix anything under 90.
5. Write docs/PRIVACY_NOTICE.md draft for RA 10173 (Data Privacy Act) for the school's DPO to review.
```

## F19 — Deployment

**Skills:** Context7
```
Prepare production deployment:
1. Multi-stage Dockerfiles for api, worker and web (web as static files behind Nginx).
2. docker-compose.prod.yml with Nginx (TLS via Let's Encrypt), api ×2, worker, postgres, redis, minio or R2 config, PgBouncer.
3. Daily pg_dump backups to object storage with 30-day retention, plus a documented, tested restore procedure.
4. Cloudflare in front for CDN and DDoS protection.
5. Sentry for errors, uptime check on /health, pino logs to file with rotation.
6. docs/DEPLOY.md runbook: first deploy, update, rollback, restore.
```
**Done when:** a fresh server reaches a running HTTPS site by following DEPLOY.md, and a backup restore has been tested.
