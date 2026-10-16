/** The public origin. VITE_SITE_URL wins over the current host (previews, proxies); empty means unset. */
function siteOrigin(): string {
  const configured: string | undefined = import.meta.env.VITE_SITE_URL;
  return configured || window.location.origin;
}

/** Canonical and Open Graph URLs must be absolute. */
export function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, siteOrigin()).href;
}
