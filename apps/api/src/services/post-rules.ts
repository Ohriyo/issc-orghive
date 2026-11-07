import { PINNED_HIGHLIGHTS_MAX, type OrgPostStatus, type OrgPostType } from '@orghive/shared';
import {
  decisionAuthority,
  type AppellantOrg,
  type DecisionAuthority,
  type DeciderOrg,
} from '#src/services/appeal-rules';

/*
 * Organization posts (docs/DOMAIN_RULES.md, "Organization posts"). The only place these rules
 * live; services and repositories call them, never re-implement them.
 * - Publishing needs no approval: a post goes live at once, or at publishAt (scheduled).
 * - A governing body may hide a live post with a reason: the same account that decides the
 *   organization's appeals (appeal-rules.ts), so the ISSC steps in for a vacant CSC seat and
 *   nobody hides the ISSC's posts. The organization may edit it and publish it again.
 * - Up to PINNED_HIGHLIGHTS_MAX live highlights are pinned to the carousel, in order.
 */

export interface PostState {
  type: OrgPostType;
  status: OrgPostStatus;
  publishAt: Date | null;
}

/** Live for everyone: published, or scheduled and its time has come (the worker may lag). */
export function isLive(post: Pick<PostState, 'status' | 'publishAt'>, now: Date): boolean {
  if (post.status === 'PUBLISHED') return true;
  return post.status === 'SCHEDULED' && post.publishAt !== null && post.publishAt <= now;
}

export type PostRuleError =
  | 'SCHEDULE_IN_PAST'
  | 'ALREADY_PUBLISHED'
  | 'NOT_PUBLISHED'
  | 'NOT_LIVE'
  | 'NOT_A_HIGHLIGHT'
  | 'TOO_MANY_PINNED'
  | 'UNKNOWN_POST';

export class PostRuleViolation extends Error {
  constructor(readonly code: PostRuleError) {
    super(code);
  }
}

/**
 * Where a save or a publish leaves the post. `draft` keeps it a draft; `publish` makes it
 * live now; `schedule` (or a future publishAt) waits for publishAt. A live post cannot be
 * scheduled again (unpublish it first); a hidden one may be published again.
 */
export function statusAfterPublish(
  current: OrgPostStatus | null,
  publishAt: Date | null,
  now: Date,
): { status: 'PUBLISHED' | 'SCHEDULED'; publishAt: Date | null } {
  if (current === 'PUBLISHED') throw new PostRuleViolation('ALREADY_PUBLISHED');
  if (publishAt === null) return { status: 'PUBLISHED', publishAt: null };
  if (publishAt <= now) throw new PostRuleViolation('SCHEDULE_IN_PAST');
  return { status: 'SCHEDULED', publishAt };
}

/** Unpublishing takes a published or scheduled post back to a draft. */
export function assertCanUnpublish(status: OrgPostStatus): void {
  if (status !== 'PUBLISHED' && status !== 'SCHEDULED') {
    throw new PostRuleViolation('NOT_PUBLISHED');
  }
}

/** Only what everyone can see can be hidden. */
export function assertCanHide(post: Pick<PostState, 'status' | 'publishAt'>, now: Date): void {
  if (!isLive(post, now)) throw new PostRuleViolation('NOT_LIVE');
}

/**
 * Whether the actor's account may hide `owner`'s posts, and on what authority: the
 * organization's appeal decider ('seat'), or the ISSC while that seat is vacant
 * ('admin_override', audited). Null: it may not. The ISSC's posts have no decider.
 */
export function moderationAuthority(
  owner: AppellantOrg,
  actor: DeciderOrg | null,
  deciderVacant: boolean,
): DecisionAuthority | null {
  return decisionAuthority(owner, actor, deciderVacant);
}

/** Pins a post may hold: live highlights (and scheduled ones, which go live on their own). */
export function canBePinned(post: PostState): boolean {
  return post.type === 'HIGHLIGHT' && (post.status === 'PUBLISHED' || post.status === 'SCHEDULED');
}

/**
 * The carousel order for a pin request: each id must be one of the organization's
 * pinnable highlights. Returns each pinned id with its place, 1 first.
 */
export function planPins(
  requested: readonly string[],
  posts: ReadonlyMap<string, PostState>,
): { id: string; pinOrder: number }[] {
  if (requested.length > PINNED_HIGHLIGHTS_MAX) throw new PostRuleViolation('TOO_MANY_PINNED');
  return requested.map((id, index) => {
    const post = posts.get(id);
    if (!post) throw new PostRuleViolation('UNKNOWN_POST');
    if (!canBePinned(post)) throw new PostRuleViolation('NOT_A_HIGHLIGHT');
    return { id, pinOrder: index + 1 };
  });
}

/** Whether a post keeps its pin after changing to `status` (drafts and hidden posts lose it). */
export function keepsPin(type: OrgPostType, status: OrgPostStatus): boolean {
  return canBePinned({ type, status, publishAt: null });
}

/**
 * A slug unique within the organization: `base`, else `base-2`, `base-3`… `taken` holds the
 * organization's slugs that start with `base` (deleted posts included, so old links never
 * point at a different post).
 */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
