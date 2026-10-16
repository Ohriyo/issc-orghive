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
