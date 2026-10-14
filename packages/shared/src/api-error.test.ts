import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema } from './api-error';

describe('apiErrorBodySchema', () => {
  it('accepts the standard error shape', () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Not found' } };
    expect(apiErrorBodySchema.parse(body)).toEqual(body);
  });

  it('rejects bodies without an error object', () => {
    expect(apiErrorBodySchema.safeParse({ message: 'nope' }).success).toBe(false);
  });
});
