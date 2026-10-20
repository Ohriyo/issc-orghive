# Leaderboard: build phases

The rules are in `docs/PROJECT_WORKFLOW_SPEC.md`, section 5 "Leaderboard rules". If this file and the spec disagree, the spec wins.

## Phase 0: decisions (done 2026-10-20)

Phase 0 decisions: apply these to Phases 1–4 and record them under "Leaderboard rules" in docs/PROJECT_WORKFLOW_SPEC.md.

1. Implemented project: agreed. A project whose event date has passed and whose ACR and Financial Report are both submitted within the semester.

2. Ranking order: agreed, adjusted by decision 4:
   (1) project points, highest first
   (2) total net profit for the semester, highest first 
   (3) earliest last completion date as the tie-breaker

3. Separate tabs: "SBO" and "CSC" are ranked independently, each with its own Top 3. The ISSC is excluded. On the homepage headline, show the Top 3 SBOs and the Top 3 CSCs as two podiums, with a toggle between them on mobile.

4. Late completions count, with a deduction:
   - An implemented project earns 1.0 point if all its required tasks were submitted on time.
   - It earns 0.5 points if any required task (Proposal, NOM/MOM if required, ACR, Financial Report) was submitted after its original due date. This includes tasks submitted after an approved appeal.
   - Make the late-point value a system setting (default 0.5), editable by the super admin. Changes are audit-logged and apply to recomputed standings.
   - Show the breakdown everywhere: e.g. "4.5 pts · 5 projects (1 late)".
   - Put the scoring in the pure ranking function, with unit tests for all on-time, all late, mixed, and zero projects.

5. Profit is public:
   - Total net profit = the sum of (income − expenses) from ALL Financial Reports the organization submitted for projects in the semester, one per project, in centavos.
   - Late projects still add their full profit; only their points are reduced.
   - Negative totals are allowed and shown as such.
   - Show amounts publicly on the homepage podium and the /leaderboard page, formatted as ₱12,345.00.
   - Figures flagged "under review" by the ISSC are excluded from the total until cleared. Show "(1 report under review)" next to that organization's total.

Follow-up answers (2026-10-20):

- **NOM/MOM are never late.** They have no deadline (spec 2B), so only a late Proposal, ACR or Financial Report reduces a project to the late value.
- **Projects count in their event's semester**, even when the ACR and Financial Report arrive after that semester ends (e.g. an event on Dec 28 with its reports in on Jan 5 counts for the 1st semester).
- **Profit counts every submitted Financial Report**, even when the project's ACR is not in yet (that project adds profit but no points).

## Phase 1: Data, figures and the ranking function

Order: shared Zod schema → Prisma/repository → service → route → presenter hook → view → tests.

1. **Financial Report figures.** The Financial Report upload form also requires total income and total expenses in PHP. The shared schema parses `12,345.50` into integer centavos (never floats) and caps each amount. Store them in a new `financial_figures` table, one row per Financial Report task (income, expenses, flag fields, `updated_at`). Net profit = income − expenses and can be negative. "Acting as" is already required on task uploads (`createTaskDocumentRequestSchema`). The figures count once the task is submitted, that is, after the scan passes.
2. **Corrections.** `PATCH /projects/:projectId/financial-figures` (`requireOwnOrg`, acting as) until the semester closes (spec 5D: the later of the semester's last day and the project's post-event deadline, override included). Every change is audit-logged with old and new values.
3. **Under review.** The ISSC account (`requireAdmin`) can flag a report's figures with a remark, and clear the flag. Flagged figures are left out of the profit total; the project's points still count. The organization sees the flag and remark on the project page and its dashboard, gets a notification (with a dedupe key), and can correct the figures. Flag and clear are audit-logged. This never touches the file's visibility and is not document review.
4. **Late-point setting.** A new `system_settings` table (key, JSON value, updated by, updated at) holding `leaderboard.latePoints`, default 0.5, from 0 to 1. `GET/PATCH /system/settings` (`requireSuperAdmin`, audited with old and new values). A change triggers a recompute.
5. **Ranking function.** `rankStandings(facts, { latePoints })` in `apps/api/src/services/leaderboard-rules.ts`, pure. Per organization: points, implemented count, late count, total net profit, reports under review, last completion date, rank. It applies spec 5B–5E: implemented by event semester; late against the original `proposalDueAt` / `postEventDueAt`; appeal overrides still late; NOM/MOM never late; profit from every submitted Financial Report; flagged figures excluded; ISSC excluded; SBO and CSC ranked separately. Unit tests: all on time, all late, mixed, zero projects, Financial Report without ACR, negative profit, flagged figures, ties at each of the three levels and a full tie (shared rank), appeal-override lateness, reports after the semester ends, a custom late value.
6. **Leaderboard service.** Loads the facts (repository), calls `rankStandings`, and works out the rank change against the previous snapshot. For each semester and type it stores the ordered rows in Redis: a sorted set scored by rank position plus a hash of the row JSON. Points, profit and date can't be packed safely into one score once the late value is configurable. A `leaderboard_snapshots` table (semester, type, computed at, rows JSON) gets a row daily and on every change, written only when the standings actually differ.

## Phase 2: Real-time updates

1. **Recompute triggers.** Recompute on every event that changes standings: an ACR or Financial Report submitted (scan passed), figures entered or corrected, a flag added or cleared, a project completed, edited (its target date) or deleted, an appeal approved, the late value changed, and the semester rollover at Manila midnight. Recompute the project's own semester, which can be a past one (spec 5B). Run it as a BullMQ job deduplicated per semester and debounced to at most once every 5 s.
2. **Server-Sent Events.** `GET /api/v1/leaderboard/stream?academicYear=&semester=` sends both the SBO and CSC boards. Redis pub/sub lets every API instance broadcast. Heartbeat every 25 s, a per-IP connection cap, and automatic reconnect on the client, falling back to polling every 60 s if SSE fails. Configure Nginx for SSE (no buffering, long timeouts).
3. **Snapshot read.** `GET /api/v1/leaderboard?academicYear=&semester=&type=SBO|CSC&college=`. `type` is required: there is no combined board. It is public (add it to the PUBLIC list in `route-auth.test.ts` with a reason), cached in Redis, and sends `Cache-Control: public, max-age=15` plus an ETag. It also returns the current late value, so the UI can explain the scoring.
4. **Public fields only (spec 5F).** Name, acronym, logo, college, rank, rank change, points, implemented and late counts, total net profit, and reports under review. No officer names, no acting-as names, no file links.

## Phase 3: UI, the leaderboard page and the homepage headline

Use the frontend-design skill with our design tokens, the hexagon motif, and the responsive and navigation rules. Load `orghive-responsive` and check 360, 768, 1366 and 1920.

1. **Homepage headline.** A "Top Organizations this Semester" band directly under the hero with **two podiums: Top 3 SBOs and Top 3 CSCs**, side by side from `lg`. Below that, a segmented toggle (SBO | CSC) shows one podium at a time. Each podium is three HexFrames: #1 in the center and larger, #2 and #3 beside it. Each card shows logo, name, college, rank number, the breakdown "4.5 pts · 5 projects (1 late)", the net profit as `₱12,345.00` (negative shown as `−₱1,234.00`), and "(1 report under review)" when it applies. Below: "View full leaderboard →".
2. **Top 3 effects**, on both podiums:
   - large rank numerals with gold, silver and bronze accents;
   - a soft animated shimmer on the hex borders;
   - #1 gets a subtle crown or laurel mark and a glow;
   - when a Top 3 changes live, a short confetti burst plays and the cards swap places (Framer Motion layout animation).
   With `prefers-reduced-motion`: no shimmer or confetti, and an instant swap.
3. **/leaderboard page.** Semester picker, **SBO / CSC tabs** (no "All"), and a college filter on the SBO tab (each college has one CSC, so the CSC tab doesn't need it). Ranked list: rows 4 and below are numbered plainly, each with an up/down/same arrow for rank change, the points breakdown, net profit (with the under-review note), and a link to the organization's page. A "Live" indicator shows the SSE connection state. Rows animate smoothly when positions change.
4. **Empty state** for a semester with no implemented projects yet: "Rankings appear once organizations complete their first projects". Plus loading and error states.
5. **Note under the board**, using the live late value: "Ranked by points (1 per implemented project, 0.5 if any of its reports was late), then by net profit reported in submitted Financial Reports."
6. **Organization dashboard** (SBOs and CSCs, not the ISSC): its own rank on its board, its breakdown, and what would move it up, e.g. "Submit the ACR for 'Tree Planting' to count it", or "1 report under review: check the figures for 'Tree Planting'".
7. **Forms and admin screens.** A "Correct figures" form on the project page, the under-review flag and clear in `/admin` for the ISSC account, and the late-value setting in `/system`. (The income and expense fields on the Financial Report upload, the saved totals and the under-review notice were built in Phase 1, since the API requires the totals from then on.)
8. **Mobile.** The SBO | CSC toggle picks a podium. Each podium becomes a swipeable row with #1 first. The list stays readable at 360px.

## Phase 4: Verify

1. Unit tests for `rankStandings` (all cases in Phase 1.5) and for parsing and formatting centavos (including negatives and `₱` formatting). Integration tests that a submitted Financial Report, a correction, a flag and a late-value change each trigger a recompute and an SSE event.
2. Use webapp-testing with two browsers: open the homepage in one; in the other, sign in as an SBO account and complete a project with a profit high enough to enter the SBO Top 3. Confirm the SBO podium updates within a few seconds without refreshing, and the effects play. Repeat with reduced motion and confirm they're off.
3. Confirm flagged figures drop out of the profit total (points unchanged) and come back when cleared, a late project earns the late value, and no personal or acting-as names appear in any public leaderboard response or SSE event.
4. Load test the SSE endpoint with 500 concurrent connections and report memory use.
5. Add a short "Leaderboard rules" pointer to CLAUDE.md (where `rankStandings` lives; never re-implement it). The ranking definition is already in `docs/PROJECT_WORKFLOW_SPEC.md` section 5.
