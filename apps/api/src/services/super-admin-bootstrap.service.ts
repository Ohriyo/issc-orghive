import { emailSchema } from '@orghive/shared';
import type { PasswordHasher } from '#src/lib/password';
import { superAdminPasswordProblem } from '#src/lib/password-policy';
import type { SecretBox } from '#src/lib/secret-box';
import type { Totp } from '#src/lib/totp';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import type { UserRepository } from '#src/repositories/user.repository';

/*
 * The only way to create a super admin (CLAUDE.md, "System roles"): a command run with
 * server access, never seed data or a signup screen. It issues a TOTP secret that the new
 * super admin confirms at /mfa-setup on first sign-in.
 */

/** A refusal the command prints as is, without a stack trace. */
export class BootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export interface BootstrapOptions {
  email: string;
  /** For a new account; defaults to the email's local part. */
  name?: string;
  /** Required when NODE_ENV=production. */
  confirm: boolean;
  /** Issue a new authenticator secret for an existing super admin; keeps the password. */
  resetMfa: boolean;
  /** Asks for the password (hidden input); called only when one is needed. */
  readPassword: (account: { email: string; name: string }) => Promise<string>;
}

export interface BootstrapResult {
  outcome: 'created' | 'mfa_reset';
  userId: string;
  email: string;
  /** Base32 TOTP secret, for manual entry. Printed once; stored only encrypted. */
  secret: string;
  /** otpauth:// URI for the QR code. */
  otpauthUri: string;
}

export interface BootstrapDeps {
  users: Pick<UserRepository, 'findByEmail'>;
  system: Pick<SystemRepository, 'createSuperAdmin' | 'resetSuperAdminMfa'>;
  passwords: Pick<PasswordHasher, 'hash'>;
  secrets: SecretBox;
  totp: Pick<Totp, 'generateSecret' | 'uri'>;
  audit: Pick<AuditLogRepository, 'record'>;
  nodeEnv: string;
  now?: () => Date;
}

export async function bootstrapSuperAdmin(
  deps: BootstrapDeps,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  if (deps.nodeEnv === 'production' && !options.confirm) {
    throw new BootstrapError(
      'NODE_ENV is production. Re-run with --confirm if you mean to change this server.',
    );
  }
  const parsed = emailSchema.safeParse(options.email);
  if (!parsed.success) throw new BootstrapError('Pass a valid --email.');
  const email = parsed.data;
  const at = (deps.now ?? (() => new Date()))();

  const existing = await deps.users.findByEmail(email);
  const secret = deps.totp.generateSecret();
  const seal = (userId: string) => deps.secrets.seal(secret, userId);
  const result = (outcome: BootstrapResult['outcome'], userId: string): BootstrapResult => ({
    outcome,
    userId,
    email,
    secret,
    otpauthUri: deps.totp.uri(email, secret),
  });

  if (options.resetMfa) {
    if (existing?.systemRole !== 'SUPER_ADMIN') {
      throw new BootstrapError(`${email} is not a super admin.`);
    }
    await deps.system.resetSuperAdminMfa(existing.id, seal(existing.id), at);
    await deps.audit.record({
      action: 'super_admin_mfa_reset',
      entityType: 'user',
      entityId: existing.id,
      metadata: { via: 'cli' },
    });
    return result('mfa_reset', existing.id);
  }

  if (existing?.systemRole === 'SUPER_ADMIN') {
    throw new BootstrapError(
      `${email} is already a super admin. Use --reset-mfa to issue a new authenticator.`,
    );
  }
  // Organization accounts are shared by officers; one never becomes a super admin.
  if (existing) {
    throw new BootstrapError(
      `${email} already belongs to an account. A super admin needs an email of its own.`,
    );
  }

  const name = options.name?.trim() || email.split('@')[0]!;
  const password = await options.readPassword({ email, name });
  const problem = superAdminPasswordProblem(password, { email, name });
  if (problem) throw new BootstrapError(problem);
  const passwordHash = await deps.passwords.hash(password);

  const userId = await deps.system.createSuperAdmin({ email, name, passwordHash }, seal, at);
  await deps.audit.record({
    action: 'super_admin_create',
    entityType: 'user',
    entityId: userId,
    metadata: { via: 'cli' },
  });
  return result('created', userId);
}
