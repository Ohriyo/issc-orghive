import { describe, expect, it } from 'vitest';
import { createPageTokenService, PAGE_TOKEN_TTL_SECONDS } from '#src/services/page-token.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';

const DOC = '0199f0a0-0000-7000-8000-000000000001';
const VER = '0199f0a0-0000-7000-8000-000000000002';

function clocked(start = new Date('2026-10-20T00:00:00Z')) {
  let now = start;
  const service = createPageTokenService({ ...testKeys(), now: () => now });
  return {
    service,
    advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)),
  };
}

describe('pageTokenService', () => {
  it('grants one version of one document for 5 minutes', async () => {
    const { service } = clocked();
    const { token, expiresAt } = await service.sign({ documentId: DOC, versionId: VER });
    expect(expiresAt.toISOString()).toBe('2026-10-20T00:05:00.000Z');
    expect(await service.verify(token)).toEqual({ documentId: DOC, versionId: VER });
  });

  it('refuses an expired token with 403', async () => {
    const { service, advance } = clocked();
    const { token } = await service.sign({ documentId: DOC, versionId: VER });
    advance(PAGE_TOKEN_TTL_SECONDS - 1);
    await expect(service.verify(token)).resolves.toBeTruthy();
    advance(2);
    await expect(service.verify(token)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('expired') as unknown,
    });
  });

  it('never accepts an access token, and an access token never accepts it', async () => {
    const { service } = clocked(new Date());
    const tokens = createTokenService(testKeys());
    const access = await tokens.sign({ userId: DOC, passwordChangeRequired: false });
    await expect(service.verify(access.token)).rejects.toMatchObject({ status: 403 });
    const { token } = await service.sign({ documentId: DOC, versionId: VER });
    await expect(tokens.verify(token)).rejects.toMatchObject({ status: 401 });
  });

  it('fails loudly on a bad signing key, and opens nothing with a bad public key', async () => {
    const broken = createPageTokenService({ privateKeyPem: 'nope', publicKeyPem: 'nope' });
    await expect(broken.sign({ documentId: DOC, versionId: VER })).rejects.toThrow();
    await expect(broken.verify('a.b.c')).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a tampered or garbage token', async () => {
    const { service } = clocked();
    const { token } = await service.sign({ documentId: DOC, versionId: VER });
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: VER, ver: VER })).toString('base64url');
    await expect(service.verify(`${header}.${forged}.${signature}`)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.verify('not-a-token')).rejects.toMatchObject({ status: 403 });
  });
});
