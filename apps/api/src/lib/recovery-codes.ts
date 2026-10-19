import { randomInt } from 'node:crypto';
import { RECOVERY_CODE_COUNT, recoveryCodeSchema } from '@orghive/shared';

/** No i, l, o, 0 or 1: nothing to misread when the code is typed from paper. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 10;

/** Fresh one-time recovery codes, formatted "abcde-fghij" (about 49 bits each). */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    let code = '';
    for (let i = 0; i < LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
}

/** The form that is hashed and compared: lowercase, no dash or spaces. Null if malformed. */
export function normalizeRecoveryCode(code: string): string | null {
  const parsed = recoveryCodeSchema.safeParse(code);
  return parsed.success ? parsed.data : null;
}
