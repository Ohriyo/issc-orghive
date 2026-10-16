export interface TextSegment {
  text: string;
  strong: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits text so known names can be set in bold, as the prototype does with organization
 * names inside descriptions. The emphasis comes from data (names and acronyms), so no
 * markup is ever stored in a description. Matches whole words only, case-sensitively:
 * "CEA" is not emphasized inside "CEA-tizens".
 */
export function emphasize(text: string, terms: readonly string[]): TextSegment[] {
  const unique = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 1))]
    // Longest first, so "CSC-CEA" wins over a shorter term it contains.
    .sort((a, b) => b.length - a.length);
  if (unique.length === 0) return [{ text, strong: false }];

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}-])(?:${unique.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}-])`,
    'gu',
  );
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), strong: false });
    segments.push({ text: match[0], strong: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), strong: false });
  return segments;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
