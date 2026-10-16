// Prints a fresh Ed25519 key pair as .env lines for JWT_PRIVATE_KEY / JWT_PUBLIC_KEY.
//   pnpm --filter api keys:generate >> apps/api/.env
// Generate a separate pair per environment. Rotating it signs every user out within 15 minutes.
import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('EdDSA', { extractable: true });
const oneLine = (pem: string) => pem.trim().replaceAll('\n', '\\n');

console.log(`JWT_PRIVATE_KEY="${oneLine(await exportPKCS8(privateKey))}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(await exportSPKI(publicKey))}"`);
