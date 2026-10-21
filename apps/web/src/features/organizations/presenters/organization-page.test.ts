import { describe, expect, it } from 'vitest';
import type { OrganizationDetail } from '@orghive/shared';
import { toOrganizationPage } from './use-organization-page';

const JPICE: OrganizationDetail = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  type: 'SBO',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'Junior Philippine Institute of Civil Engineers',
  description: 'The JPICE is a dynamic organization.',
  logoUrl: 'https://cdn.test/jpice.png',
  logoSrcSet: null,
  parent: null,
  college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  mission: null,
  vision: null,
  contactEmail: null,
  links: [],
  officers: [],
  coverUrl: null,
  coverSrcSet: null,
};

describe('toOrganizationPage', () => {
  it('shapes the profile, Paperworks link and SEO', () => {
    const page = toOrganizationPage(JPICE);
    expect(page).toMatchObject({
      acronym: 'JPICE',
      name: JPICE.name,
      logoSrc: JPICE.logoUrl,
      paperworksHref: '/orgs/jpice/paperworks',
      context: {
        lead: 'A student body organization of the',
        college: { name: 'College of Engineering and Architecture', href: '/colleges/cea' },
      },
    });
    expect(page.description?.filter((s) => s.strong).map((s) => s.text)).toEqual(['JPICE']);
    expect(page.seo.path).toBe('/orgs/jpice');
  });

  it('names a CSC as its college council, and gives the ISSC no college line', () => {
    expect(toOrganizationPage({ ...JPICE, type: 'CSC' }).context?.lead).toBe(
      'The Collegiate Student Council of the',
    );
    expect(toOrganizationPage({ ...JPICE, type: 'ISSC', college: null }).context).toBeNull();
  });

  it('leaves out a missing description and logo', () => {
    const page = toOrganizationPage({
      ...JPICE,
      description: null,
      logoUrl: null,
      logoSrcSet: null,
    });
    expect(page.description).toBeNull();
    expect(page.logoSrc).toBeUndefined();
  });
});
