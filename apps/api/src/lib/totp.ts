import { generate, generateSecret, generateURI, verify } from 'otplib';

/** TOTP port (RFC 6238: SHA-1, 6 digits, 30 s), so services stay testable with a fixed clock. */
export interface Totp {
  generateSecret(): string;
  /** otpauth:// URI for authenticator apps (and the setup QR code). */
  uri(account: string, secret: string): string;
  /**
   * The matched time step, or null. A code from step `afterTimeStep` or earlier is
   * refused, so a code that already worked (or an older one) never works again.
   */
  verify(
    secret: string,
    code: string,
    options: { at: Date; afterTimeStep?: number | null },
  ): Promise<number | null>;
  /** The current code. Tests and the create-super-admin smoke check only. */
  generate(secret: string, at: Date): Promise<string>;
}

const ISSUER = 'Orghive';
/** One step either side: tolerates a phone clock up to 30 seconds off. */
const TOLERANCE_SECONDS = 30;

export function createTotp(): Totp {
  return {
    generateSecret: () => generateSecret(),

    uri: (account, secret) => generateURI({ issuer: ISSUER, label: account, secret }),

    async verify(secret, code, { at, afterTimeStep }) {
      const result = await verify({
        secret,
        token: code,
        epoch: Math.floor(at.getTime() / 1000),
        epochTolerance: TOLERANCE_SECONDS,
        ...(afterTimeStep != null && { afterTimeStep }),
      });
      // The functional API types HOTP and TOTP results together; only TOTP has timeStep.
      return result.valid && 'timeStep' in result ? result.timeStep : null;
    },

    generate: (secret, at) => generate({ secret, epoch: Math.floor(at.getTime() / 1000) }),
  };
}
