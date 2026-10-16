import { describe, expect, it } from 'vitest';
import {
  collegeSeo,
  DEFAULT_OG_IMAGE_PATH,
  META_DESCRIPTION_MAX,
  organizationSeo,
  truncateDescription,
} from './seo';

const CEA_REF = { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' };

const JPICE = {
  type: 'SBO' as const,
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: 'The JPICE shapes competent civil engineering students.',
  logoUrl: 'https://cdn.test/logos/jpice.png',
  college: CEA_REF,
};

describe('truncateDescription', () => {
  it('leaves short text alone and collapses whitespace', () => {
    expect(truncateDescription('  Hello\n  world ')).toBe('Hello world');
  });

  it('cuts long text at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(60);
    const out = truncateDescription(long);
    expect(out.length).toBeLessThanOrEqual(META_DESCRIPTION_MAX);
    expect(out.endsWith('word…')).toBe(true);
  });
});

describe('organizationSeo', () => {
  it('uses the name, acronym, description and logo', () => {
    expect(organizationSeo(JPICE)).toEqual({
      title: 'Junior Philippine Institute of Civil Engineers (JPICE) | Orghive',
      description: JPICE.description,
      path: '/orgs/jpice',
      image: JPICE.logoUrl,
      imageAlt: 'Junior Philippine Institute of Civil Engineers logo',
    });
  });

  it('describes an SBO from its college and uses the default image when it has none', () => {
    const seo = organizationSeo({ ...JPICE, description: null, logoUrl: null });
    expect(seo.description).toContain(
      'a student body organization of the College of Engineering and Architecture',
    );
    expect(seo.image).toBe(DEFAULT_OG_IMAGE_PATH);
  });

  it('names the CSC level for a collegiate council', () => {
    const seo = organizationSeo({
      ...JPICE,
      type: 'CSC',
      slug: 'csc-cea',
      acronym: 'CSC-CEA',
      description: null,
    });
    expect(seo.description).toContain(
      'the Collegiate Student Council of the College of Engineering and Architecture',
    );
  });
});

describe('collegeSeo', () => {
  it('uses the CSC logo for the college', () => {
    const seo = collegeSeo({
      slug: 'cea',
      name: CEA_REF.name,
      motto: null,
      description: null,
      csc: { ...JPICE, type: 'CSC', name: 'CSC of CEA', logoUrl: 'https://cdn.test/csc.png' },
    });
    expect(seo.title).toBe('College of Engineering and Architecture | Orghive');
    expect(seo.path).toBe('/colleges/cea');
    expect(seo.image).toBe('https://cdn.test/csc.png');
    expect(seo.imageAlt).toBe('CSC of CEA logo');
  });
});
