import { describe, expect, it } from 'vitest';
import {
  handbookFileRefusal,
  makeCurrentRefusal,
  readersCurrentYear,
  retryPreviewRefusal,
  uploadPlan,
} from '#src/services/handbook-rules';
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

  it('shows readers the marked edition, else the most recently uploaded readable one', () => {
    const at = (iso: string) => new Date(iso);
    const past = { academicYear: '2025-2026', isCurrent: false, createdAt: at('2025-08-01') };
    const marked = { academicYear: '2026-2027', isCurrent: true, createdAt: at('2026-07-01') };
    const later = { academicYear: '2027-2028', isCurrent: false, createdAt: at('2026-09-01') };
    expect(readersCurrentYear([later, marked, past])).toBe('2026-2027');
    expect(readersCurrentYear([later, past])).toBe('2027-2028');
    // Uploaded the same moment: the later academic year.
    expect(readersCurrentYear([past, { ...later, createdAt: past.createdAt }])).toBe('2027-2028');
    expect(readersCurrentYear([])).toBeNull();
  });

  it('renders pages again only after they failed', () => {
    expect(retryPreviewRefusal(null)).toMatch(/no edition/);
    expect(retryPreviewRefusal({ scanStatus: 'pending', previewStatus: 'pending' })).toMatch(/virus scan/);
    expect(retryPreviewRefusal({ scanStatus: 'clean', previewStatus: 'pending' })).toMatch(/already being prepared/);
    expect(retryPreviewRefusal({ scanStatus: 'clean', previewStatus: 'ready' })).toMatch(/already ready/);
    expect(retryPreviewRefusal({ scanStatus: 'clean', previewStatus: 'failed' })).toBeNull();
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
