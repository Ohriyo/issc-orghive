// Prints fresh secrets as .env lines: an Ed25519 key pair for JWT_PRIVATE_KEY /
// JWT_PUBLIC_KEY and a key for MFA_ENCRYPTION_KEY.
//   pnpm --filter api keys:generate >> apps/api/.env
// An existing .env only missing the MFA key:
//   pnpm --filter api keys:generate --mfa-only >> apps/api/.env
// Generate separate secrets per environment. Rotating the JWT pair signs every user out
// within 15 minutes; rotating the MFA key makes enrolled authenticators unreadable.
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { generateSecretBoxKey } from '#src/lib/secret-box';

if (!process.argv.includes('--mfa-only')) {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
  const oneLine = (pem: string) => pem.trim().replaceAll('\n', '\\n');

  console.log(`JWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"`);
  console.log(`JWT_PUBLIC_KEY="${oneLine(await exportSPKI(publicKey))}"`);
}
console.log(`MFA_ENCRYPTION_KEY="${generateSecretBoxKey()}"`);
