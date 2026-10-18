import { z } from 'zod';
import { academicYearSchema } from './academic-term';
import { documentSummarySchema } from './document';
import { slugSchema } from './organization';

/** Shorter queries match too much to rank usefully. */
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 200;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
/** Search is ranked, so pages run out after this many results. */
export const SEARCH_MAX_RESULTS = 200;

/**
 * GET /search: full-text search across every organization's Paperworks the viewer may see.
 * Filters narrow by college (its slug, e.g. `cea`), organization slug, document type slug
 * and academic year. Unknown keys are dropped.
 */
export const searchQuerySchema = z.object({
  q: z.string().trim().min(SEARCH_MIN_QUERY).max(SEARCH_MAX_QUERY),
  college: slugSchema.optional(),
  org: slugSchema.optional(),
  type: slugSchema.optional(),
  year: academicYearSchema.optional(),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_MAX_RESULTS / SEARCH_DEFAULT_LIMIT)
    .optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * A passage around the matched words, split into plain-text parts so clients highlight
 * matches without rendering HTML.
 */
export const searchSnippetSchema = z
  .array(z.object({ text: z.string(), match: z.boolean() }))
  .meta({ id: 'SearchSnippet' });
export type SearchSnippet = z.infer<typeof searchSnippetSchema>;

export const searchHitSchema = z
  .object({
    document: documentSummarySchema,
    /** From the description or the file's text; null when neither has any text. */
    snippet: searchSnippetSchema.nullable(),
  })
  .meta({ id: 'SearchHit' });
export type SearchHit = z.infer<typeof searchHitSchema>;

/** Best matches first. `nextPage` is null on the last page. */
export const searchResponseSchema = z
  .object({
    query: z.string(),
    items: z.array(searchHitSchema),
    page: z.number().int(),
    nextPage: z.number().int().nullable(),
  })
  .meta({ id: 'SearchResponse' });
export type SearchResponse = z.infer<typeof searchResponseSchema>;

/** Characters the API puts around matched words in `ts_headline` output before splitting. */
export const SNIPPET_MATCH_START = '\u0002';
export const SNIPPET_MATCH_END = '\u0003';

/**
 * Shortens the text before the first match to its last `words` words, so a snippet clamped
 * to two or three lines still shows the matched words.
 */
export function trimSnippetLead(parts: SearchSnippet, words = 6): SearchSnippet {
  const [first, ...rest] = parts;
  if (!first || first.match || !rest.some((part) => part.match)) return parts;
  // The space before the match stays as it was.
  const lead = first.text.trimEnd();
  const gap = first.text.slice(lead.length);
  const leadWords = lead.split(/\s+/).filter(Boolean);
  if (leadWords.length <= words) return parts;
  return [{ text: `…${leadWords.slice(-words).join(' ')}${gap}`, match: false }, ...rest];
}

/** Splits `ts_headline` output marked with the characters above into snippet parts. */
export function parseSnippet(marked: string): SearchSnippet {
  const parts: SearchSnippet = [];
  let rest = marked;
  while (rest.length > 0) {
    const start = rest.indexOf(SNIPPET_MATCH_START);
    if (start === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    const end = rest.indexOf(SNIPPET_MATCH_END, start + 1);
    const stop = end === -1 ? rest.length : end;
    const word = rest.slice(start + 1, stop);
    if (word) parts.push({ text: word, match: true });
    rest = end === -1 ? '' : rest.slice(end + 1);
  }
  return parts;
}
