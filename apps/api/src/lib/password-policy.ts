import { readFileSync } from 'node:fs';
import { PASSWORD_MAX_LENGTH, SUPER_ADMIN_PASSWORD_MIN_LENGTH } from '@orghive/shared';

/**
 * Passwords of 14+ characters from the xato-net 1M and NCSC 100k breach lists (SecLists,
 * MIT), lowercased. Shorter entries are left out: the length rule already refuses them.
 */
const LIST_URL = new URL('./data/common-passwords-14.txt', import.meta.url);

let common: Set<string> | undefined;
function commonPasswords(): Set<string> {
  common ??= new Set(
    readFileSync(LIST_URL, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return common;
}

/** Name and email parts long enough to matter: "juan", "delacruz", "jdelacruz". */
function personalParts({ email, name }: { email: string; name: string }): string[] {
  const local = email.split('@')[0] ?? '';
  return [local, ...local.split(/[^a-z0-9]+/i), ...name.split(/\s+/)]
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 4);
}

/**
 * Why a super admin password is refused, or null when it is acceptable: at least 14
 * characters, not a known breached password, not built on the account's name or email,
 * and not one character repeated.
 */
export function superAdminPasswordProblem(
  password: string,
  account: { email: string; name: string },
): string | null {
  if (password.length < SUPER_ADMIN_PASSWORD_MIN_LENGTH) {
    return `Use at least ${SUPER_ADMIN_PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  const lower = password.toLowerCase();
  if (commonPasswords().has(lower)) {
    return 'This password appears in lists of breached passwords. Choose another.';
  }
  if (personalParts(account).some((part) => lower.includes(part))) {
    return 'Do not build the password on your name or email';
  }
  if (new Set(lower).size < 5) {
    return 'Use more than a few different characters';
  }
  return null;
}
