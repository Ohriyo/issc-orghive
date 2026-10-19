import { describe, expect, it, vi } from 'vitest';
import { createSecretBox, generateSecretBoxKey } from '#src/lib/secret-box';
import { createTotp } from '#src/lib/totp';
import type { AuditEntry } from '#src/repositories/audit-log.repository';
import type { UserCredentials } from '#src/repositories/user.repository';
import {
  BootstrapError,
  bootstrapSuperAdmin,
  type BootstrapOptions,
} from '#src/services/super-admin-bootstrap.service';

const STRONG = 'violet orbit lantern 42';
const secrets = createSecretBox(generateSecretBoxKey());

function setup(existing?: Partial<UserCredentials>) {
  const audit: AuditEntry[] = [];
  const system = {
    createSuperAdmin: vi.fn((_account: unknown, seal: (id: string) => string) => {
      sealed = seal('new-id');
      return Promise.resolve('new-id');
    }),
    resetSuperAdminMfa: vi.fn((_id: string, s: string) => {
      sealed = s;
      return Promise.resolve();
    }),
  };
  let sealed = '';
  const user = existing && {
    id: 'existing-id',
    email: 'dev@nwssu.test',
    name: 'Dev Person',
    systemRole: 'NONE' as const,
    ...existing,
  };
  const deps = {
    users: { findByEmail: () => Promise.resolve((user ?? null) as UserCredentials | null) },
    system,
    passwords: { hash: (p: string) => Promise.resolve(`hashed:${p}`) },
    secrets,
    totp: createTotp(),
    audit: {
      record: (e: AuditEntry) => {
        audit.push(e);
        return Promise.resolve();
      },
    },
    nodeEnv: 'development',
  };
  const run = (options: Partial<BootstrapOptions> = {}, env = 'development') =>
    bootstrapSuperAdmin(
      { ...deps, nodeEnv: env },
      {
        email: ' Dev@NWSSU.test ',
        confirm: false,
        resetMfa: false,
        readPassword: () => Promise.resolve(STRONG),
        ...options,
      },
    );
  return { run, system, audit, sealed: () => sealed };
}

describe('bootstrapSuperAdmin', () => {
  it('refuses to run in production without --confirm', async () => {
    const s = setup();
    await expect(s.run({}, 'production')).rejects.toThrow(/--confirm/);
    expect(s.system.createSuperAdmin).not.toHaveBeenCalled();
    await expect(s.run({ confirm: true }, 'production')).resolves.toMatchObject({
      outcome: 'created',
    });
  });

  it('creates a super admin with a hashed password and an encrypted, pending secret', async () => {
    const s = setup();
    const result = await s.run({ name: 'Dev Person' });

    expect(result).toMatchObject({ outcome: 'created', userId: 'new-id', email: 'dev@nwssu.test' });
    expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\/Orghive:dev%40nwssu\.test\?/);
    expect(s.system.createSuperAdmin).toHaveBeenCalledWith(
      { email: 'dev@nwssu.test', name: 'Dev Person', passwordHash: `hashed:${STRONG}` },
      expect.any(Function),
      expect.any(Date),
    );
    expect(s.sealed()).not.toContain(result.secret);
    expect(secrets.open(s.sealed(), 'new-id')).toBe(result.secret);
    expect(s.audit).toEqual([
      expect.objectContaining({ action: 'super_admin_create', entityId: 'new-id' }),
    ]);
  });

  it('applies the password policy', async () => {
    const s = setup();
    await expect(
      s.run({ readPassword: () => Promise.resolve('passwordpassword') }),
    ).rejects.toBeInstanceOf(BootstrapError);
    await expect(
      s.run({ name: 'Dev Person', readPassword: () => Promise.resolve('person of interest 9') }),
    ).rejects.toThrow(/name or email/);
    await expect(s.run({ email: 'not an email' })).rejects.toThrow(/--email/);
  });

  it('never turns an existing (organization) account into a super admin', async () => {
    const s = setup({});
    await expect(s.run()).rejects.toThrow(/email of its own/);
    expect(s.system.createSuperAdmin).not.toHaveBeenCalled();
  });

  it('resets the authenticator of a super admin without asking for a password', async () => {
    const s = setup({ systemRole: 'SUPER_ADMIN' });
    await expect(s.run()).rejects.toThrow(/--reset-mfa/);
    const readPassword = vi.fn();
    const result = await s.run({ resetMfa: true, readPassword });
    expect(result.outcome).toBe('mfa_reset');
    expect(readPassword).not.toHaveBeenCalled();
    expect(s.audit.at(-1)).toMatchObject({ action: 'super_admin_mfa_reset' });

    await expect(setup({}).run({ resetMfa: true })).rejects.toThrow(/not a super admin/);
  });
});
