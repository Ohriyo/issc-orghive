import type { PostCard, PostImage } from '@orghive/shared';
import { formatManilaDate } from '@/features/projects/presenters/project-format';

/** One post as cards, the carousel and the news list show it. */
export interface PostCardModel {
  id: string;
  href: string;
  type: PostCard['type'];
  title: string;
  summary: string;
  /** "Nov 5, 2026": the event's day when it has one, else the day it was posted (Manila). */
  date: string;
  /** Machine-readable date for <time>. */
  dateTime: string;
  cover: PostImage | null;
}

/** Where a post lives: /orgs/:slug/updates/:postSlug. */
export function postHref(orgSlug: string, postSlug: string): string {
  return `/orgs/${orgSlug}/updates/${postSlug}`;
}

export function toPostCard(orgSlug: string, post: PostCard): PostCardModel {
  const when = post.eventDate ?? post.publishedAt;
  return {
    id: post.id,
    href: postHref(orgSlug, post.slug),
    type: post.type,
    title: post.title,
    summary: post.summary,
    date: formatManilaDate(when),
    dateTime: post.eventDate ?? post.publishedAt,
    cover: post.cover,
  };
}

/** The responsive image widths a post cover is drawn at, for `sizes`. */
export const COVER_SIZES = {
  /** The carousel's image column: about half the card on desktop, the full card on phones. */
  carousel: '(width >= 64rem) 34rem, (width >= 48rem) 45vw, calc(100vw - 2rem)',
  /** The single post's cover, up to the reading column. */
  article: '(width >= 80rem) 65rem, calc(100vw - 2rem)',
  /** News list thumbnails. */
  thumb: '8rem',
  /** Gallery tiles: three across on desktop, two on phones. */
  gallery: '(width >= 48rem) 22rem, 50vw',
} as const;
