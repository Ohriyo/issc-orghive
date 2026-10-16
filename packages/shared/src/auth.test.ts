import { describe, expect, it } from 'vitest';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
} from './auth';

describe('auth schemas', () => {
  it('normalizes the email once, for every comparison', () => {
    expect(loginRequestSchema.parse({ email: '  Juan@NwSSU.edu.ph ', password: 'x' }).email).toBe(
      'juan@nwssu.edu.ph',
    );
  });

  it('bounds passwords: any length at login, 12 to 128 for a new one', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@b.ph', password: 'short' }).success).toBe(true);
    expect(
      loginRequestSchema.safeParse({ email: 'a@b.ph', password: 'x'.repeat(129) }).success,
    ).toBe(false);
    const token = 'A'.repeat(43);
    expect(
      resetPasswordRequestSchema.safeParse({ token, newPassword: 'elevenchars' }).success,
    ).toBe(false);
    expect(
      resetPasswordRequestSchema.safeParse({ token, newPassword: 'twelve chars' }).success,
    ).toBe(true);
  });

  it('accepts only well-formed reset tokens', () => {
    const newPassword = 'a long passphrase';
    expect(resetPasswordRequestSchema.safeParse({ token: 'abc', newPassword }).success).toBe(false);
    expect(
      resetPasswordRequestSchema.safeParse({ token: `${'A'.repeat(42)}!`, newPassword }).success,
    ).toBe(false);
  });

  it('refuses a new password equal to the current one', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: 'same passphrase!',
      newPassword: 'same passphrase!',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['newPassword']);
  });
});
