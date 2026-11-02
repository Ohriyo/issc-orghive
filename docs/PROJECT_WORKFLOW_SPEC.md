# Project & Task Management — Spec

Source: `description.docx` (client feature description), adapted for Orghive.
This file is the source of truth for the project workflow. If code and this spec disagree, ask before changing either.

## 0. Decisions that override the original description

1. **No review or approval for viewing documents.** Uploaded files are never sent to an adviser or council for approval before they can be seen. Each organization alone decides who can see each of its files:
   - `public`: anyone, including visitors who are not signed in
   - `members`: signed-in members of that organization
   - `private`: that organization's officers only

   The organization can change a file's visibility at any time. Admins can't change it, but they can see private files for support, and each time they do it is audit-logged.
2. **The virus scan stays.** A newly uploaded file is hidden from everyone except the uploader until the scan passes. This is an automatic safety check, not a review.
3. **Appeals still need approval.** Approving an *appeal* to unblock a project or an organization is governance, not document review. It stays as described in section 3.
4. **Naming.** The original says "Inter-Student Student Council (ISSC)" and "College Student Council (CSC)". Orghive uses **Institutional Supreme Student Council (ISSC)** and **Collegiate Student Council (CSC)**. They are the same bodies.
5. **Task file checks are not review** (added 2026-10-31, section 6). Project task files are checked automatically after the virus scan, and an organization's governing bodies (its CSC, the ISSC) can clear a file's warnings or flag it invalid. This decides only whether the file **counts for the leaderboard**. It never changes who can see the file, never hides or removes it, and there is still no approval before a file can be seen.

## 1. Overview

The platform is the organizations' document archive and a project tracker. It guides event planning, document submission, compliance tracking and end-of-semester reporting.

## 2. Core workflow

### A. Project creation
An organization's officer creates a project with these fields, all required:
- Project name
- Target date (the event date)
- Location
- Target beneficiaries
- Brief description

On creation the organization also **ticks which pre-event documents the project needs**: Notice of Meeting (NOM), Minutes of Meeting (MOM), Communication Letter, Attendance Sheet. None is ticked by default. Only ticked documents become required tasks. Each tick can be changed later, until that document has a file (then it stays ticked).

### B. Milestone checklist (sequential)
Creating a project opens a checklist that unlocks one step at a time:

1. **Pre-event phase**
   - Upload the scanned, signed **Project Proposal** within **14 days of project creation**.
   - Completing the proposal unlocks the other pre-event files, each only when ticked (2A):
     - **Notice of Meeting (NOM)** and **Minutes of Meeting (MOM)**: no deadline.
     - **Communication Letter**: due by the end of the **event date** (23:59:59 Manila). It can hold **several files**, one per office, each with a short label such as "Letter to the Dean". It is submitted once one of its files passes the scan.
     - **Attendance Sheet**: listed with the pre-event files, but signed during the event, so it is due with the ACR, **14 days after the target date** (an appeal that moves the post-event deadline moves it too).
   - **Other pre-event document** (optional): always offered once the proposal is in. Any number of files, each with a custom label. Never required and never due; the project completes without it.
2. **Post-event phase**, due within **14 days after the target date**:
   - **Activity Completion Report (ACR)**
   - **Financial Report**

Added 2026-10-21 (client request): the Communication Letter, Attendance Sheet and other pre-event documents. A late or missing Communication Letter or Attendance Sheet only affects the leaderboard (5C); it never blocks the project or freezes the organization (section 3). New files of these three default to `private` visibility; the organization can change it.

A task counts as complete when its file is uploaded and has passed the virus scan and, for the checked tasks, the hard checks of section 6 (a PDF on the task's own template). No approval is needed. Every task file is also a normal archived document with its own visibility setting (section 0.1). Whether a complete task also counts for the leaderboard is section 6C.

### C. Project files (outside the checklist)
Added 2026-10-31 (client request). Besides the checklist, the organization's own account can add **any number of extra files** to a project, at any phase, from the project page ("Add files").
- Each file is a normal Paperworks document with the same details as any upload: title, type, description, tags, academic year and semester (pre-filled from the event date), visibility and "Acting as". It goes through the virus scan and the view-only viewer like any other file, and appears in the organization's Paperworks.
- They have no deadline and no unlock rule, so they never block a project, freeze an organization or count on the leaderboard. They can be added while a project is blocked or its organization frozen; a deleted project or an inactive organization refuses them.
- Any document type except the managed ones (Constitution & By-laws, Student Handbook). No limit per project beyond the usual 25 MB per file.
- Who sees each one is its visibility alone: governing bodies reading the project see it only if it is `governing` or `public`.

## 3. Compliance, blocking and appeals

### A. Proposal deadline missed
- If the proposal isn't uploaded within 14 days of creation, **that project** is automatically **blocked**. Its tasks are locked.
- To unblock it, the organization submits an **appeal** with a written reason. Supporting files are optional.
- Approval hierarchy:
  - an appeal from an **SBO** is decided by its college's **CSC**;
  - an appeal from a **CSC** is decided only by the **ISSC**.
- If the appeal is approved, the project unblocks and the reviewer sets a new proposal deadline. If it's rejected, the project stays blocked, the remarks are shown, and the organization can appeal again.

### B. ACR or Financial Report deadline missed
- If either report is missing 14 days after the event date, the **organization** is **frozen**. It can't create new projects until the appeal is approved. Existing projects can still be worked on.
- The organization appeals the same way, through the same hierarchy as 3A.
- An approved appeal lifts the freeze and sets a new deadline for the missing report(s).

## 4. Semestral End Report
- A **"Generate Semestral End Report"** button on the organization's dashboard, for officers.
- It compiles every submitted task document from all of the organization's projects in the selected semester into **one PDF**.
- The order is fixed:
  1. A cover page (organization, college, semester, academic year, generated date).
  2. A table of contents.
  3. For each project, by target date: a divider page (project name, date, location, beneficiaries), then Proposal → NOM → MOM → Communication Letter(s) → Attendance Sheet → other pre-event documents → ACR → Financial Report → the project's extra files (2C). Each letter and each other document is its own entry, named by its label in the table of contents ("Communication Letter: Letter to the Dean"), in upload order. Each extra file is its own entry named by its title ("Project file: Site visit photos"), in upload order; it never gets a "Not submitted" page.
- Missing required documents get a placeholder page saying "Not submitted". NOM, MOM, Communication Letter and Attendance Sheet are listed only when ticked (or filed anyway); other pre-event documents only when there are some.
- Cover and divider pages use one standard Orghive template, so every organization's report looks the same.
- Generation runs as a background job. The officer is notified when it's ready to download. The result is archived as a document with `private` visibility by default.

## 5. Leaderboard rules

Decided 2026-10-20 (Phase 0 of `docs/LEADERBOARD_PHASES.md`). The ranking lives in one pure function, `rankStandings` (`apps/api/src/services/leaderboard-rules.ts`). Never re-implement it elsewhere.

### A. Who is ranked
- **SBOs** and **CSCs** are ranked separately, each with its own Top 3 (the "SBO" and "CSC" tabs). The **ISSC is never ranked**.
- An organization appears once it has at least one implemented project in the semester. Deactivated and deleted organizations are left out (provisional: deactivated ones are already hidden from browsing).
- The homepage shows two podiums, the Top 3 SBOs and the Top 3 CSCs. On mobile, a toggle switches between them.

### B. Implemented project
- A project belongs to the semester that contains its target date, as in the Semestral End Report. The ISSC account sets each semester's first and last day at `/admin/semesters`, as the university calendar varies; a semester it has not set keeps its usual dates (1st Aug 1 – Dec 31, 2nd Jan 1 – May 31, midyear Jun 1 – Jul 31). A target date in a break between semesters belongs to the semester after it, so it still counts somewhere that is not final. The rules live in `semesterCalendar` and `semesterDatesProblem` (`packages/shared/src/semester-calendar.ts`). A semester's dates can be changed until its standings are final; dates that would make them final at once are refused.
- **Provisional, then final.** A semester's standings are **provisional** until its last day plus 7 days (the system setting "Days until final", 0 to 60, at `/system/settings`). The first recompute after that freezes both boards as **final**: no later change touches them, including a late file, a flag, a corrected figure, a new late value, a disqualification or a change to the grace days. `/leaderboard` and the dashboard say which it is. A semester nobody was ranked in stores nothing.
- **Disqualification.** The ISSC account can disqualify an organization (SBO or CSC) from a semester's leaderboard at `/admin/disqualifications`, with a required reason. The organization leaves that board and everyone below it moves up. Its files, projects and other semesters are not affected. The ISSC account can lift it, with a required reason, until the standings are final. Both are audited with "Acting as", and the organization is told, with the reason. The penalty rule is shown on `/leaderboard`. The public board shows neither the reason nor who was disqualified; the organization sees the reason on its dashboard.
- It is **implemented** when its target date has passed (Manila time) and its **ACR** and **Financial Report** are both submitted, meaning their files passed the virus scan.
- Since 2026-10-31 (section 6C), it counts only when **every required task is verified** and shared as `public` or `governing`. A project with a required task that is complete but not verified (legacy, warnings not cleared, flagged invalid) or `private` is **held**: it earns no points and adds no profit until that task is fixed. `/leaderboard` and the organization's standing say which tasks hold it.
- It counts in its event's semester even if the reports arrive after that semester ends. An event on Dec 28 with its reports in on Jan 5 counts for the 1st semester. Standings for a past semester therefore keep updating until its last projects are in.

### C. Points
- An implemented project earns **1.0 point** when every required task was submitted on time.
- It earns the **late value** (default **0.5**) when any required task was submitted after its **original** due date:
  - Proposal: 14 days after the project was created (`deadlineAfter(createdAt)`).
  - Communication Letter, when ticked: the end of the event date (`endOfManilaDay(targetDate)`).
  - Attendance Sheet, when ticked, ACR and Financial Report: 14 days after the target date (`deadlineAfter(targetDate)`).
  - A new deadline from an approved appeal (`proposalDueOverride`, `postEventDueOverride`) does not make a task on time. A task submitted after an approved appeal is late. The stored `proposalDueAt` and `postEventDueAt` columns already include overrides, so the original dates are computed, never read from them.
  - NOM, MOM and other pre-event documents have no deadline (section 2B), so they are never late. Unticked documents do not count.
  - Implementation (5B) still depends only on the ACR and Financial Report.
- A task's submission time is its `submittedAt`: the moment its file first passed the scan. Later versions do not change it, with one exception (section 6C): a file that replaces one **flagged invalid** counts from its own check, so a flagged file fixed after the deadline is late. A file that replaces a **legacy** one keeps the original time.
- The late value is a system setting the super admin edits in `/system` (0 to 1). Every change is audit-logged with the old and new values and triggers a recompute of the semesters still provisional. Final semesters keep their standings, and earlier snapshots are not rewritten.
- The breakdown is shown wherever points are: **"4.5 pts · 5 projects (1 late)"**.

### D. Net profit
- Each Financial Report records total income and total expenses in PHP, stored as integer **centavos**. Its net profit is income − expenses, which can be negative.
- An organization's **total net profit** is the sum of the net profits of **every submitted Financial Report** for its projects in the semester, one per project. This includes projects whose ACR is not in yet, which earn no points. Late projects add their full profit; only their points are reduced. A **held** project (5B, section 6C) adds no profit.
- Negative totals are allowed and shown as such.
- Amounts are **public**: on the homepage podiums and on `/leaderboard`, formatted as `₱12,345.00` (and `−₱1,234.00`). The Financial Report *file* keeps its own visibility (section 0.1). Only the two figures are public.
- The ISSC account can flag a report's figures **under review**, with a remark. Flagged figures are left out of the total until the flag is cleared, and the total shows "(1 report under review)". The project's points are not affected. This is not document review (section 0): the flag concerns the reported figures, never who can see the file.
- The organization can correct its figures until the semester closes: the later of the semester's last day and that project's post-event deadline, including an appeal override (provisional). Every correction is audit-logged with the old and new values.

### E. Ranking order
1. Points, highest first.
2. Total net profit, highest first.
3. Earliest last completion date: the day the organization's most recently implemented project became implemented (its later of ACR and Financial Report `submittedAt`). Earlier wins.
4. Organizations still tied share a rank (1, 1, 3) and are listed by name (provisional).

### F. Public data
Public leaderboard responses contain only: the organization's name, acronym, logo, college, rank, rank change, points, implemented and late project counts, total net profit and the number of reports under review. They never contain officer names, acting-as names or file links.

## 6. Task file integrity

Added 2026-10-31 (client request). Leaderboard points depend on task files, so each checked task's file must be the real, signed document for that task. The rules live in pure functions: `apps/api/src/services/integrity-rules.ts` (states, ranking, decisions) and `leaderboard-rules.ts` (held projects). Never re-implement them.

### A. Templates and task codes
- **Checked tasks:** Project Proposal, NOM, MOM, Communication Letter, Attendance Sheet, ACR and Financial Report. Other pre-event documents are not checked.
- From each checked task, the organization downloads its **template** in Word (to fill in) or PDF (to print). It follows the official formats (`docs/templates/README.md`) on 8.5 × 13 in long bond, pre-filled with the organization, college, project, event date and task.
- Each template carries a **QR code** and its **short code** printed under it, e.g. `OH-7K3P-ACR` (Crockford base 32 without I, L, O, U; the last part names the task). The QR holds an HMAC-signed payload of the task, the organization and the code (`TASK_QR_SECRET`).
- A one-file task always gets the same code. **Each Communication Letter gets its own code**, named after its label, every time its template is downloaded; the code is bound to the letter whose file first passes with it.
- Checked tasks take **PDF only** (a scan or a PDF saved from Word), up to 25 MB.

### B. Checks (after the virus scan, by the worker)
Each check is stored per version (`integrity_checks`) with a result (pass, warn, fail) and a message.

| Check | Fails (refused) | Warns |
|---|---|---|
| Format | not a readable PDF, no pages, over the size limit | |
| Task code | no QR code or short code found; a QR of another task, project or organization; a typed code missing from the text | |
| Blank | every page blank | |
| Exact duplicate | the same bytes (SHA-256) as another task file, of any task, project or organization | |
| Near duplicate | | a page that looks like a page of another task file (perceptual hash within the threshold) |
| Keywords | | the task's expected words, the project name or the organization's acronym not found (English and Filipino OCR, or the PDF's text) |
| Financial totals | | the totals read from the Financial Report differ from the figures entered by more than 5%, or were not found |

- When the QR is damaged, the officer can **type the short code** at upload; the code must then also be found in the file's text.
- A file that fails a hard check is **refused like a virus**: moved to quarantine, the organization notified with the reason, and the task keeps its earlier file.
- Correcting the Financial Report's figures re-runs the totals check against what was read; it does not read the file again.
- Another organization's file is never named in a message: it is "a task file of another organization".

### C. Complete, verified and ranked
- **Complete:** the file passed the scan and the hard checks. The task is submitted and the workflow moves on (2B, section 3).
- **Verified:** complete, with no warnings or with its warnings cleared by a governing body, and not flagged invalid.
- **Counts for the leaderboard:** verified and `public` or `governing`. A `private` file completes the task but never counts; the upload form says so.
- A Communication Letter counts only when every one of its files counts.
- The organization sees each file as: Checking, Verified ✓, Needs attention (with the reasons), Refused (with the reason), Flagged invalid (with the reason) or Legacy, unverified, each with a way to upload again.

### D. Governing bodies' decisions
- An organization's **governing bodies** decide (`mayDecideIntegrity`): an SBO's college CSC or the ISSC; a CSC's ISSC. Never the organization itself, and never on a `private` file, which they cannot see.
- **Clear warning:** a file that needs attention counts as verified. An optional note goes to the organization.
- **Flag invalid:** a verified, warned or legacy file stops counting until the organization uploads a corrected one. The reason is required and goes to the organization. The file stays visible as before.
- Both are audited with who acted ("Acting as"), notify the organization, and recompute the standings. They are offered on the project page and in the compliance overview's "Task files to look at".

### E. Existing files
Task files filed before 2026-10-31 are **legacy, unverified**: they still complete their tasks, but count for the leaderboard only once re-uploaded on the task's template. Affected organizations see a notice on their dashboard.

### F. Settings
The super admin edits in `/system/settings`, audited: each checked task's expected words (one phrase a line, `|` between alternatives) and the near-duplicate threshold (default 6 bits of 64). New checks use them; files already checked keep their results.

### G. Final standings and disqualification
Decided on 2026-11-02; see 5B: standings are provisional until the semester's last day plus 7 days (configurable), then frozen, and later changes never touch a final semester. The ISSC account disqualifies with a reason and can lift it with a reason until the standings are final. The penalty rule is on `/leaderboard`.

## 7. Open questions (confirm before building)
- Are the 14-day deadlines calendar days, counted in Asia/Manila time and ending at 23:59 on day 14?
- Within a CSC or the ISSC, who decides appeals: officers with a specific role, the adviser, or either?
- Must task files be PDF, so the report can merge them? Or should DOCX files be converted to PDF?
- Can a blocked project be deleted? Can a frozen organization still upload to its other projects? (This spec assumes yes.)
