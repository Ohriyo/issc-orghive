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

## 5. Open questions (confirm before building)
- Are the 14-day deadlines calendar days, counted in Asia/Manila time and ending at 23:59 on day 14?
- Within a CSC or the ISSC, who decides appeals: officers with a specific role, the adviser, or either?
- Must task files be PDF, so the report can merge them? Or should DOCX files be converted to PDF?
- Can a blocked project be deleted? Can a frozen organization still upload to its other projects? (This spec assumes yes.)
- Does a semester follow the academic calendar from `academic-term.ts`?
