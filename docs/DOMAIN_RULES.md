# Orghive domain rules

The school's rules that Orghive enforces. Only rules confirmed by the school go in "Confirmed". Rules the project owner chose go in "Provisional" with the date. Anything not yet answered stays in "Open questions" and must not be coded as if decided. `docs/PROJECT_WORKFLOW_SPEC.md` is the source of truth for the project workflow.

## Documents are never reviewed

Decided by the project owner on 2026-10-17 (`docs/PROJECT_WORKFLOW_SPEC.md`, section 0). **This replaces the document approval chain below. Do not bring approval back.**

- No document is sent to an adviser, council or anyone else for approval before others can see it. There are no review statuses, no approve/reject endpoints, no review queue and no reviewer dashboard for documents.
- The only approvals in Orghive are **appeals** to unblock a project or lift an organization's freeze (F11, spec section 3).

### Lifecycle

`uploading → scanning → available`, or `quarantined` if the scan refuses the file, then `archived`. See `packages/shared/src/document-status.ts`.

- `uploading` happens in the browser before the document exists; it is not stored.
- A new document is `scanning` until the worker's virus and file-type check passes, then `available`. A refused first file makes it `quarantined` (moved to `quarantine/`, audited); uploading a clean copy makes it `scanning` again.
- A re-upload of an available document becomes the current version once it is clean. Nothing needs approving again. A refused re-upload leaves the last clean version current.
- Officers archive `available` documents and restore them to `available`, with the visibility they had. Archive and restore are audited.
- Details (title, type, year, semester, description, tags) can change at any time before archiving.

### Visibility

Enforced in one place: `apps/api/src/repositories/document-visibility.ts`. Services and the web app never re-implement it.

| Visibility | Who sees an available document |
|---|---|
| `public` | Anyone, including signed-out visitors |
| `members` | Active members of the owning organization (any role, advisers included) |
| `private` | Active officers of the owning organization |

- **Before a document is available** (scanning or quarantined), only its uploader sees it. A version still being scanned, or refused, is listed only for its uploader.
- **Archived** documents: the owning organization's officers.
- **Other organizations see only public files.** This includes the parent CSC and the ISSC: no organization reviews another's documents.
- **Admins** (an active `admin` membership on the ISSC) see every available or archived document for support. Every time an admin opens, lists the files of or downloads a document they can see only because they are an admin, it is audited as `admin_override` (`metadata.access`: `view`, `versions` or `download`). Lists are not audited per row.
- **Setting it:** the organization's officers choose the visibility on upload and can change it at any time, in any state, from My documents or the document page: `PATCH /documents/:id/visibility` with `requireOwnOrgRole('officer')`. Admins get a 403 there (no override). Each change is audited as `visibility_change` with `from` and `to`.
- **Default for new uploads:** `public` (chosen by the project owner, 2026-10-17). The upload form shows the choice.
- **Existing documents** were mapped by the migration `20261017090000_documents_without_approval`: approved documents kept their visibility; draft, pending and rejected ones became `private`, so nothing unapproved became visible.

### Dashboard

`/dashboard` shows each user only the organizations of their active memberships. Its tiles count available documents by visibility, plus uploads the scan blocked. "Needs your attention" lists the user's own quarantined uploads. There is no "Pending reviews" panel.

## Projects and their checklist (built 2026-10-17)

`docs/PROJECT_WORKFLOW_SPEC.md` sections 2A and 2B. All unlock rules live in one pure function, `apps/api/src/services/project-rules.ts`; the worker re-applies them every 15 minutes and whenever a task's file passes the scan.

- An organization's **officers** create and edit its projects and file its tasks; its **members** (advisers included) can read them. Admins pass as usual (audited override). Creating and editing a project are audited (`project_create`, `project_update`).
- A project needs all five fields: name, target date, location, target beneficiaries, brief description. The **target date cannot be in the past** (Manila calendar).
- **Deadlines:** 14 calendar days in Asia/Manila, ending 23:59:59 Manila time on day 14 (day 0 = the creation date for the proposal, the target date for the post-event reports).
- **Proposal:** open from creation, due 14 days after it.
- **NOM and MOM:** exist only when the organization marks them as needed; locked until the proposal is submitted; no deadline. One that already has a file cannot be dropped.
- **ACR and Financial Report:** locked until the target date (Manila), then due 14 days after it. *Changed from the earlier provisional answer* ("once the proposal is complete and the target date has arrived"): the project owner's F10b brief unlocks them on the target date alone, so a late proposal does not hold back the reports.
- A task is **submitted** once its file passed the virus scan. Nobody reviews it. Its file is an ordinary Paperworks document (types `project-proposal`, `notice-of-meeting`, `minutes-of-meeting`, `activity-completion-report`, `financial-report`) with the visibility the officer chose; re-uploads are new versions. The proposal and the financial report default to `members`, the others to `public`.
- Task files must be **PDF, JPG or PNG** (the Semestral End Report merges them).
- A project is **completed** once every task it needs is submitted. `blocked` is set by the compliance rules (below): a blocked project's tasks are locked and refuse uploads.
- While another officer's file for a task is still being scanned, a second officer cannot replace it (only the uploader sees a file before the scan passes).

## Compliance and appeals (built 2026-10-17)

`docs/PROJECT_WORKFLOW_SPEC.md` section 3. The deadline rules live in `planProject` (`apps/api/src/services/project-rules.ts`) next to the unlock rules; who decides lives in one function, `apps/api/src/services/appeal-rules.ts`.

- **Blocked (3A):** the proposal is not submitted by its deadline (23:59:59 Manila on day 14, or the date an approved appeal set). Every task not yet submitted locks. Audited `project_block`; the officers are notified.
- **Frozen (3B):** a project's ACR or Financial Report is not submitted by its post-event deadline. An `OrgFreeze` row links the organization to that project (at most one open per project). While any freeze is open the organization cannot create projects (403 `ORGANIZATION_FROZEN`); existing projects stay workable. Audited `org_freeze`; the officers are notified. A late upload does not lift it.
- **When it is checked:** an hourly BullMQ job (`check-compliance`, which replaced the 15-minute `sync-projects`), and on read: listing or opening projects, the dashboard banner, and before creating a project. Both are idempotent: a status change and a freeze are acted on only by the check that made them, and notifications carry a dedupe key.
- **Reminders:** officers are notified once when an open task's deadline is within 3 Manila calendar days. A deadline an appeal moved is announced again.
- **Appeals:** an organization's own officers appeal (admins do not, it is the organization's decision) with a written reason of at least 20 characters and up to 5 supporting files. At most one pending appeal per blocked project and per freeze. Audited `appeal_submit`; the deciders are notified.
- **Who decides:** an SBO's appeal by the head of its college's CSC (the Governor); a CSC's by the ISSC head (the President); the ISSC's by the ISSC adviser. While that seat is vacant, an ISSC admin decides (audited `admin_override`). Nobody decides an appeal they submitted.
- **Approve:** sets a new due date (a Manila date after today; due 23:59:59 that day). For a block it becomes the proposal deadline, and the post-event deadline too if that would otherwise come first. For a freeze it becomes the post-event deadline and the freeze is lifted (`org_unfreeze`). If the new deadline also passes, the project blocks or freezes again. Audited `approve`.
- **Reject:** remarks are required (at least 10 characters). The block or freeze stays, the remarks are shown on the banner and in the history, and the organization can appeal again. Audited `reject`.
- **Supporting files** are not Paperworks documents. They upload straight to storage, are virus-scanned like documents (refused files go to `quarantine/`), and must be clean before the appeal is sent. Only the appealing organization's officers and the deciders can download them (5-minute links, each audited `appeal_attachment_view`; an ISSC admin's download is also audited as an override).
- **Notifications** (in-app and email, sent by the worker): deadline in 3 days, deadline missed (blocked or frozen), appeal submitted (to the deciders), appeal decided (to the officers and the submitter).

## Semestral End Report (built 2026-10-17)

`docs/PROJECT_WORKFLOW_SPEC.md` section 4. The order lives in one pure function, `planReport` (`apps/api/src/services/report-rules.ts`).

- **Who:** the organization's own officers ask for it from the dashboard (admins do not; they may see the list, audited). Audited `report_generate`. At most one report per organization and semester runs at a time.
- **Which projects:** undeleted projects whose target date falls in the chosen semester (see "Semesters" below), by target date, then name.
- **Order:** cover (organization, level, college, semester, academic year, generated date, project count), table of contents with page numbers, then per project a divider (name, event date, location, beneficiaries) and Proposal → NOM → MOM → ACR → Financial Report. NOM and MOM appear only when the project needs them. Every page after the cover is numbered.
- **Files:** a task's current clean version. PDFs keep their pages and page size; JPG and PNG become one A4 page each, scaled to fit. A missing file gets a "Not submitted" page; a file that cannot be read (damaged or encrypted) gets a "Could not be included" page instead of failing the report. Task files are only PDF, JPG or PNG, so there is no DOCX conversion.
- **Template:** one HTML template (Poppins, NwSSU greens, hexagon mark) rendered by headless Chromium (`playwright-core`, offline), merged with the files by `pdf-lib`.
- **Result:** a Paperworks document of the organization, type "Semestral End Report", `available` and `private` (chosen 2026-10-17), filed by the requester. It is generated from files that already passed the scan, so it is not scanned again. Audited `upload`. The requester is notified (in-app and email), ready or failed.
- **Progress:** the dashboard shows each report's state and progress (polled while it runs), the reason when it failed, and Download / Open when ready. A failed report is not retried by itself: the officer generates it again.

## Superseded: document approval chain

Confirmed by the school on 2026-10-15 and **removed on 2026-10-17** when the project owner decided documents are never reviewed (above). Kept here only because the same hierarchy now decides **appeals** (spec section 3):

| Owner | Was approved by | Appeals are decided by (spec 3A) |
|---|---|---|
| SBO (e.g. JPICE under CEA) | The CSC Governor of the SBO's college | Its college's CSC |
| CSC (e.g. CEA CSC) | The ISSC | The ISSC only |
| ISSC | The ISSC adviser | Not covered by the spec (see below) |

Existing `approve`/`reject` audit entries stay (the log is append-only); F11 reuses those actions for appeal decisions.

## Provisional (chosen by the project owner on 2026-10-17)

Answers to `docs/PROJECT_WORKFLOW_SPEC.md` section 5 and F11's open points. Revisit them if the school says otherwise. Built: deadlines, file formats, default visibility (see "Projects"), and the compliance and appeal rules (see "Compliance and appeals"): who decides, appeal-only supporting files, required rejection remarks, and one appeal per freeze.

- **Built with F11, chosen by the developer (confirm):** a blocked project does not also freeze its organization (its reports are locked, so it could not file them); unblocking moves a post-event deadline that would come first; a new due date must be after today.
- **Task file formats (built):** images become PDF pages in the Semestral End Report.
- **Blocked projects and frozen organizations (not built yet):** a blocked project can be soft-deleted (audited), which ends its block. A project that caused an open freeze cannot be deleted. (Projects cannot be deleted at all yet.)
- **Semesters (built, replaces the earlier `academic_terms` plan until an academic calendar exists):** fixed ranges, the academic year starting in August: 1st semester Aug 1 – Dec 31, 2nd semester Jan 1 – May 31, midyear Jun 1 – Jul 31 (`semesterRange` in `packages/shared/src/report.ts`). Midyear counts as a semester for the report. A project's semester is the one containing its target date.
- **"Accomplishment report"** stays a separate document type from the ACR until the school says they are the same.
- **Uploads** (from 2026-10-16): tags are free-form (at most 10, lowercased).

## Open questions

### Documents
- Should archived documents stay visible to the public?
- Is there an official list of document types and tags?

### Appeals and reports
- Answered provisionally on 2026-10-17 (confirm with the school): rejections need written remarks; each freeze is appealed and lifted on its own.
- Answered provisionally on 2026-10-17: midyear counts as a semester for the Semestral End Report; semesters are the fixed ranges above. Does the school's academic calendar use other dates?
- Are the provisional answers above what the school wants?
