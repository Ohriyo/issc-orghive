import { describe, expect, it } from 'vitest';
import type { ManagedPost, PostCard, PostDetail, PostListResponse } from '@orghive/shared';
import { toRow } from './use-manage-posts';
import { toOrgPost } from './use-org-post';
import { filtersOf, toOrgUpdates } from './use-org-updates';
import { bodyOf, fromManilaLocal, toManilaLocal, type PostFormValues } from './use-post-editor';
import { toPostCard } from './post-format';
import { toPostSections } from './use-org-post-sections';

const card: PostCard = {
  id: '0190a6b0-0000-7000-8000-000000000001',
  slug: 'it-days-2026',
  type: 'HIGHLIGHT',
  title: 'IT Days 2026',
  summary: 'Two days.',
  eventDate: null,
  publishedAt: '2026-11-05T10:00:00.000Z',
  cover: null,
  externalLink: null,
};

describe('post cards', () => {
  it('links to the post and prefers the event day', () => {
    expect(toPostCard('asit', card)).toMatchObject({
      href: '/orgs/asit/updates/it-days-2026',
      date: 'Nov 5, 2026',
    });
    expect(toPostCard('asit', { ...card, eventDate: '2026-10-30' }).date).toBe('Oct 30, 2026');
  });

  it('shapes the page sections', () => {
    const sections = toPostSections('asit', {
      organization: {} as never,
      highlights: [card],
      updates: [],
      updatesTotal: 0,
      viewer: { isOwner: true, canModerate: false },
    });
    expect(sections).toMatchObject({
      highlightsHref: '/orgs/asit/updates?type=highlight',
      updatesHref: '/orgs/asit/updates',
      isOwner: true,
    });
  });
});

describe('the updates list', () => {
  it('reads only valid filters from the address', () => {
    expect(filtersOf(new URLSearchParams('type=highlight&year=2026&page=2'))).toEqual({
      type: 'highlight',
      year: '2026',
      page: 2,
    });
    expect(filtersOf(new URLSearchParams('type=news&year=26&page=-1'))).toEqual({
      type: 'all',
      year: undefined,
      page: 1,
    });
  });

  it('builds the filter links, the summary and the pages', () => {
    const data: PostListResponse = { items: [card], page: 2, pageSize: 10, total: 21, years: [2026, 2025] };
    const model = toOrgUpdates('asit', { type: 'highlight', year: '2026', page: 2 }, data);
    expect(model.summary).toBe('21 highlights in 2026');
    expect(model.types.find((t) => t.current)?.label).toBe('Highlights');
    expect(model.types[0]!.href).toBe('/orgs/asit/updates?year=2026');
    expect(model.years.map((y) => y.label)).toEqual(['All years', '2026', '2025']);
    expect(model.newer).toBe('/orgs/asit/updates?type=highlight&year=2026');
    expect(model.older).toBe('/orgs/asit/updates?type=highlight&year=2026&page=3');
    expect(model.pages).toBe(3);
  });
});

describe('one post', () => {
  const detail: PostDetail = {
    ...card,
    status: 'PUBLISHED',
    bodyHtml: '<p>Hi</p>',
    gallery: [],
    editedAt: null,
    previous: { slug: 'older', title: 'Older post' },
    next: null,
    organization: { slug: 'asit', acronym: 'ASIT', name: 'Allied', logoUrl: null },
    moderation: null,
    viewer: { isOwner: false, canModerate: true },
  };

  it('shapes the public view', () => {
    const post = toOrgPost(detail);
    expect(post).toMatchObject({
      kind: 'Highlight',
      posted: 'Posted Nov 5, 2026',
      previous: { href: '/orgs/asit/updates/older' },
      ownerNotice: null,
      editHref: null,
      canModerate: true,
    });
    expect(post.seo.title).toBe('IT Days 2026 · ASIT | Orghive');
  });

  it('tells the own account why nobody else sees it', () => {
    const owner = { isOwner: true, canModerate: false };
    expect(toOrgPost({ ...detail, status: 'DRAFT', viewer: owner }).ownerNotice?.text).toMatch(/Draft/);
    const hidden = toOrgPost({
      ...detail,
      status: 'HIDDEN',
      viewer: owner,
      moderation: { hiddenAt: '2026-11-06T01:00:00.000Z', reason: 'Wrong photos' },
    });
    expect(hidden.ownerNotice).toMatchObject({ tone: 'warning' });
    expect(hidden.ownerNotice?.text).toContain('Wrong photos');
    expect(hidden.editHref).toBe(`/dashboard/posts/${card.id}`);
  });
});

describe('the dashboard', () => {
  const managed: ManagedPost = {
    id: card.id,
    slug: card.slug,
    type: 'UPDATE',
    status: 'SCHEDULED',
    title: 'Fee deadline',
    summary: 'New date',
    body: '',
    cover: null,
    gallery: [],
    externalLink: null,
    eventDate: null,
    publishAt: '2026-11-08T01:00:00.000Z',
    publishedAt: null,
    pinned: false,
    pinOrder: null,
    moderation: null,
    actingAs: 'Maria',
    updatedAt: '2026-11-06T01:00:00.000Z',
  };

  it('says what state each post is in and what can be done', () => {
    expect(toRow('asit', managed)).toMatchObject({
      statusLabel: 'Scheduled',
      detail: 'Goes live Nov 8, 2026',
      canPublish: false,
      canUnpublish: true,
    });
    const hidden = toRow('asit', {
      ...managed,
      status: 'HIDDEN',
      moderation: { hiddenAt: managed.updatedAt, reason: 'Wrong photos' },
    });
    expect(hidden.detail).toContain('Wrong photos');
    expect(hidden.canPublish).toBe(true);
  });

  it('converts Manila wall-clock times both ways', () => {
    expect(fromManilaLocal('2026-11-08T09:00')).toBe('2026-11-08T09:00:00+08:00');
    expect(fromManilaLocal('')).toBeNull();
    expect(toManilaLocal('2026-11-08T01:00:00.000Z')).toBe('2026-11-08T09:00');
  });

  it('sends blank optional fields as null', () => {
    const values: PostFormValues = {
      type: 'HIGHLIGHT',
      title: 'T',
      summary: 'S',
      body: '',
      eventDate: '',
      externalLink: ' ',
      cover: { key: 'k', widths: [480], url: 'https://x', alt: 'A' },
      gallery: [],
      publishAt: '',
      actingAs: 'Maria',
    };
    expect(bodyOf(values)).toMatchObject({
      eventDate: null,
      externalLink: null,
      cover: { key: 'k', widths: [480], alt: 'A' },
    });
  });
});
