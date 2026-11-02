# Project task templates

Every checked project task (docs/PROJECT_WORKFLOW_SPEC.md, section 6) has a template the organization downloads from its project page, as a Word file to type in or a PDF to fill by hand. Both carry the task's QR code and short code (e.g. `OH-7K3P-ACR`) in the header of every page, opposite the NwSSU logo. The organization prints, signs and scans the document and uploads the scan as a PDF; the worker reads the code back to tie the file to its task.

## Source formats

The layouts follow NwSSU's official document formats for S.Y. 2026-2027, as provided by the client on 2026-10-31.

| Task | Official source | Template |
|---|---|---|
| Project Proposal | Workshop proposal (free-form on the letterhead) | Sections I–IX with a schedule table and the signatories, pre-filled with the title, proponent, beneficiaries, date and venue |
| Notice of Meeting (NOM) | General Assembly NOM (page 5 of `GenAssemDocu.docx`) | Banner, date, addressees, agenda, signatories |
| Minutes of Meeting (MOM) | General Assembly minutes (pages 1–4 of `GenAssemDocu.docx`) | Date, venue, times, attendance, agenda, discussion, adjournment, signatories |
| Communication Letter | BDC reservation letter (free-form) | Date, addressee, subject with the letter's label, body, signatories |
| Attendance Sheet | **None provided: placeholder** | 25 numbered rows: name, year and program, signature |
| Activity Completion Report (ACR) | Form 7 – Accomplishment Report (landscape) | The Form 7 table pre-filled with the project, Secretary, President and Adviser |
| Financial Report | Form 9 – Financial Report | Cash In with TOTAL, Cash Out with Total Cash Out, Auditor, President and Adviser |

Every template is on 8.5 × 13 in long bond paper (Form 7 in landscape), in Arial 11, and names the organization, its acronym and the project, so the text checks can find them. Grey italic `[brackets]` mark what still needs typing; `[FULL NAME]` marks a signatory.

## Where it lives

- `apps/api/src/lib/data/letterhead-portrait.docx` and `letterhead-landscape.docx`: the letterhead alone (header with the NwSSU and Bagong Pilipinas logos, footer with the university's address and certifications), taken from the official files. Bodies, author names and document properties were removed; nothing personal remains (a test checks).
- `apps/api/src/lib/task-template.ts`: each task's body, and the QR code placed in the header.
- `apps/api/src/lib/task-qr.ts`: the QR's signed content (`OH1.<code>.<task>.<organization>.<signature>`, HMAC-SHA256 with `TASK_QR_SECRET`).
- `apps/api/src/services/task-template.service.ts`: who may download (the organization's own account) and which code a template gets.

## Changing a template

1. To change a task's body (wording, sections, columns), edit its function in `task-template.ts` and run `pnpm --filter api test task-template`.
2. To change the letterhead itself (a new logo or address), rebuild the two `letterhead-*.docx` files from an official document: keep only `word/header1.xml`, `word/footer1.xml` with their relationships and images, `styles.xml`, `fontTable.xml` and the theme, and a `document.xml` whose body is `{{BODY}}`. Never keep `docProps` or text from a real document.
3. When the official Attendance Sheet format arrives, replace the placeholder `attendanceSheet` body.
