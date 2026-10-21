import { errors, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AppError } from '#src/errors/app-error';

/** CLAUDE.md: page links last 5 minutes, like download links. The viewer asks for a new one. */
export const PAGE_TOKEN_TTL_SECONDS = 5 * 60;

const ALG = 'EdDSA';
const ISSUER = 'orghive-api';
/**
 * Its own audience and type: a page token is never an access token, and an access token
 * never opens a page (token.service.ts checks `orghive` and `at+jwt`).
 */
const AUDIENCE = 'orghive:pages';
const TYP = 'page+jwt';

const claimsSchema = z.object({ sub: z.uuid(), ver: z.uuid() });

export interface PageGrant {
  documentId: string;
  versionId: string;
}

export interface PageTokenServiceDeps {
  privateKeyPem: string;
  publicKeyPem: string;
  now?: () => Date;
}

/**
 * Signed, 5-minute grants to read one version's page images. Issued by GET
 * /documents/:id/viewer after the visibility check; the page route needs no session, since
 * an <img> cannot send the in-memory access token.
 */
export function createPageTokenService({
  privateKeyPem,
  publicKeyPem,
  now = () => new Date(),
}: PageTokenServiceDeps) {
  const privateKey = importPKCS8(privateKeyPem, ALG);
  const publicKey = importSPKI(publicKeyPem, ALG);
  privateKey.catch(() => {});
  publicKey.catch(() => {});

  return {
    async sign(grant: PageGrant): Promise<{ token: string; expiresAt: Date }> {
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + PAGE_TOKEN_TTL_SECONDS * 1000);
      const token = await new SignJWT({ ver: grant.versionId })
        .setProtectedHeader({ alg: ALG, typ: TYP })
        .setSubject(grant.documentId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(await privateKey);
      return { token, expiresAt };
    },

    /** Throws 403 for an expired, foreign or damaged token. */
    async verify(token: string): Promise<PageGrant> {
      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(token, await publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: TYP,
          currentDate: now(),
          requiredClaims: ['sub', 'exp'],
        }));
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw AppError.forbidden('This page link has expired. Reload the document.');
        }
        throw AppError.forbidden('Invalid page link');
      }
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw AppError.forbidden('Invalid page link');
      return { documentId: claims.data.sub, versionId: claims.data.ver };
    },
  };
}

export type PageTokenService = ReturnType<typeof createPageTokenService>;
