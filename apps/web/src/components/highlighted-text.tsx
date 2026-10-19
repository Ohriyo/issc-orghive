import type { SearchSnippet } from '@orghive/shared';

/**
 * A search snippet with its matched words marked. The parts are plain text from the API,
 * rendered as text (never as HTML).
 */
export function HighlightedText({
  parts,
  className,
}: {
  parts: SearchSnippet;
  className?: string;
}) {
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-leaf/20 px-0.5 font-semibold text-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}
