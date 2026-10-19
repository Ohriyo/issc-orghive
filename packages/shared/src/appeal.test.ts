import { describe, expect, it } from 'vitest';
import { decideAppealRequestSchema, submitAppealRequestSchema } from './appeal';
import { addDays, manilaDate } from './manila-time';

const today = manilaDate(new Date());
const ID = '0199f0a0-0000-7000-8000-000000000001';
const reason = 'Our adviser was away, so the proposal could not be signed in time.';

describe('submitAppealRequestSchema', () => {
  it('takes a project for a block and a freeze for a freeze', () => {
    expect(
      submitAppealRequestSchema.parse({ type: 'PROJECT_BLOCK', projectId: ID, reason }),
    ).toMatchObject({ type: 'PROJECT_BLOCK', projectId: ID, attachmentIds: [] });
    expect(
      submitAppealRequestSchema.safeParse({ type: 'ORG_FREEZE', projectId: ID, reason }).success,
    ).toBe(false);
    expect(
      submitAppealRequestSchema.safeParse({ type: 'ORG_FREEZE', freezeId: ID, reason }).success,
    ).toBe(true);
  });

  it('requires a written reason of at least 20 characters', () => {
    const short = { type: 'PROJECT_BLOCK', projectId: ID, reason: 'Sorry.' };
    expect(submitAppealRequestSchema.safeParse(short).success).toBe(false);
  });

  it('drops duplicate attachments and caps them at five', () => {
    const body = { type: 'PROJECT_BLOCK', projectId: ID, reason, attachmentIds: [ID, ID] };
    expect(submitAppealRequestSchema.parse(body).attachmentIds).toEqual([ID]);
    const many = Array.from({ length: 6 }, (_, i) => `0199f0a0-0000-7000-8000-00000000000${i}`);
    expect(submitAppealRequestSchema.safeParse({ ...body, attachmentIds: many }).success).toBe(
      false,
    );
  });
});

describe('decideAppealRequestSchema', () => {
  it('approves with a due date after today', () => {
    const tomorrow = addDays(today, 1);
    expect(decideAppealRequestSchema.parse({ decision: 'approve', newDueDate: tomorrow })).toEqual({
      decision: 'approve',
      newDueDate: tomorrow,
      remarks: undefined,
    });
    expect(
      decideAppealRequestSchema.safeParse({ decision: 'approve', newDueDate: today }).success,
    ).toBe(false);
    expect(decideAppealRequestSchema.safeParse({ decision: 'approve' }).success).toBe(false);
  });

  it('rejects only with remarks', () => {
    expect(decideAppealRequestSchema.safeParse({ decision: 'reject' }).success).toBe(false);
    expect(
      decideAppealRequestSchema.safeParse({ decision: 'reject', remarks: 'No.' }).success,
    ).toBe(false);
    expect(
      decideAppealRequestSchema.safeParse({
        decision: 'reject',
        remarks: 'Submit the signed attendance sheet first.',
      }).success,
    ).toBe(true);
  });
});
