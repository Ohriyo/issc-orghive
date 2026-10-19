import { describe, expect, it } from 'vitest';
import { addDays, manilaDate } from './manila-time';
import {
  createProjectRequestSchema,
  taskUploadUrlRequestSchema,
  updateProjectRequestSchema,
} from './project';

const today = manilaDate(new Date());
const valid = {
  name: 'Inter-Year Bridge Design Competition',
  targetDate: addDays(today, 30),
  location: 'CEA Building, NwSSU Main Campus',
  beneficiaries: 'Civil engineering students',
  description: 'A truss bridge design and load-testing competition.',
};

describe('createProjectRequestSchema', () => {
  it('accepts the five fields and defaults NOM/MOM to not needed', () => {
    expect(createProjectRequestSchema.parse(valid)).toMatchObject({
      nomRequired: false,
      momRequired: false,
    });
  });

  it('requires every one of the five fields', () => {
    for (const field of Object.keys(valid)) {
      const { [field as keyof typeof valid]: _, ...missing } = valid;
      expect(createProjectRequestSchema.safeParse(missing).success, field).toBe(false);
      expect(
        createProjectRequestSchema.safeParse({ ...valid, [field]: '   ' }).success,
        `${field} blank`,
      ).toBe(false);
    }
  });

  it('refuses a target date in the past, and allows today', () => {
    expect(
      createProjectRequestSchema.safeParse({ ...valid, targetDate: addDays(today, -1) }).success,
    ).toBe(false);
    expect(createProjectRequestSchema.safeParse({ ...valid, targetDate: today }).success).toBe(
      true,
    );
    expect(
      createProjectRequestSchema.safeParse({ ...valid, targetDate: '2026-13-01' }).success,
    ).toBe(false);
  });

  it('refuses server-owned fields', () => {
    expect(createProjectRequestSchema.safeParse({ ...valid, status: 'completed' }).success).toBe(
      false,
    );
  });
});

describe('updateProjectRequestSchema', () => {
  it('needs at least one field', () => {
    expect(updateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(updateProjectRequestSchema.safeParse({ momRequired: true }).success).toBe(true);
  });
});

describe('taskUploadUrlRequestSchema', () => {
  it('allows PDF and images only', () => {
    const file = (filename: string, contentType: string) =>
      taskUploadUrlRequestSchema.safeParse({ filename, contentType, sizeBytes: 1000 }).success;
    expect(file('proposal.pdf', 'application/pdf')).toBe(true);
    expect(file('scan.jpg', 'image/jpeg')).toBe(true);
    expect(
      file(
        'proposal.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(false);
  });
});
