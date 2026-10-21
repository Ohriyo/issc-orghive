/**
 * The security headers every response of the web app (apps/web/dist) must carry. One policy,
 * applied by `vite preview` here and by whatever hosts the build in production: import
 * securityHeaders() there, or copy its output into the host's header config.
 *
 * The API sets its own headers with helmet (apps/api/src/app.ts); these cover the SPA pages,
 * which the API never serves. frame-ancestors cannot be set from a <meta> tag, so a host
 * header is the only way to stop the app being framed (clickjacking).
 *
 * @param {{ storageOrigin?: string, apiOrigin?: string, csp?: boolean }} [options]
 *   storageOrigin: where browsers fetch logos and thumbnails and PUT uploads (the S3/MinIO
 *     public endpoint, e.g. https://files.orghive.example).
 *   apiOrigin: only when the API is on another origin (VITE_API_URL); same-origin needs none.
 *     The viewer's page images come from the API, so it is an image source too.
 *   csp: false for the Vite dev server, whose hot reload needs inline scripts.
 * @returns {Record<string, string>}
 */
export function securityHeaders({ storageOrigin, apiOrigin, csp = true } = {}) {
  const origins = (...extra) => ["'self'", ...extra.filter(Boolean)].join(' ');
  const headers = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    // For old browsers; frame-ancestors below is the modern rule.
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  if (!csp) return headers;
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      // Radix and sonner inject <style> elements, and components set style attributes.
      "style-src 'self' 'unsafe-inline'",
      // Logos and thumbnails from storage; view-only page images from the API.
      `img-src ${origins('data:', 'blob:', storageOrigin, apiOrigin)}`,
      "font-src 'self' data:",
      // API calls, and uploads PUT straight to storage with pre-signed URLs.
      `connect-src ${origins(apiOrigin, storageOrigin)}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    ...headers,
  };
}
