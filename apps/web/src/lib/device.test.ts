import { describe, expect, it } from 'vitest';
import { isLowEndDevice } from './device';

describe('isLowEndDevice', () => {
  it('treats a device with plenty of cores and memory as capable', () => {
    expect(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 8 })).toBe(false);
  });

  it('treats unknown hints (Safari, Firefox) as capable', () => {
    expect(isLowEndDevice({})).toBe(false);
  });

  it('flags four or fewer cores', () => {
    expect(isLowEndDevice({ hardwareConcurrency: 4, deviceMemory: 8 })).toBe(true);
  });

  it('flags four GB of memory or less', () => {
    expect(isLowEndDevice({ hardwareConcurrency: 8, deviceMemory: 2 })).toBe(true);
  });

  it('flags Data Saver', () => {
    expect(isLowEndDevice({ hardwareConcurrency: 8, connection: { saveData: true } })).toBe(true);
  });
});
