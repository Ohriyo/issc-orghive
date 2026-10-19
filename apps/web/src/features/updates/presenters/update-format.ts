import { paragraphsOf, type Announcement } from '@orghive/shared';
import { formatManilaDate } from '@/features/projects/presenters/project-format';

/** How much of the first paragraph a list item shows. */
export const EXCERPT_CHARS = 220;

/** One update, shaped for the list and the detail page. */
export interface UpdateItem {
  id: string;
  href: string;
  title: string;
  council: { slug: string; acronym: string; name: string };
  publishedAt: string;
  /** "Oct 18, 2026", in Manila. */
  published: string;
  /** "Edited Oct 19, 2026", or null when never changed. */
  edited: string | null;
  /** The opening of the body for the list, cut at a word. */
  excerpt: string;
  paragraphs: string[];
  /** The posting council's officers may edit or delete it. */
  canEdit: boolean;
  /** What the edit form starts from. */
  draft: { title: string; body: string };
}

/** Cuts text at the last whole word before `max` characters. */
export function excerptOf(text: string, max = EXCERPT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

export function toUpdateItem(announcement: Announcement): UpdateItem {
  const paragraphs = paragraphsOf(announcement.body);
  return {
    id: announcement.id,
    href: `/updates/${announcement.id}`,
    title: announcement.title,
    council: {
      slug: announcement.organization.slug,
      acronym: announcement.organization.acronym,
      name: announcement.organization.name,
    },
    publishedAt: announcement.publishedAt,
    published: formatManilaDate(announcement.publishedAt),
    edited: announcement.editedAt ? `Edited ${formatManilaDate(announcement.editedAt)}` : null,
    excerpt: excerptOf(paragraphs[0] ?? ''),
    paragraphs,
    canEdit: announcement.canEdit,
    draft: { title: announcement.title, body: announcement.body },
  };
}
