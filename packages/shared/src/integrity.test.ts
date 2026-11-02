import { describe, expect, it } from 'vitest';
import {
  countsForRanking,
  flagTaskFileRequestSchema,
  isCheckedTask,
  isHardCheck,
  isTaskCode,
  normalizeTaskCode,
  taskCodeSchema,
  taskKeywordsSchema,
  DEFAULT_TASK_KEYWORDS,
} from './integrity';
import {
  taskDocumentRequestSchemaFor,
  taskUploadAcceptFor,
  taskUploadUrlRequestSchemaFor,
} from './project';

describe('task codes', () => {
  it('accepts the printed form and each task suffix', () => {
    expect(isTaskCode('OH-7K3P-ACR')).toBe(true);
    expect(isTaskCode('OH-0000-PROP')).toBe(true);
    expect(isTaskCode('OH-ZZZZ-FR')).toBe(true);
  });

  it('refuses unknown suffixes, wrong lengths and misread letters', () => {
    expect(isTaskCode('OH-7K3P-XYZ')).toBe(false);
    expect(isTaskCode('OH-7K3-ACR')).toBe(false);
    expect(isTaskCode('OH-7K3PQ-ACR')).toBe(false);
    expect(isTaskCode('OH-7KUP-ACR')).toBe(false);
  });

  it('reads typed codes the way people type them', () => {
    expect(normalizeTaskCode(' oh 7k3p acr ')).toBe('OH-7K3P-ACR');
    expect(normalizeTaskCode('OH7K3PACR')).toBe('OH-7K3P-ACR');
    // O, I and L in the random part are the digits they look like.
    expect(normalizeTaskCode('oh-OIL3-nom')).toBe('OH-0113-NOM');
    // The suffix keeps its letters.
    expect(normalizeTaskCode('OH-7K3P-PROP')).toBe('OH-7K3P-PROP');
  });

  it('validates the typed code at upload', () => {
    expect(taskCodeSchema.parse('oh-7k3p-acr')).toBe('OH-7K3P-ACR');
    expect(taskCodeSchema.safeParse('ACR-7K3P').success).toBe(false);
  });
});

describe('checked tasks', () => {
  it('checks every task but the optional other pre-event documents', () => {
    expect(isCheckedTask('PROPOSAL')).toBe(true);
    expect(isCheckedTask('COMMUNICATION_LETTER')).toBe(true);
    expect(isCheckedTask('OTHER_PRE_EVENT')).toBe(false);
  });

  it('takes a PDF only for checked tasks', () => {
    const pdf = { filename: 'acr.pdf', contentType: 'application/pdf', sizeBytes: 1000 };
    const jpg = { filename: 'acr.jpg', contentType: 'image/jpeg', sizeBytes: 1000 };
    expect(taskUploadUrlRequestSchemaFor('ACR').safeParse(pdf).success).toBe(true);
    expect(taskUploadUrlRequestSchemaFor('ACR').safeParse(jpg).success).toBe(false);
    expect(taskUploadUrlRequestSchemaFor('OTHER_PRE_EVENT').safeParse(jpg).success).toBe(true);
    expect(taskUploadAcceptFor('ACR')).toBe('.pdf');
    expect(taskUploadAcceptFor('OTHER_PRE_EVENT')).toContain('.jpg');
  });

  it('carries a typed code with a task file', () => {
    const body = {
      uploadKey:
        'uploads/00000000-0000-7000-8000-000000000001/00000000-0000-7000-8000-000000000002',
      visibility: 'governing',
      actingAs: 'Juan Dela Cruz',
      taskCode: 'oh 7k3p acr',
    };
    const parsed = taskDocumentRequestSchemaFor('ACR').safeParse(body);
    expect(parsed.success && parsed.data.taskCode).toBe('OH-7K3P-ACR');
  });
});

describe('integrity rules shared by both apps', () => {
  it('has four hard checks; the rest only warn', () => {
    expect(
      ['format', 'task_code', 'blank', 'exact_duplicate'].every((k) => isHardCheck(k as never)),
    ).toBe(true);
    expect(isHardCheck('near_duplicate')).toBe(false);
    expect(isHardCheck('keywords')).toBe(false);
    expect(isHardCheck('financial_totals')).toBe(false);
  });

  it('counts public and governing files only', () => {
    expect(countsForRanking('public')).toBe(true);
    expect(countsForRanking('governing')).toBe(true);
    expect(countsForRanking('private')).toBe(false);
  });

  it('accepts the default keywords as a setting', () => {
    expect(taskKeywordsSchema.safeParse(DEFAULT_TASK_KEYWORDS).success).toBe(true);
  });

  it('needs a reason and the acting officer to flag a file', () => {
    expect(flagTaskFileRequestSchema.safeParse({ reason: 'x', actingAs: 'A B' }).success).toBe(
      false,
    );
    expect(
      flagTaskFileRequestSchema.safeParse({
        reason: 'Signatures do not match the officers on file',
        actingAs: 'Juan Dela Cruz',
      }).success,
    ).toBe(true);
  });
});
