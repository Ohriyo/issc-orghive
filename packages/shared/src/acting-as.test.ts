import { describe, expect, it } from 'vitest';
import { actingAsRequestSchema, actingAsSchema } from './acting-as';
import { addVersionRequestSchema, createDocumentRequestSchema } from './document';
import { createTaskDocumentRequestSchema } from './project';

const UPLOAD_KEY =
  'uploads/0195f3c0-0000-7000-8000-0000000000a1/0195f3c0-0000-7000-8000-0000000000b1';

describe('actingAsSchema', () => {
  it('trims and accepts 2 to 80 characters', () => {
    expect(actingAsSchema.parse('  Juan Dela Cruz  ')).toBe('Juan Dela Cruz');
    expect(actingAsSchema.parse('Jo')).toBe('Jo');
    expect(actingAsSchema.parse('x'.repeat(80))).toHaveLength(80);
  });

  it('refuses blanks, one character and over 80', () => {
    expect(actingAsSchema.safeParse('   ').success).toBe(false);
    expect(actingAsSchema.safeParse(' J ').success).toBe(false);
    expect(actingAsSchema.safeParse('x'.repeat(81)).success).toBe(false);
    expect(actingAsSchema.safeParse(undefined).error?.issues[0]?.message).toBe(
      'Enter your name: who is acting for the account',
    );
  });

  it('is required on archive and delete bodies, with nothing else allowed', () => {
    expect(actingAsRequestSchema.safeParse({}).success).toBe(false);
    expect(actingAsRequestSchema.safeParse({ actingAs: 'Juan', extra: 1 }).success).toBe(false);
    expect(actingAsRequestSchema.parse({ actingAs: ' Juan ' })).toEqual({ actingAs: 'Juan' });
  });

  it('is required on every upload: new documents, new versions and task files', () => {
    const doc = {
      typeId: '0195f3c0-0000-7000-8000-0000000000e1',
      title: 'Resolution No. 1',
      academicYear: '2026-2027',
      uploadKey: UPLOAD_KEY,
    };
    expect(createDocumentRequestSchema.safeParse(doc).success).toBe(false);
    expect(createDocumentRequestSchema.safeParse({ ...doc, actingAs: 'Juan' }).success).toBe(true);
    expect(addVersionRequestSchema.safeParse({ uploadKey: UPLOAD_KEY }).success).toBe(false);
    expect(
      addVersionRequestSchema.safeParse({ uploadKey: UPLOAD_KEY, actingAs: 'Juan' }).success,
    ).toBe(true);
    const task = { uploadKey: UPLOAD_KEY, visibility: 'private' };
    expect(createTaskDocumentRequestSchema.safeParse(task).success).toBe(false);
    expect(createTaskDocumentRequestSchema.safeParse({ ...task, actingAs: 'Juan' }).success).toBe(
      true,
    );
  });
});
