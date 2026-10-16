# Orghive domain rules

The school's rules that Orghive enforces. Only rules confirmed by the school go in "Confirmed". Anything not yet answered stays in "Open questions" and must not be coded as if decided.

## Confirmed

### Approval chain (confirmed 2026-10-15)

Each organization's documents are approved by the level above it. The ISSC has no level above it, so its adviser approves.

| Document owner | Approved by |
|---|---|
| SBO (e.g. JPICE under CEA) | The CSC Governor of the SBO's college |
| CSC (e.g. CEA CSC) | The ISSC |
| ISSC | The ISSC adviser |

## Provisional (in code until the school confirms)

These are implemented so the app can work, and must be revisited when the open questions below are answered.

- **Who approves CSC documents:** the ISSC head (`memberships.is_head` on the ISSC). See `apps/api/src/services/document-viewer.service.ts`.
- **Who sees unapproved documents** (`apps/api/src/repositories/document-visibility.ts`):
  - Public and signed-in non-members: approved documents only.
  - Active members of the owning organization: every status, including drafts.
  - Approvers: pending documents of the organizations they review.
  - Admins: everything not deleted. Deleted documents: nobody.
- **Archived documents** are hidden from the public under the rule above. Whether archived Paperworks should stay public is not yet decided.
- **Document visibility** (chosen by the project owner on 2026-10-16; applies to approved documents only, and never widens access to unapproved ones). See `packages/shared/src/document.ts` and `apps/api/src/repositories/document-visibility.ts`:
  - `public`: anyone, including signed-out visitors.
  - `members`: any signed-in NwSSU account. **Default for new documents.**
  - `private`: active members of the owning organization, its approvers and admins.
  - Approvers also see approved documents (any visibility) of the organizations they review.
- **Editing and submitting** (`apps/api/src/services/document.service.ts`):
  - Officers of the owning organization create, edit, submit and delete its documents. Advisers do not.
  - Title, type, description, year and semester can change only while `draft` or `rejected`, so an approved document cannot be altered after approval. Visibility can change at any point before archiving.
  - Submitting needs a current file that has passed the virus scan.
  - A rejection comment is optional until the school answers "Is a written reason required on rejection?".
- **Admin override:** an ISSC admin passes every organization guard (role or approver). Each use writes an `admin_override` audit entry.

## Open questions

### Approval
- Which ISSC position approves CSC documents? The ISSC President, any ISSC officer, or someone else?
- Is the organization's own adviser part of the chain? For example, does the SBO adviser approve before the CSC Governor, or are advisers only involved for the ISSC?
- Is one approval final, or does an approved SBO document also go up to the ISSC?
- If the approver is absent or the position is vacant, who approves instead?
- Is a written reason required on rejection? Can a rejected document be fixed and resubmitted as a new version?
- Who can see pending and rejected documents?
- Should archived documents stay visible to the public?
- Does the approval chain differ by document type (e.g. financial reports)?

### Required reports
- Which documents must each organization submit every semester? Is the list the same for SBO, CSC and ISSC?
- What are the deadlines? Are they fixed or set by OSA each semester? Does midyear count?
- Are there per-event documents, such as a proposal before an event and a report after it?
- Who checks compliance, and what happens if a document is missing?
- What are the official names of each document type?
