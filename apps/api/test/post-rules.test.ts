import { describe, expect, it } from 'vitest';
import {
  assertCanHide,
  assertCanUnpublish,
  canBePinned,
  isLive,
  keepsPin,
  moderationAuthority,
  planPins,
  PostRuleViolation,
  statusAfterPublish,
  uniqueSlug,
  type PostState,
} from '#src/services/post-rules';

const now = new Date('2026-11-06T04:00:00Z');
const later = new Date('2026-11-07T04:00:00Z');
const earlier = new Date('2026-11-05T04:00:00Z');

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof PostRuleViolation ? err.code : 'other';
  }
  return null;
};

describe('isLive', () => {
  it('is live when published, or scheduled and due', () => {
    expect(isLive({ status: 'PUBLISHED', publishAt: null }, now)).toBe(true);
    expect(isLive({ status: 'SCHEDULED', publishAt: earlier }, now)).toBe(true);
    expect(isLive({ status: 'SCHEDULED', publishAt: later }, now)).toBe(false);
    expect(isLive({ status: 'DRAFT', publishAt: null }, now)).toBe(false);
    expect(isLive({ status: 'HIDDEN', publishAt: null }, now)).toBe(false);
  });
});

describe('statusAfterPublish', () => {
  it('publishes now or schedules for later', () => {
    expect(statusAfterPublish('DRAFT', null, now)).toEqual({ status: 'PUBLISHED', publishAt: null });
    expect(statusAfterPublish(null, later, now)).toEqual({ status: 'SCHEDULED', publishAt: later });
    expect(statusAfterPublish('HIDDEN', null, now).status).toBe('PUBLISHED');
    expect(statusAfterPublish('SCHEDULED', null, now).status).toBe('PUBLISHED');
  });

  it('refuses a time in the past and a post that is already live', () => {
    expect(code(() => statusAfterPublish('DRAFT', earlier, now))).toBe('SCHEDULE_IN_PAST');
    expect(code(() => statusAfterPublish('DRAFT', now, now))).toBe('SCHEDULE_IN_PAST');
    expect(code(() => statusAfterPublish('PUBLISHED', null, now))).toBe('ALREADY_PUBLISHED');
  });
});

describe('assertCanUnpublish and assertCanHide', () => {
  it('unpublishes only published or scheduled posts', () => {
    expect(code(() => assertCanUnpublish('PUBLISHED'))).toBeNull();
    expect(code(() => assertCanUnpublish('SCHEDULED'))).toBeNull();
    expect(code(() => assertCanUnpublish('DRAFT'))).toBe('NOT_PUBLISHED');
    expect(code(() => assertCanUnpublish('HIDDEN'))).toBe('NOT_PUBLISHED');
  });

  it('hides only what everyone can see', () => {
    expect(code(() => assertCanHide({ status: 'PUBLISHED', publishAt: null }, now))).toBeNull();
    expect(code(() => assertCanHide({ status: 'SCHEDULED', publishAt: later }, now))).toBe(
      'NOT_LIVE',
    );
    expect(code(() => assertCanHide({ status: 'HIDDEN', publishAt: null }, now))).toBe('NOT_LIVE');
  });
});

describe('moderationAuthority', () => {
  const sbo = { id: 'sbo', type: 'SBO' as const, parentId: 'csc' };
  const csc = { id: 'csc', type: 'CSC' as const, parentId: 'issc' };
  const issc = { id: 'issc', type: 'ISSC' as const, parentId: null };

  it('is the organization appeal decider', () => {
    expect(moderationAuthority(sbo, { id: 'csc', type: 'CSC' }, false)).toBe('seat');
    expect(moderationAuthority(csc, { id: 'issc', type: 'ISSC' }, false)).toBe('seat');
    expect(moderationAuthority(sbo, { id: 'issc', type: 'ISSC' }, false)).toBeNull();
    expect(moderationAuthority(sbo, { id: 'other', type: 'CSC' }, false)).toBeNull();
    expect(moderationAuthority(sbo, null, false)).toBeNull();
  });

  it('lets the ISSC step in for a vacant CSC seat, and nobody hides ISSC posts', () => {
    expect(moderationAuthority(sbo, { id: 'issc', type: 'ISSC' }, true)).toBe('admin_override');
    expect(moderationAuthority(issc, { id: 'issc', type: 'ISSC' }, true)).toBeNull();
  });
});

describe('pins', () => {
  const highlight = (status: PostState['status']): PostState => ({
    type: 'HIGHLIGHT',
    status,
    publishAt: null,
  });

  it('pins live and scheduled highlights only', () => {
    expect(canBePinned(highlight('PUBLISHED'))).toBe(true);
    expect(canBePinned(highlight('SCHEDULED'))).toBe(true);
    expect(canBePinned(highlight('DRAFT'))).toBe(false);
    expect(canBePinned({ type: 'UPDATE', status: 'PUBLISHED', publishAt: null })).toBe(false);
    expect(keepsPin('HIGHLIGHT', 'HIDDEN')).toBe(false);
    expect(keepsPin('HIGHLIGHT', 'PUBLISHED')).toBe(true);
  });

  it('numbers the requested order from 1', () => {
    const posts = new Map([
      ['a', highlight('PUBLISHED')],
      ['b', highlight('SCHEDULED')],
    ]);
    expect(planPins(['b', 'a'], posts)).toEqual([
      { id: 'b', pinOrder: 1 },
      { id: 'a', pinOrder: 2 },
    ]);
    expect(planPins([], posts)).toEqual([]);
  });

  it('refuses unknown posts, drafts, updates and more than six', () => {
    const posts = new Map<string, PostState>([
      ['draft', highlight('DRAFT')],
      ['update', { type: 'UPDATE', status: 'PUBLISHED', publishAt: null }],
    ]);
    expect(code(() => planPins(['nope'], posts))).toBe('UNKNOWN_POST');
    expect(code(() => planPins(['draft'], posts))).toBe('NOT_A_HIGHLIGHT');
    expect(code(() => planPins(['update'], posts))).toBe('NOT_A_HIGHLIGHT');
    expect(code(() => planPins(['1', '2', '3', '4', '5', '6', '7'], posts))).toBe(
      'TOO_MANY_PINNED',
    );
  });
});

describe('uniqueSlug', () => {
  it('adds the first free number', () => {
    expect(uniqueSlug('it-days', new Set())).toBe('it-days');
    expect(uniqueSlug('it-days', new Set(['it-days', 'it-days-2']))).toBe('it-days-3');
  });
});
