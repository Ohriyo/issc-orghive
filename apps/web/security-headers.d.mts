/** Types for security-headers.mjs (plain JS so any Node host can import it as is). */
export declare function securityHeaders(options?: {
  storageOrigin?: string;
  apiOrigin?: string;
  csp?: boolean;
}): Record<string, string>;
