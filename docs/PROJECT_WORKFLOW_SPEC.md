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

### B. Milestone checklist (sequential)
Creating a project opens a checklist that unlocks one step at a time:

1. **Pre-event phase**
   - Upload the scanned, signed **Project Proposal** within **14 days of project creation**.
   - Completing the proposal unlocks the other pre-event files: the **Notice of Meeting (NOM)** and **Minutes of Meeting (MOM)**. These apply only if the organization marks them as needed for the project.
2. **Post-event phase**, due within **14 days after the target date**:
   - **Activity Completion Report (ACR)**
   - **Financial Report**

A task counts as complete when its file is uploaded and has passed the virus scan. No approval is needed. Every task file is also a normal archived document with its own visibility setting (section 0.1).

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
  3. For each project, by target date: a divider page (project name, date, location, beneficiaries), then Proposal → NOM → MOM → ACR → Financial Report.
- Missing documents get a placeholder page saying "Not submitted".
- Cover and divider pages use one standard Orghive template, so every organization's report looks the same.
- Generation runs as a background job. The officer is notified when it's ready to download. The result is archived as a document with `private` visibility by default.

## 5. Leaderboard rules

Decided 2026-10-20 (Phase 0 of `docs/LEADERBOARD_PHASES.md`). The ranking lives in one pure function, `rankStandings` (`apps/api/src/services/leaderboard-rules.ts`). Never re-implement it elsewhere.

### A. Who is ranked
- **SBOs** and **CSCs** are ranked separately, each with its own Top 3 (the "SBO" and "CSC" tabs). The **ISSC is never ranked**.
- An organization appears once it has at least one implemented project in the semester. Deactivated and deleted organizations are left out (provisional: deactivated ones are already hidden from browsing).
- The homepage shows two podiums, the Top 3 SBOs and the Top 3 CSCs. On mobile, a toggle switches between them.

### B. Implemented project
- A project belongs to the semester that contains its target date, as in the Semestral End Report (`semesterOf`, `packages/shared/src/report.ts`).
- It is **implemented** when its target date has passed (Manila time) and its **ACR** and **Financial Report** are both submitted, meaning their files passed the virus scan.
- It counts in its event's semester even if the reports arrive after that semester ends. An event on Dec 28 with its reports in on Jan 5 counts for the 1st semester. Standings for a past semester therefore keep updating until its last projects are in.

### C. Points
- An implemented project earns **1.0 point** when every required task was submitted on time.
- It earns the **late value** (default **0.5**) when any required task was submitted after its **original** due date:
  - Proposal: 14 days after the project was created (`deadlineAfter(createdAt)`).
  - ACR and Financial Report: 14 days after the target date (`deadlineAfter(targetDate)`).
  - A new deadline from an approved appeal (`proposalDueOverride`, `postEventDueOverride`) does not make a task on time. A task submitted after an approved appeal is late. The stored `proposalDueAt` and `postEventDueAt` columns already include overrides, so the original dates are computed, never read from them.
  - NOM and MOM have no deadline (section 2B), so they are never late.
- A task's submission time is its `submittedAt`: the moment its file first passed the scan. Later versions do not change it.
- The late value is a system setting the super admin edits in `/system` (0 to 1). Every change is audit-logged with the old and new values and triggers a recompute of the current and the previous semester. Older semesters keep their standings, and earlier snapshots are not rewritten.
- The breakdown is shown wherever points are: **"4.5 pts · 5 projects (1 late)"**.

### D. Net profit
- Each Financial Report records total income and total expenses in PHP, stored as integer **centavos**. Its net profit is income − expenses, which can be negative.
- An organization's **total net profit** is the sum of the net profits of **every submitted Financial Report** for its projects in the semester, one per project. This includes projects whose ACR is not in yet, which earn no points. Late projects add their full profit; only their points are reduced.
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

## 6. Open questions (confirm before building)
- Are the 14-day deadlines calendar days, counted in Asia/Manila time and ending at 23:59 on day 14?
- Within a CSC or the ISSC, who decides appeals: officers with a specific role, the adviser, or either?
- Must task files be PDF, so the report can merge them? Or should DOCX files be converted to PDF?
- Can a blocked project be deleted? Can a frozen organization still upload to its other projects? (This spec assumes yes.)
- Does a semester follow the academic calendar from `academic-term.ts`?
