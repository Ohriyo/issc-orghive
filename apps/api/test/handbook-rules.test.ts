import { describe, expect, it } from 'vitest';
import { handbookFileRefusal, makeCurrentRefusal, uploadPlan } from '#src/services/handbook-rules';
import { managedKindOf, managedRefusal } from '#src/services/managed-document-rules';

describe('handbook rules', () => {
  it('starts an edition for a new year and adds a version to an existing one', () => {
    expect(uploadPlan(null)).toBe('new-edition');
    expect(uploadPlan({ academicYear: '2026-2027' })).toBe('new-version');
  });

  it('makes only a readable edition current', () => {
    expect(makeCurrentRefusal(null)).toMatch(/no edition/);
    expect(makeCurrentRefusal({ readable: false, isCurrent: false })).toMatch(/virus scan/);
    expect(makeCurrentRefusal({ readable: true, isCurrent: false })).toBeNull();
    expect(makeCurrentRefusal({ readable: true, isCurrent: true })).toBeNull();
  });

  it('takes PDFs only', () => {
    expect(handbookFileRefusal('application/pdf')).toBeNull();
    expect(handbookFileRefusal('image/png')).toMatch(/must be a PDF/);
  });
});

describe('managed document rules', () => {
  it('knows the constitution and the handbook, and nothing else', () => {
    expect(managedKindOf({ slug: 'constitution-by-laws' })).toBe('constitution');
    expect(managedKindOf({ slug: 'student-handbook' })).toBe('handbook');
    expect(managedKindOf({ slug: 'activity-proposal' })).toBeNull();
  });

  it('says where each one is managed instead', () => {
    expect(managedRefusal('handbook', 'file')).toBe(
      'typeId: Upload the Student Handbook from Admin › Student Handbook',
    );
    expect(managedRefusal('handbook', 'visibility')).toBe('The Student Handbook is always public');
    expect(managedRefusal('handbook', 'delete')).toMatch(/upload a corrected version instead/);
    expect(managedRefusal('constitution', 'edit')).toBe(
      'The Constitution & By-laws is amended from your organization profile',
    );
    expect(managedRefusal('constitution', 'archive')).toMatch(/upload an amendment instead/);
  });
});
