import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '#src/config';
import { testKeys } from './auth-fixtures';

const keys = testKeys();
/** As .env stores them: one line, newlines written as a literal backslash-n. */
const oneLine = (pem: string) => pem.trim().replaceAll('\n', '\\n');

const validEnv = {
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://orghive:orghive@localhost:5432/orghive',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'orghive',
  S3_ACCESS_KEY: 'orghive',
  S3_SECRET_KEY: 'orghive-dev-secret',
  PUBLIC_ASSET_BASE_URL: 'http://localhost:9000/orghive',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'no-reply@orghive.local',
  JWT_PRIVATE_KEY: oneLine(keys.privateKeyPem),
  JWT_PUBLIC_KEY: oneLine(keys.publicKeyPem),
};

function configErrorFrom(env: NodeJS.ProcessEnv): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('Expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('parses a valid env and applies defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.PORT).toBe(4000);
    expect(config.NODE_ENV).toBe('development');
    expect(config.SMTP_PORT).toBe(1025);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('names every missing variable', () => {
    const { WEB_ORIGIN: _web, DATABASE_URL: _db, ...rest } = validEnv;
    const issues = configErrorFrom(rest).issues.join('\n');
    expect(issues).toMatch(/WEB_ORIGIN/);
    expect(issues).toMatch(/DATABASE_URL/);
  });

  it('restores PEM newlines and defaults TRUST_PROXY to off', () => {
    const config = loadConfig(validEnv);
    expect(config.JWT_PRIVATE_KEY).toBe(keys.privateKeyPem.trim());
    expect(config.JWT_PUBLIC_KEY.split('\n').length).toBeGreaterThan(2);
    expect(config.TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...validEnv, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
  });

  it('refuses TRUST_PROXY=true and keys that are not PEM', () => {
    const issues = configErrorFrom({
      ...validEnv,
      TRUST_PROXY: 'true',
      JWT_PUBLIC_KEY: 'not-a-key',
    }).issues.join('\n');
    expect(issues).toMatch(/TRUST_PROXY/);
    expect(issues).toMatch(/JWT_PUBLIC_KEY/);
    expect(issues).not.toContain('not-a-key');
  });

  it('rejects invalid values without echoing them', () => {
    const secret = 'not-a-url-but-maybe-secret';
    const err = configErrorFrom({ ...validEnv, DATABASE_URL: secret, PORT: '99999' });
    expect(err.message).toMatch(/DATABASE_URL/);
    expect(err.message).toMatch(/PORT/);
    expect(err.message).not.toContain(secret);
  });
});
