import { z } from 'zod';

/** Document lifecycle from CLAUDE.md: draft -> pending -> approved | rejected -> archived. */
export const DOCUMENT_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'archived'] as const;

export const documentStatusSchema = z.enum(DOCUMENT_STATUSES);

export type DocumentStatus = z.infer<typeof documentStatusSchema>;
