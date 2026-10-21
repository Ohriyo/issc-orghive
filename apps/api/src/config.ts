import { z } from 'zod';

/** PEM keys arrive on one line in .env, with a literal backslash-n for each newline. */
function pem(label: 'PRIVATE KEY' | 'PUBLIC KEY') {
  return z
    .string()
    .transform((value) => value.replaceAll('\\n', '\n').trim())
    .refine(
      (value) =>
        value.startsWith(`-----BEGIN ${label}-----`) && value.endsWith(`-----END ${label}-----`),
      `must be a PEM-encoded ${label === 'PRIVATE KEY' ? 'PKCS #8 private' : 'SPKI public'} key (run pnpm --filter api keys:generate)`,
    );
}

/**
 * Express "trust proxy": how many reverse proxies sit in front of the API, so req.ip (and
 * with it the per-IP login limit) is the client's address. "true" is refused because it
 * would let any client spoof X-Forwarded-For and dodge the limit.
 */
const trustProxySchema = z
  .string()
  .default('false')
  .refine((value) => value !== 'true', 'use a hop count (e.g. 1) or a subnet, never "true"')
  .transform((value): boolean | number | string =>
    value === 'false' ? false : /^\d+$/.test(value) ? Number(value) : value,
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WEB_ORIGIN: z.url(),
    TRUST_PROXY: trustProxySchema,

    /** Ed25519 key pair that signs and verifies access tokens (EdDSA). */
    JWT_PRIVATE_KEY: pem('PRIVATE KEY'),
    JWT_PUBLIC_KEY: pem('PUBLIC KEY'),

    /**
     * 32 random bytes, base64: encrypts super admin TOTP secrets at rest (AES-256-GCM).
     * Required in production; without it, super admins cannot sign in. Changing it makes
     * every enrolled authenticator unreadable (re-run create-super-admin --reset-mfa).
     */
    MFA_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => Buffer.from(value, 'base64').length === 32,
        'must be 32 random bytes, base64-encoded (run pnpm --filter api keys:generate)',
      )
      .optional(),

    /**
     * Comma-separated email domains organization accounts may sign in with, e.g.
     * "nwssu.edu.ph". Empty or unset: any domain. Checked when the super admin creates or
     * edits an account.
     */
    ACCOUNT_EMAIL_DOMAINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
          .filter(Boolean),
      ),

    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z.string().min(3),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(8),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    /** What browsers use for pre-signed URLs, if the API reaches storage at another address. */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    /** Public base URL for keys under `logos/` (anonymous read on that prefix only, CDN-able). */
    PUBLIC_ASSET_BASE_URL: z.url(),

    /** clamd, which the worker streams every upload to before anyone else can see it. */
    CLAMAV_HOST: z.string().min(1).default('localhost'),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),

    /**
     * Gotenberg (headless LibreOffice), which the worker sends DOCX, XLSX and PPTX files to
     * for their view-only page images (docker-compose `gotenberg`).
     */
    GOTENBERG_URL: z.url().default('http://localhost:3100'),

    /**
     * Chromium for the Semestral End Report's pages (worker only). Unset: the browser
     * `pnpm exec playwright install chromium` downloaded. Set it in images that ship their own.
     */
    CHROMIUM_EXECUTABLE_PATH: z.string().min(1).optional(),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_FROM: z.email(),
    /** Implicit TLS (port 465). Leave false for STARTTLS on 587 or for mailpit locally. */
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.MFA_ENCRYPTION_KEY !== undefined, {
    path: ['MFA_ENCRYPTION_KEY'],
    message: 'is required in production (run pnpm --filter api keys:generate)',
  });

export type Config = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parses and validates environment variables. Throws a ConfigError listing every
 * invalid variable by name. Values are never included in the message, so secrets
 * cannot leak into logs.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}
