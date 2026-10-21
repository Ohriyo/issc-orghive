import { describe, expect, it } from 'vitest';
import type { OrganizationProfile } from '@orghive/shared';
import { ApiError } from '@/lib/api';
import { errorMessage, toFormValues, toPreviewDetail } from './use-profile-editor';

const ORG = {
  id: '0195f3c0-0000-7000-8000-0000000000b1',
  slug: 'jpice',
  acronym: 'JPICE',
  name: 'JPICE',
};
const PROFILE: OrganizationProfile = {
  slug: 'jpice',
  official: {
    name: 'Junior Philippine Institute of Civil Engineers',
    acronym: 'JPICE',
    type: 'SBO',
    college: { code: 'CEA', slug: 'cea', name: 'College of Engineering and Architecture' },
  },
  description: 'Civil engineering students.',
  mission: null,
  vision: null,
  contactEmail: null,
  facebookUrl: 'https://facebook.com/jpice',
  links: [{ url: 'https://instagram.com/jpice', kind: 'instagram', label: 'Instagram' }],
  officers: [{ position: 'Treasurer', name: 'Ben Cruz', isPublic: false }],
  logoUrl: 'https://cdn.test/logos/jpice.webp',
  coverUrl: null,
  updatedAt: '2026-10-21T00:00:00.000Z',
};

describe('toFormValues', () => {
  it('holds blanks as empty boxes and links as plain addresses', () => {
    expect(toFormValues(PROFILE)).toMatchObject({
      mission: '',
      contactEmail: '',
      facebookUrl: 'https://facebook.com/jpice',
      links: ['https://instagram.com/jpice'],
      officers: PROFILE.officers,
    });
  });
});

describe('toPreviewDetail', () => {
  it('previews the public page: official fields kept, blanks empty, hidden officers left out', () => {
    const detail = toPreviewDetail(
      ORG,
      PROFILE,
      {
        description: '  ',
        mission: 'Shape engineers.',
        vision: '',
        contactEmail: '',
        facebookUrl: 'https://facebook.com/jpice',
        links: ['https://instagram.com/jpice', 'https://unfinish'],
        officers: [
          { position: 'President', name: 'Ana Reyes', isPublic: true },
          { position: 'Treasurer', name: 'Ben Cruz', isPublic: false },
          { position: '', name: '' },
        ],
      },
      { logo: 'blob:logo', cover: null },
    );
    expect(detail).toMatchObject({
      acronym: 'JPICE',
      name: PROFILE.official.name,
      description: null,
      mission: 'Shape engineers.',
      vision: null,
      logoUrl: 'blob:logo',
      officers: [{ position: 'President', name: 'Ana Reyes' }],
    });
    expect(detail.links.map((l) => l.kind)).toEqual(['facebook', 'instagram']);
  });
});

describe('errorMessage', () => {
  it('drops the field prefix of a refusal and hides server faults', () => {
    expect(
      errorMessage(new ApiError(400, 'VALIDATION_ERROR', 'logo: The logo must be wider')),
    ).toBe('The logo must be wider');
    expect(errorMessage(new ApiError(500, 'INTERNAL', 'boom'))).toMatch(/our side/);
  });
});
