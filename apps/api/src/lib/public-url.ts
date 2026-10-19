/** Builds public URLs for keys under the public-read `logos/` prefix. */
export type PublicUrl = (key: string | null) => string | null;

export function createPublicUrl(baseUrl: string): PublicUrl {
  const base = baseUrl.replace(/\/+$/, '');
  return (key) => {
    if (!key) return null;
    // Only the logos/ prefix is anonymously readable; never expose any other key.
    if (!key.startsWith('logos/')) return null;
    return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  };
}

/** Where a resized variant of a `.webp` logo is stored: `logos/x-ab12.webp` -> `logos/x-ab12-256.webp`. */
export function logoVariantKey(key: string, width: number): string {
  return key.replace(/\.webp$/, `-${width}.webp`);
}

/**
 * The `srcset` for a logo's resized variants, smallest first, or null when it has none
 * (the browser then uses logoUrl alone).
 */
export function logoSrcSet(
  publicUrl: PublicUrl,
  key: string | null,
  widths: readonly number[],
): string | null {
  if (!key?.endsWith('.webp') || widths.length === 0) return null;
  const entries = [...widths]
    .sort((a, b) => a - b)
    .map((w) => {
      const url = publicUrl(logoVariantKey(key, w));
      return url && `${url} ${w}w`;
    });
  return entries.every(Boolean) ? entries.join(', ') : null;
}
