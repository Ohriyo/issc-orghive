import { describe, expect, it } from 'vitest';
import type { ConstitutionResponse } from '@orghive/shared';
import {
  constitutionDateLine,
  formatCalendarDate,
  toConstitutionEntries,
} from './use-constitution';

type Constitution = NonNullable<ConstitutionResponse['constitution']>;
type Version = Constitution['versions'][number];

const version = (n: number, overrides: Partial<Version> = {}): Version => ({
  id: `0195f3c0-0000-7000-8000-00000000000${n}`,
  version: n,
  amendedOn: n === 1 ? '2025-08-04' : '2026-09-15',
  note: n === 1 ? null : 'Article III amended.',
  isCurrent: n === 2,
  uploadedAt: '2026-09-16T00:00:00.000Z',
  scanStatus: 'clean',
  previewStatus: 'ready',
  actingAs: null,
  ...overrides,
});

const CONSTITUTION: Constitution = {
  documentId: '0195f3c0-0000-7000-8000-0000000000d1',
  lastAmendedOn: '2026-09-15',
  versions: [version(2), version(1)],
};

describe('constitution shaping', () => {
  it('formats a Manila calendar date without shifting the day', () => {
    expect(formatCalendarDate('2026-09-15')).toBe('September 15, 2026');
  });

  it('says "Last amended" once amended, "Adopted" while it has one version', () => {
    expect(constitutionDateLine(CONSTITUTION)).toBe('Last amended September 15, 2026');
    expect(
      constitutionDateLine({
        ...CONSTITUTION,
        lastAmendedOn: '2025-08-04',
        versions: [version(1, { isCurrent: true })],
      }),
    ).toBe('Adopted August 4, 2025');
  });

  it('links older versions with ?version= and labels each one', () => {
    const [current, first] = toConstitutionEntries(CONSTITUTION);
    expect(current).toMatchObject({
      label: 'Amended September 15, 2026',
      href: `/documents/${CONSTITUTION.documentId}`,
    });
    expect(first).toMatchObject({
      label: 'Adopted August 4, 2025',
      href: `/documents/${CONSTITUTION.documentId}?version=${first!.id}`,
      state: 'ready',
    });
    const pending = toConstitutionEntries({
      ...CONSTITUTION,
      versions: [version(3, { scanStatus: 'pending' })],
    });
    expect(pending[0]?.state).toBe('scanning');
  });
});
