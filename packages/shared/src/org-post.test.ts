import { describe, expect, it } from 'vitest';
import {
  createPostRequestSchema,
  hidePostRequestSchema,
  pinHighlightsRequestSchema,
  postImageSlugOf,
  postListQuerySchema,
  postSlugFromTitle,
  PINNED_HIGHLIGHTS_MAX,
  POST_GALLERY_MAX,
  POST_SUMMARY_MAX,
  POST_TITLE_MAX,
} from './org-post';

const KEY = `logos/posts/asit/${'a'.repeat(24)}-${'b'.repeat(12)}.webp`;
const base = {
  type: 'HIGHLIGHT',
  title: 'IT Days 2026',
  summary: 'Two days of games and talks.',
  actingAs: 'Maria Santos',
  action: 'publish',
} as const;

describe('createPostRequestSchema', () => {
  it('fills the optional fields', () => {
    expect(createPostRequestSchema.parse(base)).toMatchObject({
      body: '',
      cover: null,
      gallery: [],
      externalLink: null,
      eventDate: null,
      publishAt: null,
    });
  });

  it('limits the title and summary', () => {
    expect(
      createPostRequestSchema.safeParse({ ...base, title: 'x'.repeat(POST_TITLE_MAX + 1) }).success,
    ).toBe(false);
    expect(
      createPostRequestSchema.safeParse({ ...base, summary: 'x'.repeat(POST_SUMMARY_MAX + 1) })
        .success,
    ).toBe(false);
  });

  it('needs a time to schedule', () => {
    const result = createPostRequestSchema.safeParse({ ...base, action: 'schedule' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['publishAt']);
    expect(
      createPostRequestSchema.safeParse({
        ...base,
        action: 'schedule',
        publishAt: '2026-12-01T09:00:00+08:00',
      }).success,
    ).toBe(true);
  });

  it('requires alt text on every image and caps the gallery', () => {
    const image = { key: KEY, widths: [480, 960], alt: 'Students at the court' };
    expect(createPostRequestSchema.safeParse({ ...base, cover: image }).success).toBe(true);
    expect(createPostRequestSchema.safeParse({ ...base, cover: { ...image, alt: ' ' } }).success).toBe(
      false,
    );
    expect(
      createPostRequestSchema.safeParse({
        ...base,
        gallery: Array.from({ length: POST_GALLERY_MAX + 1 }, () => image),
      }).success,
    ).toBe(false);
  });

  it('refuses keys outside the post image prefix and odd widths', () => {
    const image = { key: 'logos/jpice-abc.webp', widths: [], alt: 'Logo' };
    expect(createPostRequestSchema.safeParse({ ...base, cover: image }).success).toBe(false);
    expect(
      createPostRequestSchema.safeParse({ ...base, cover: { key: KEY, widths: [500], alt: 'x' } })
        .success,
    ).toBe(false);
  });

  it('takes only https external links', () => {
    expect(
      createPostRequestSchema.safeParse({ ...base, externalLink: 'http://example.com' }).success,
    ).toBe(false);
    expect(
      createPostRequestSchema.safeParse({ ...base, externalLink: 'https://example.com/a' }).success,
    ).toBe(true);
  });
});

describe('pinHighlightsRequestSchema', () => {
  const id = (n: number) => `0190a6b0-0000-7000-8000-${String(n).padStart(12, '0')}`;

  it('takes up to the maximum, each once', () => {
    const ids = Array.from({ length: PINNED_HIGHLIGHTS_MAX }, (_, i) => id(i));
    expect(pinHighlightsRequestSchema.safeParse({ actingAs: 'Ana', postIds: ids }).success).toBe(
      true,
    );
    expect(
      pinHighlightsRequestSchema.safeParse({ actingAs: 'Ana', postIds: [...ids, id(99)] }).success,
    ).toBe(false);
    expect(
      pinHighlightsRequestSchema.safeParse({ actingAs: 'Ana', postIds: [id(1), id(1)] }).success,
    ).toBe(false);
  });
});

describe('hidePostRequestSchema', () => {
  it('needs a reason', () => {
    expect(hidePostRequestSchema.safeParse({ actingAs: 'Ana', reason: 'no' }).success).toBe(false);
    expect(
      hidePostRequestSchema.safeParse({ actingAs: 'Ana', reason: 'Shares a student phone number' })
        .success,
    ).toBe(true);
  });
});

describe('postListQuerySchema', () => {
  it('maps the type filter and defaults the page', () => {
    expect(postListQuerySchema.parse({ type: 'highlight', year: '2026' })).toEqual({
      type: 'HIGHLIGHT',
      year: 2026,
      page: 1,
    });
    expect(postListQuerySchema.safeParse({ type: 'news' }).success).toBe(false);
  });
});

describe('postSlugFromTitle', () => {
  it('makes lowercase hyphenated words', () => {
    expect(postSlugFromTitle('IT Days 2026: Enter the System!')).toBe(
      'it-days-2026-enter-the-system',
    );
    expect(postSlugFromTitle('Ñandú café')).toBe('nandu-cafe');
  });

  it('cuts long titles at a word and falls back to "post"', () => {
    const slug = postSlugFromTitle('word '.repeat(30));
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(postSlugFromTitle('!!!')).toBe('post');
  });
});

describe('postImageSlugOf', () => {
  it('reads the organization from a post image key', () => {
    expect(postImageSlugOf(KEY)).toBe('asit');
    expect(postImageSlugOf('logos/covers/asit-abc.webp')).toBeNull();
  });
});
