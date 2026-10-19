import { randomInt } from 'node:crypto';

/** No 0/O, 1/l/I: easy to read aloud and type from a printed handover list. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * A temporary password for an organization account: 16 random characters (about 93 bits)
 * from a cryptographic source, in groups of 4. It satisfies the account password rule, and
 * the first sign-in must replace it anyway.
 */
export function generateTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = '';
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join('-');
}
