import type { TextSegment } from '@/lib/emphasis';

/** Renders presenter-shaped segments, with names set in bold as the prototype does. */
export function EmphasizedText({ segments }: { segments: readonly TextSegment[] }) {
  return segments.map((segment, i) =>
    segment.strong ? (
      <strong key={i} className="font-bold">
        {segment.text}
      </strong>
    ) : (
      segment.text
    ),
  );
}
