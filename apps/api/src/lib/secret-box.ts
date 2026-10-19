import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets at rest (TOTP secrets). Unlike passwords they cannot be hashed:
 * the server needs the secret back to check each code. AES-256-GCM with a random 96-bit IV;
 * `context` (the user id) is authenticated too, so a secret copied onto another user's row
 * fails to open.
 */
export interface SecretBox {
  seal(plaintext: string, context: string): string;
  /** Throws when the value was tampered with, sealed for another context or another key. */
  open(sealed: string, context: string): string;
}

const VERSION = 'v1';

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded');
  }

  return {
    seal(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), ciphertext]
        .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
        .join('.');
    },

    open(sealed, context) {
      const [version, iv, tag, ciphertext] = sealed.split('.');
      if (version !== VERSION || !iv || !tag || !ciphertext) {
        throw new Error('Unrecognized sealed secret');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/** A fresh key for MFA_ENCRYPTION_KEY. */
export function generateSecretBoxKey(): string {
  return randomBytes(32).toString('base64');
}
