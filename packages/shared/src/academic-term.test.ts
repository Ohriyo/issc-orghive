import { describe, expect, it } from 'vitest';
import { academicYearSchema } from './academic-term';
import { slugSchema } from './organization';

describe('academicYearSchema', () => {
  it('accepts consecutive years', () => {
    expect(academicYearSchema.safeParse('2026-2027').success).toBe(true);
  });

  it('rejects non-consecutive or malformed years', () => {
    expect(academicYearSchema.safeParse('2026-2028').success).toBe(false);
    expect(academicYearSchema.safeParse('26-27').success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('accepts lowercase hyphenated slugs', () => {
    expect(slugSchema.safeParse('csc-cea').success).toBe(true);
    expect(slugSchema.safeParse('icpep-se').success).toBe(true);
  });

  it('rejects uppercase, dots and double hyphens', () => {
    expect(slugSchema.safeParse('ICpEP.SE').success).toBe(false);
    expect(slugSchema.safeParse('csc--cea').success).toBe(false);
  });
});
