import { z } from 'zod';

/**
 * Document lifecycle (docs/PROJECT_WORKFLOW_SPEC.md, section 0): uploading -> scanning ->
 * available, or quarantined when the virus scan refuses the file -> archived. Nobody reviews
 * or approves a document before others can see it; its visibility alone decides that.
 * `uploading` happens in the browser before the document exists, so it is not stored.
 */
export const DOCUMENT_STATUSES = ['scanning', 'available', 'quarantined', 'archived'] as const;

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);

export type DocumentStatus = z.infer<typeof documentStatusSchema>;
