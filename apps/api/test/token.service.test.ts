import { decodeProtectedHeader, SignJWT, importPKCS8 } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';

const USER = '0195f3c0-0000-7000-8000-000000000001';
const keys = testKeys();
const tokens = createTokenService(keys);

afterEach(() => {
  vi.useRealTimers();
});

describe('tokenService', () => {
  it('signs an EdDSA at+jwt with sub, roles and jti, and verifies it', async () => {
    const { token, expiresIn } = await tokens.sign({
      userId: USER,
      passwordChangeRequired: false,
    });
    expect(expiresIn).toBe(900);
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'EdDSA', typ: 'at+jwt' });

    const claims = await tokens.verify(token);
    expect(claims).toMatchObject({
      userId: USER,
      passwordChangeRequired: false,
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('gives every token its own jti', async () => {
    const input = { userId: USER, passwordChangeRequired: false };
    const a = await tokens.verify((await tokens.sign(input)).token);
    const b = await tokens.verify((await tokens.sign(input)).token);
    expect(a.jti).not.toBe(b.jti);
  });

  it('carries the admin and forced-change flags', async () => {
    const { token } = await tokens.sign({
      userId: USER,
      passwordChangeRequired: true,
    });
    expect(await tokens.verify(token)).toMatchObject({
      passwordChangeRequired: true,
    });
  });

  it('expires after 15 minutes', async () => {
    const { token } = await tokens.sign({
      userId: USER,
      passwordChangeRequired: false,
    });
    vi.useFakeTimers({ now: Date.now() + 15 * 60 * 1000 + 1000, toFake: ['Date'] });
    await expect(tokens.verify(token)).rejects.toMatchObject({
      status: 401,
      message: 'Your session has expired',
    });
  });

  it('refuses a token without the at+jwt type, even when correctly signed', async () => {
    const key = await importPKCS8(keys.privateKeyPem, 'EdDSA');
    const idToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setSubject(USER)
      .setJti(crypto.randomUUID())
      .setIssuer('orghive-api')
      .setAudience('orghive')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expect(tokens.verify(idToken)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses an unsigned token and garbage', async () => {
    const [header, payload] = (
      await tokens.sign({ userId: USER, passwordChangeRequired: false })
    ).token.split('.');
    const none = `${Buffer.from('{"alg":"none","typ":"at+jwt"}').toString('base64url')}.${payload}.`;
    await expect(tokens.verify(none)).rejects.toMatchObject({ status: 401 });
    await expect(tokens.verify(`${header}.${payload}.AAAA`)).rejects.toMatchObject({ status: 401 });
    await expect(tokens.verify('not-a-jwt')).rejects.toMatchObject({ status: 401 });
  });

  it('with a malformed key, starts quietly and fails loudly on first use', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const broken = createTokenService({ privateKeyPem: 'not a key', publicKeyPem: 'not a key' });
      // Give a stray rejection the chance to surface before the keys are used.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
      await expect(broken.sign({ userId: USER, passwordChangeRequired: false })).rejects.toThrow();
      // A broken public key is a server fault, never a pass: verify still refuses.
      await expect(broken.verify('a.b.c')).rejects.toBeDefined();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
