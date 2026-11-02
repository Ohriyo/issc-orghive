import type { IntegrityDocumentRecord } from '#src/repositories/integrity-select';

const PASSED = (['format', 'task_code', 'blank', 'exact_duplicate'] as const).map((kind) => ({
  kind,
  result: 'pass' as const,
  message: `${kind} passed`,
}));

/**
 * A task's file as the integrity select reads it: available, shared with the governing
 * bodies, and verified (every hard check passed, no warnings), unless overridden.
 */
export function verifiedDoc(
  patch: Partial<Omit<IntegrityDocumentRecord, 'currentVersion'>> & {
    integrity?: Partial<
      NonNullable<NonNullable<IntegrityDocumentRecord['currentVersion']>['integrity']>
    >;
    checks?: NonNullable<IntegrityDocumentRecord['currentVersion']>['checks'];
  } = {},
): IntegrityDocumentRecord {
  const { integrity, checks = PASSED, ...doc } = patch;
  return {
    status: 'available',
    deletedAt: null,
    visibility: 'governing',
    currentVersionId: 'version-1',
    currentVersion: {
      scanStatus: 'clean',
      checks,
      integrity: {
        legacy: false,
        checkedAt: new Date('2026-10-05T02:00:00Z'),
        warningsClearedAt: null,
        flaggedAt: null,
        flagReason: null,
        replacesFlagged: false,
        ...integrity,
      },
    },
    versions: [{ id: 'version-1', scanStatus: 'clean', failureReason: null }],
    ...doc,
  };
}
