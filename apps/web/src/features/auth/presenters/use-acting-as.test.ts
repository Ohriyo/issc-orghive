import { afterEach, describe, expect, it, vi } from 'vitest';
import { readActingAs, rememberActingAs } from './use-acting-as';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the remembered "Acting as" name', () => {
  it('is kept per account on this device', () => {
    rememberActingAs('account-1', 'Juan Dela Cruz');
    expect(readActingAs('account-1')).toBe('Juan Dela Cruz');
    expect(readActingAs('account-2')).toBe('');
    expect(readActingAs(undefined)).toBe('');
  });

  it('is simply asked again when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberActingAs('account-1', 'Juan')).not.toThrow();
    expect(readActingAs('account-1')).toBe('');
  });
});
