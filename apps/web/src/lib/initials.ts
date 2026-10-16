const MINOR_WORDS = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'at', 'a', 'an']);

/** "College of Engineering and Architecture" -> "CEA". Used only when no logo is available. */
export function initialsOf(name: string): string {
  return name
    .split(/[\s-]+/)
    .filter((word) => word && !MINOR_WORDS.has(word.toLowerCase()))
    .map((word) => word[0]!.toUpperCase())
    .join('')
    .slice(0, 5);
}
