import { generateKeyPairSync } from 'node:crypto';
import type { AppServices } from '#src/app';
import argon2 from 'argon2';
import { pino } from 'pino';
import { memoryMailer } from '#src/lib/mailer';
import { createArgon2Hasher } from '#src/lib/password';
import { createSecretBox, generateSecretBoxKey } from '#src/lib/secret-box';
import { createRedisSuperAdminStore } from '#src/lib/super-admin-store';
import { createTotp } from '#src/lib/totp';
import { redisRateLimitStore } from '#src/middleware/rate-limit';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createPasswordResetTokenRepository } from '#src/repositories/password-reset-token.repository';
import type { Db } from '#src/repositories/prisma';
import { createRecoveryCodeRepository } from '#src/repositories/recovery-code.repository';
import { createRefreshTokenRepository } from '#src/repositories/refresh-token.repository';
import { createSystemRepository } from '#src/repositories/system.repository';
import { createUserRepository } from '#src/repositories/user.repository';
import { createAuthService } from '#src/services/auth.service';
import { createSuperAdminService } from '#src/services/super-admin.service';
import { createSessionGuard } from '#src/services/session-guard';
import { createSystemService } from '#src/services/system.service';
import { createSystemSettingRepository } from '#src/repositories/system-setting.repository';
import { createSystemSettingsService } from '#src/services/system-settings.service';
import { memoryCache } from '#src/lib/cache';
import { createPublicUrl } from '#src/lib/public-url';
import { createAccountAdminRepository } from '#src/repositories/account-admin.repository';
import { createAdminOrganizationRepository } from '#src/repositories/admin-organization.repository';
import { createNotificationRepository } from '#src/repositories/notification.repository';
import { createRevealRepository } from '#src/repositories/reveal.repository';
import { createSupportRepository } from '#src/repositories/support.repository';
import { createAccountAdminService } from '#src/services/account-admin.service';
import { createAdminOrganizationService } from '#src/services/admin-organization.service';
import { createNotificationService } from '#src/services/notification.service';
import { createRevealService } from '#src/services/reveal.service';
import { createSupportService } from '#src/services/support.service';
import { createAccountRequestRepository } from '#src/repositories/account-request.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createAccountRequestService } from '#src/services/account-request.service';
import { createAccountImportRepository } from '#src/repositories/account-import.repository';
import { createAccountImportService } from '#src/services/account-import.service';
import { createTokenService } from '#src/services/token.service';
import { buildTestApp, TEST_ASSET_BASE_URL, TEST_WEB_ORIGIN } from './helpers';
import type { Redis } from 'ioredis';

/** A fresh Ed25519 pair per test run; no key is ever committed. */
export function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export const TEST_PASSWORD = 'correct horse battery staple';

/**
 * Still Argon2id, at a fraction of production cost (1 MiB, 1 pass), so the many logins in
 * the route tests stay fast when the whole monorepo suite runs in parallel. Production uses
 * createArgon2Hasher's defaults; test/password.test.ts covers those.
 */
export const TEST_ARGON2_COST = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

let hashed: Promise<string> | undefined;
/** Argon2id hash of TEST_PASSWORD, computed once per run. */
export function testPasswordHash(): Promise<string> {
  hashed ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id, ...TEST_ARGON2_COST });
  return hashed;
}

/**
 * A user that signs in with TEST_PASSWORD. With `organizationId` it is that organization's
 * shared account (see createAccount in db.ts for one with an officer-in-charge).
 */
export async function createUser(
  db: Db,
  email: string,
  {
    mustChangePassword = false,
    disabled = false,
    locked = false,
    organizationId,
  }: {
    mustChangePassword?: boolean;
    disabled?: boolean;
    locked?: boolean;
    organizationId?: string;
  } = {},
) {
  return db.user.create({
    data: {
      email,
      name: email.split('@')[0]!,
      passwordHash: await testPasswordHash(),
      mustChangePassword,
      disabledAt: disabled ? new Date() : null,
      lockedAt: locked ? new Date() : null,
      organizationId: organizationId ?? null,
    },
  });
}

/**
 * The organization's shared account, signing in with `email` and TEST_PASSWORD. Reuses the
 * account buildWorld made (one active account per organization), or creates one.
 */
export async function accountFor(db: Db, organizationId: string, email: string) {
  const existing = await db.user.findFirst({ where: { organizationId, disabledAt: null } });
  if (!existing) return createUser(db, email, { organizationId });
  return db.user.update({
    where: { id: existing.id },
    data: { email, passwordHash: await testPasswordHash() },
  });
}

/** One MFA encryption key per test run, like the JWT keys. */
export const TEST_MFA_KEY = generateSecretBoxKey();
export const testSecrets = createSecretBox(TEST_MFA_KEY);
export const testTotp = createTotp();

/**
 * A super admin as the create-super-admin command leaves them: a sealed TOTP secret, and
 * (unless `pending`) a confirmed authenticator. Returns the plain secret for generating codes.
 */
export async function createSuperAdmin(
  db: Db,
  email: string,
  { pending = false, disabled = false } = {},
) {
  const user = await createUser(db, email, { disabled });
  const secret = testTotp.generateSecret();
  await db.user.update({
    where: { id: user.id },
    data: {
      systemRole: 'SUPER_ADMIN',
      mfaSecret: testSecrets.seal(secret, user.id),
      mfaEnabledAt: pending ? null : new Date(),
    },
  });
  return { user, secret };
}

/**
 * The current code for `secret`, `stepsAhead` 30-second steps from `at`. Each code works once
 * per account, so a test that signs in and then steps up uses the next step for the second.
 */
export function totpCode(secret: string, { at = new Date(), stepsAhead = 0 } = {}) {
  return testTotp.generate(secret, new Date(at.getTime() + stepsAhead * 30_000));
}

/** The real auth stack on the test database and test Redis, with mail captured in memory. */
export function buildAuthApp(
  db: Db,
  redis: Redis,
  {
    keys = testKeys(),
    trustProxy = false,
    now,
    emailDomains = [],
    demoData,
  }: {
    keys?: ReturnType<typeof testKeys>;
    trustProxy?: boolean | number;
    now?: () => Date;
    /** Demo data's /system routes, when a test exercises them. */
    demoData?: AppServices['demoData'];
    /** ACCOUNT_EMAIL_DOMAINS for the /system account forms. */
    emailDomains?: string[];
  } = {},
) {
  const tokens = createTokenService(keys);
  const mailer = memoryMailer();
  const logger = pino({ level: 'silent' });
  const users = createUserRepository(db);
  const refreshTokens = createRefreshTokenRepository(db);
  const audit = createAuditLogRepository(db);
  const passwords = createArgon2Hasher({ cost: TEST_ARGON2_COST });
  const systemReads = createSystemRepository(db);
  const superAdmins = createSuperAdminService({
    users,
    recoveryCodes: createRecoveryCodeRepository(db),
    system: systemReads,
    refreshTokens,
    store: createRedisSuperAdminStore(redis),
    totp: testTotp,
    secrets: testSecrets,
    passwords,
    audit,
    mailer,
    logger,
    now,
  });
  const accounts = createAccountRepository(db);
  const auth = createAuthService({
    users,
    accounts,
    refreshTokens,
    resetTokens: createPasswordResetTokenRepository(db),
    audit,
    tokens,
    superAdmins,
    passwords,
    mailer,
    logger,
    webOrigin: TEST_WEB_ORIGIN,
    now,
  });
  const accountAdminReads = createAccountAdminRepository(db);
  const system = createSystemService({
    system: systemReads,
    accounts: accountAdminReads,
    refreshTokens,
    audit,
    queues: () => Promise.resolve([]),
    logger,
    now,
  });
  /** What the services queued: notification emails and virus scans. */
  const queued = { emails: [] as string[], processing: [] as string[] };
  const notifications = createNotificationService({
    notifications: createNotificationRepository(db),
    queue: {
      enqueueEmails: (ids) => {
        queued.emails.push(...ids);
        return Promise.resolve();
      },
    },
    logger,
  });
  const reveals = createRevealService({
    reveals: createRevealRepository(db),
    secrets: testSecrets,
    notifications,
    audit,
    now,
  });
  const cache = memoryCache();
  const adminOrganizationReads = createAdminOrganizationRepository(db);
  const adminOrganizations = createAdminOrganizationService({
    admin: adminOrganizationReads,
    audit,
    cache,
    storage: { put: () => Promise.resolve() },
    publicUrl: createPublicUrl(TEST_ASSET_BASE_URL),
    now,
  });
  const accountRequestReads = createAccountRequestRepository(db);
  const accountRequests = createAccountRequestService({
    requests: accountRequestReads,
    orgReads: adminOrganizationReads,
    superAdmins: systemReads,
    mailer,
    notifications,
    audit,
    logger,
    webOrigin: TEST_WEB_ORIGIN,
    emailDomains,
    now,
  });
  const accountAdmin = createAccountAdminService({
    requests: accountRequestReads,
    accounts: accountAdminReads,
    accountReads: accounts,
    orgReads: adminOrganizationReads,
    organizations: adminOrganizations,
    audits: systemReads,
    reveals,
    passwords,
    audit,
    emailDomains,
    now,
  });
  const support = createSupportService({
    support: createSupportRepository(db),
    queue: {
      enqueueProcessing: (id) => {
        queued.processing.push(id);
        return Promise.resolve();
      },
    },
    cache,
    audit,
    now,
  });
  const app = buildTestApp(
    {
      auth,
      notifications,
      reveals,
      adminOrganizations,
      accountAdmin,
      accountRequests,
      accountImports: createAccountImportService({
        imports: createAccountImportRepository(db),
        reveals,
        passwords,
        audit,
        emailDomains,
        now,
      }),
      access: createAccessService({
        accounts,
        organizations: createOrganizationRepository(db),
        documents: createDocumentRepository(db),
        projects: createProjectRepository(db),
      }),
      support,
      tokens: {
        verify: (token) => tokens.verify(token),
        checkSession: createSessionGuard({ accounts, superAdmins }),
      },
      superAdmins,
      system,
      systemSettings: createSystemSettingsService({
        settings: createSystemSettingRepository(db),
        audit,
      }),
      ...(demoData && { demoData }),
    },
    { TRUST_PROXY: trustProxy },
    redisRateLimitStore(redis),
  );
  return { app, tokens, mailer, keys, queued, cache };
}

/** The refresh token from a response's Set-Cookie, or undefined when cleared. */
export function refreshCookieOf(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const match = cookies.map((c) => /^orghive_rt=([^;]*)/.exec(c)).find(Boolean);
  return match?.[1] || undefined;
}

export function setCookieHeader(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  return (
    (Array.isArray(raw) ? (raw as string[]) : []).find((c) => c.startsWith('orghive_rt=')) ?? ''
  );
}
