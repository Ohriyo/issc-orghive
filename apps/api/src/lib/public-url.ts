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
