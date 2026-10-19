import { randomUUID } from 'node:crypto';
import { errors, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import type { SystemRole } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';

/** Access tokens live 15 minutes (CLAUDE.md). The refresh cookie renews them. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const ALG = 'EdDSA';
const ISSUER = 'orghive-api';
const AUDIENCE = 'orghive';
/** RFC 9068 media type: an ID token or other JWT signed with the same key cannot pass as an access token. */
const TYP = 'at+jwt';

const claimsSchema = z.object({
  sub: z.uuid(),
  jti: z.uuid(),
  /** Signed in with a temporary password: only changing it is allowed. */
  pwd_change: z.boolean().optional(),
  /** System role; absent means NONE. requireSuperAdmin re-checks it in the database. */
  sys: z.literal('SUPER_ADMIN').optional(),
  /** Super admin sessions: the refresh family, which keys the idle timeout and step-up. */
  sid: z.uuid().optional(),
  /** A super admin who has not confirmed their authenticator: only MFA setup is allowed. */
  mfa_setup: z.boolean().optional(),
});

export interface AccessClaims {
  userId: string;
  jti: string;
  passwordChangeRequired: boolean;
  /** Absent means NONE (tokens and test doubles from before system roles). */
  systemRole?: SystemRole;
  /** Set for super admin sessions only. */
  sessionId?: string;
  mfaSetupRequired?: boolean;
}

export interface TokenServiceDeps {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function createTokenService({ privateKeyPem, publicKeyPem }: TokenServiceDeps) {
  // Imported once, on first use; a bad key fails the first sign/verify loudly.
  const privateKey = importPKCS8(privateKeyPem, ALG);
  const publicKey = importSPKI(publicKeyPem, ALG);
  // Keep unhandled-rejection noise away until a key is actually used.
  privateKey.catch(() => {});
  publicKey.catch(() => {});

  return {
    async sign(input: Omit<AccessClaims, 'jti'>): Promise<{ token: string; expiresIn: number }> {
      const token = await new SignJWT({
        ...(input.passwordChangeRequired && { pwd_change: true }),
        ...(input.systemRole === 'SUPER_ADMIN' && { sys: 'SUPER_ADMIN' }),
        ...(input.sessionId && { sid: input.sessionId }),
        ...(input.mfaSetupRequired && { mfa_setup: true }),
      })
        .setProtectedHeader({ alg: ALG, typ: TYP })
        .setSubject(input.userId)
        .setJti(randomUUID())
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(await privateKey);
      return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
    },

    /** Throws a 401 AppError for any invalid, expired or foreign token. */
    async verify(token: string): Promise<AccessClaims> {
      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(token, await publicKey, {
          algorithms: [ALG],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: TYP,
          requiredClaims: ['sub', 'jti', 'exp', 'iat'],
        }));
      } catch (err) {
        if (err instanceof errors.JWTExpired)
          throw AppError.unauthorized('Your session has expired');
        throw AppError.unauthorized('Invalid access token');
      }
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw AppError.unauthorized('Invalid access token');
      return {
        userId: claims.data.sub,
        jti: claims.data.jti,
        passwordChangeRequired: claims.data.pwd_change === true,
        systemRole: claims.data.sys ?? 'NONE',
        ...(claims.data.sid && { sessionId: claims.data.sid }),
        mfaSetupRequired: claims.data.mfa_setup === true,
      };
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
