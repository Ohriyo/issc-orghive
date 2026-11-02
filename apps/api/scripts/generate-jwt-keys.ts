// Prints fresh secrets as .env lines: an Ed25519 key pair for JWT_PRIVATE_KEY /
// JWT_PUBLIC_KEY, a key for MFA_ENCRYPTION_KEY and one for TASK_QR_SECRET.
//   pnpm --filter api keys:generate >> apps/api/.env
// An existing .env only missing the MFA key, or the task QR secret:
//   pnpm --filter api keys:generate --mfa-only >> apps/api/.env
//   pnpm --filter api keys:generate --qr-only >> apps/api/.env
// Generate separate secrets per environment. Rotating the JWT pair signs every user out
// within 15 minutes; rotating the MFA key makes enrolled authenticators unreadable; rotating
// the QR secret makes printed templates' QR codes unreadable (their short codes still work).
import { randomBytes } from 'node:crypto';
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { generateSecretBoxKey } from '#src/lib/secret-box';

const qrOnly = process.argv.includes('--qr-only');
const mfaOnly = process.argv.includes('--mfa-only');
if (!mfaOnly && !qrOnly) {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
  const oneLine = (pem: string) => pem.trim().replaceAll('\n', '\\n');

  console.log(`JWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"`);
  console.log(`JWT_PUBLIC_KEY="${oneLine(await exportSPKI(publicKey))}"`);
}
if (!qrOnly) console.log(`MFA_ENCRYPTION_KEY="${generateSecretBoxKey()}"`);
if (!mfaOnly) console.log(`TASK_QR_SECRET="${randomBytes(32).toString('base64')}"`);
