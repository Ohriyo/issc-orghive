import type { TaskFileIntegrity, TaskFileIntegrityState } from '@orghive/shared';

/** How a task file's checks read: drives the line's color and icon, never color alone. */
export type IntegrityTone = 'pending' | 'ok' | 'warn' | 'bad';

/** A task file's integrity checks (spec section 6), as the checklist shows them. */
export interface IntegrityStatus {
  state: TaskFileIntegrityState;
  /** "Verified ✓", "Needs attention", … */
  label: string;
  tone: IntegrityTone;
  /** Why it was refused, its warnings, or the flag's reason. */
  reasons: string[];
  /** What to do about it; null when nothing is needed. */
  advice: string | null;
  /** The organization should upload the file again (on the template). */
  reupload: boolean;
}

const STATUS: Record<TaskFileIntegrityState, Omit<IntegrityStatus, 'state' | 'reasons'>> = {
  checking: {
    label: 'Checking the file…',
    tone: 'pending',
    advice: 'The virus scan, then its QR code, pages and text. This takes a minute or two.',
    reupload: false,
  },
  refused: {
    label: 'Refused',
    tone: 'bad',
    advice: 'The task keeps its earlier file. Fix this and upload it again.',
    reupload: true,
  },
  verified: { label: 'Verified ✓', tone: 'ok', advice: null, reupload: false },
  needs_attention: {
    label: 'Needs attention',
    tone: 'warn',
    advice:
      'It completes the task, but counts for the leaderboard only once you upload a corrected file or your governing body clears the warning.',
    reupload: true,
  },
  flagged_invalid: {
    label: 'Flagged invalid',
    tone: 'bad',
    advice: 'It does not count for the leaderboard until you upload a corrected file.',
    reupload: true,
  },
  legacy: {
    label: 'Legacy, unverified',
    tone: 'warn',
    advice:
      'It completes the task, but counts for the leaderboard only once it is uploaded again on this task’s template.',
    reupload: true,
  },
};

/**
 * `forOwner`: the advice speaks to the organization ("upload a corrected file"), so its
 * governing bodies see the state and reasons only.
 */
export function integrityStatus(
  integrity: TaskFileIntegrity | null,
  forOwner = true,
): IntegrityStatus | null {
  if (!integrity) return null;
  const status = STATUS[integrity.state];
  return {
    state: integrity.state,
    reasons: integrity.reasons,
    ...status,
    advice: forOwner ? status.advice : null,
  };
}
