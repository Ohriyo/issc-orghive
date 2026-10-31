/*
 * The Student Handbook's rules (docs/DOMAIN_RULES.md, "Student Handbook"), as pure functions:
 * the one place that decides them. One edition per academic year; re-uploads are versions of
 * it; editions are never removed. The very first edition is current by itself; after that the
 * ISSC account chooses, and only an edition readers can open (scanned clean) can be current.
 */

export interface EditionState {
  /** It has an available, public version: readers can open it. */
  readable: boolean;
  isCurrent: boolean;
}

/** What an upload for a year does: start the edition, or add the next version of it. */
export function uploadPlan(existing: { academicYear: string } | null): 'new-edition' | 'new-version' {
  return existing ? 'new-version' : 'new-edition';
}

/** Why an edition cannot be made current, or null when it can (already current is fine). */
export function makeCurrentRefusal(edition: EditionState | null): string | null {
  if (!edition) return 'There is no edition for that academic year';
  if (!edition.readable) {
    return 'This edition is still being checked. It can be made current once its file passes the virus scan.';
  }
  return null;
}

/** Only PDFs: the contents and search are built from the PDF's bookmarks and text. */
export function handbookFileRefusal(mimeType: string): string | null {
  return mimeType === 'application/pdf' ? null : 'uploadKey: The Student Handbook must be a PDF';
}

export interface ReadableEdition {
  academicYear: string;
  /** The ISSC account marked it current. */
  isCurrent: boolean;
  /** When the edition was first uploaded. */
  createdAt: Date;
}

/**
 * The edition readers see as current, among the readable ones: the one the ISSC account
 * marked, else (the marked one is still being checked, or was refused) the most recently
 * uploaded. Null only when no edition is readable at all.
 */
export function readersCurrentYear(readable: ReadableEdition[]): string | null {
  const marked = readable.find((e) => e.isCurrent);
  if (marked) return marked.academicYear;
  const latest = [...readable].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.academicYear.localeCompare(a.academicYear),
  )[0];
  return latest?.academicYear ?? null;
}

/** Why an edition's pages cannot be rendered again, or null when they can (only after a failure). */
export function retryPreviewRefusal(
  version: { scanStatus: string; previewStatus: string } | null,
): string | null {
  if (!version) return 'There is no edition for that academic year';
  if (version.scanStatus !== 'clean') {
    return 'This edition is still being checked. Its pages are prepared once its file passes the virus scan.';
  }
  if (version.previewStatus === 'pending') return 'The pages are already being prepared';
  if (version.previewStatus === 'ready') return 'The pages are already ready';
  return null;
}
