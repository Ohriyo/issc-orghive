// Creates the developer's SUPER_ADMIN account, the only way one is ever made (CLAUDE.md,
// "System roles"). Asks for the password in the terminal (hidden), then prints a one-time
// authenticator QR code and secret; the first sign-in confirms it at /mfa-setup.
//
//   pnpm --filter api create-super-admin --email dev@nwssu.edu.ph [--name "Dev Name"]
//   pnpm --filter api create-super-admin --email dev@nwssu.edu.ph --reset-mfa  (lost phone)
//
// With NODE_ENV=production it also needs --confirm.
import { parseArgs } from 'node:util';
import QRCode from 'qrcode';
import { z } from 'zod';
import { SUPER_ADMIN_PASSWORD_MIN_LENGTH } from '@orghive/shared';
import { createArgon2Hasher } from '#src/lib/password';
import { superAdminPasswordProblem } from '#src/lib/password-policy';
import { createSecretBox } from '#src/lib/secret-box';
import { createTotp } from '#src/lib/totp';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDb } from '#src/repositories/prisma';
import { createSystemRepository } from '#src/repositories/system.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { BootstrapError, bootstrapSuperAdmin } from '#src/services/super-admin-bootstrap.service';

const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    MFA_ENCRYPTION_KEY: z
      .string({
        error: 'MFA_ENCRYPTION_KEY is not set (pnpm --filter api keys:generate --mfa-only)',
      })
      .refine((value) => Buffer.from(value, 'base64').length === 32, {
        error: 'MFA_ENCRYPTION_KEY must be 32 random bytes, base64-encoded',
      }),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error(
    env.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'),
  );
  process.exit(1);
}

const { values: args } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    confirm: { type: 'boolean', default: false },
    'reset-mfa': { type: 'boolean', default: false },
  },
});
if (!args.email) {
  console.error('Usage: pnpm --filter api create-super-admin --email <email> [--name <name>]');
  process.exit(1);
}

/** Piped input not yet consumed: one chunk can hold several lines. */
let piped = '';

function nextPipedLine(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    const take = () => {
      const newline = piped.indexOf('\n');
      if (newline === -1) return false;
      const line = piped.slice(0, newline).replace(/\r$/, '');
      piped = piped.slice(newline + 1);
      stdin.off('data', onData);
      stdin.off('end', onEnd);
      stdin.pause();
      process.stdout.write('\n');
      resolve(line);
      return true;
    };
    const onData = (chunk: Buffer) => {
      piped += chunk.toString('utf8');
      take();
    };
    const onEnd = () => {
      if (take()) return;
      stdin.off('data', onData);
      reject(new BootstrapError('Input ended before a password was entered.'));
    };
    if (take()) return;
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.resume();
  });
}

/**
 * Reads a line without echoing it. A terminal gets raw mode (nothing shown, Backspace
 * works, Ctrl+C aborts); piped input is read as is, since a pipe never echoes.
 */
function readHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(prompt);
  if (!stdin.isTTY) return nextPipedLine();
  return new Promise((resolve, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u0003') return finish(new BootstrapError('Cancelled.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

/** Asks until the password meets the policy and is typed the same way twice (3 tries). */
async function askPassword(account: { email: string; name: string }): Promise<string> {
  console.log(
    `\nChoose a password: at least ${SUPER_ADMIN_PASSWORD_MIN_LENGTH} characters, not a common one, and not your name or email. A short sentence works well.`,
  );
  for (let attempt = 1; attempt <= 3; attempt++) {
    const password = await readHidden('Password: ');
    const problem = superAdminPasswordProblem(password, account);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    if ((await readHidden('Type it again: ')) !== password) {
      console.log('  The two passwords do not match.');
      continue;
    }
    return password;
  }
  throw new BootstrapError('No password set. Run the command again.');
}

const db = createDb(env.data.DATABASE_URL);
try {
  const result = await bootstrapSuperAdmin(
    {
      users: createUserRepository(db),
      system: createSystemRepository(db),
      passwords: createArgon2Hasher({ maxConcurrent: 4 }),
      secrets: createSecretBox(env.data.MFA_ENCRYPTION_KEY),
      totp: createTotp(),
      audit: createAuditLogRepository(db),
      nodeEnv: env.data.NODE_ENV,
    },
    {
      email: args.email,
      name: args.name,
      confirm: args.confirm,
      resetMfa: args['reset-mfa'],
      readPassword: askPassword,
    },
  );

  const done = {
    created: `Created super admin ${result.email}.`,
    mfa_reset: `Issued a new authenticator for ${result.email}. Their sessions were signed out.`,
  }[result.outcome];
  console.log(`\n${done}\n`);
  console.log('Scan this with an authenticator app (1Password, Google Authenticator, Authy…):\n');
  console.log(await QRCode.toString(result.otpauthUri, { type: 'terminal', small: true }));
  console.log(`Or enter this secret by hand: ${result.secret}\n`);
  console.log(
    'This is shown once. Sign in at /login, then confirm a code at /mfa-setup to finish and get your recovery codes.',
  );
} catch (err) {
  if (err instanceof BootstrapError) {
    console.error(`\n${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await db.$disconnect();
}
