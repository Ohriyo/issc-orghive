import { createHash, randomBytes } from 'node:crypto';

/** 256 bits from the OS CSPRNG, base64url-encoded (43 characters). Refresh and reset tokens. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored only as their SHA-256 hash. A fast hash is right here (unlike passwords):
 * a 256-bit random token cannot be brute-forced, and lookups need a deterministic hash.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
