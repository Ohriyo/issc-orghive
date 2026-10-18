import { describe, expect, it } from 'vitest';
import {
  createCollegeRequestSchema,
  createOrganizationRequestSchema,
  reorderRequestSchema,
  updateCollegeRequestSchema,
  updateOrganizationRequestSchema,
} from './admin';

describe('createCollegeRequestSchema', () => {
  it('accepts a college and trims its fields', () => {
    expect(
      createCollegeRequestSchema.parse({
        code: ' CoED ',
        slug: 'coed',
        name: ' College of Education ',
      }),
    ).toEqual({ code: 'CoED', slug: 'coed', name: 'College of Education' });
  });

  it('refuses codes with digits or spaces, bad slugs and unknown keys', () => {
    const base = { code: 'CEA', slug: 'cea', name: 'College of Engineering' };
    expect(createCollegeRequestSchema.safeParse({ ...base, code: 'CE1' }).success).toBe(false);
    expect(createCollegeRequestSchema.safeParse({ ...base, slug: 'C E A' }).success).toBe(false);
    expect(createCollegeRequestSchema.safeParse({ ...base, position: 3 }).success).toBe(false);
  });
});

describe('organization requests', () => {
  it('creates only CSCs and SBOs, never another ISSC', () => {
    const base = {
      collegeSlug: 'cea',
      slug: 'uapsa',
      acronym: 'UAPSA',
      name: 'UAP Student Auxiliary',
    };
    expect(createOrganizationRequestSchema.safeParse({ ...base, type: 'SBO' }).success).toBe(true);
    expect(createOrganizationRequestSchema.safeParse({ ...base, type: 'ISSC' }).success).toBe(
      false,
    );
  });

  it('never changes a slug, and needs at least one field', () => {
    expect(updateOrganizationRequestSchema.safeParse({ slug: 'new' }).success).toBe(false);
    expect(updateOrganizationRequestSchema.safeParse({}).success).toBe(false);
    expect(updateCollegeRequestSchema.safeParse({ motto: null }).success).toBe(true);
  });
});

describe('reorderRequestSchema', () => {
  it('needs each slug once', () => {
    expect(reorderRequestSchema.safeParse({ slugs: ['cea', 'cat'] }).success).toBe(true);
    expect(reorderRequestSchema.safeParse({ slugs: ['cea', 'cea'] }).success).toBe(false);
    expect(reorderRequestSchema.safeParse({ slugs: [] }).success).toBe(false);
  });
});
