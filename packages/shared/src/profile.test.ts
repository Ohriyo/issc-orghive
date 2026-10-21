import { describe, expect, it } from 'vitest';
import {
  profileFieldsSchema,
  socialLinkOf,
  uploadConstitutionRequestSchema,
  updateProfileRequestSchema,
} from './profile';

const FIELDS = {
  description: 'Civil engineering students.',
  mission: '',
  vision: '  ',
  contactEmail: '',
  facebookUrl: '',
  links: [],
  officers: [{ position: 'President', name: 'Ana Reyes' }],
};

describe('socialLinkOf', () => {
  it('names known hosts and treats anything else as a website', () => {
    expect(socialLinkOf('https://www.facebook.com/jpice')).toEqual({
      kind: 'facebook',
      label: 'Facebook',
    });
    expect(socialLinkOf('https://m.facebook.com/jpice').kind).toBe('facebook');
    expect(socialLinkOf('https://vt.tiktok.com/x').kind).toBe('tiktok');
    expect(socialLinkOf('https://youtu.be/abc').kind).toBe('youtube');
    expect(socialLinkOf('https://twitter.com/jpice').label).toBe('X');
    expect(socialLinkOf('https://www.jpice.example.org/about')).toEqual({
      kind: 'website',
      label: 'jpice.example.org',
    });
  });

  it('is not fooled by a lookalike host', () => {
    expect(socialLinkOf('https://notfacebook.com/x').kind).toBe('website');
    expect(socialLinkOf('https://facebook.com.evil.test/x').kind).toBe('website');
  });
});

describe('profileFieldsSchema', () => {
  it('stores blank text as null and shows officers publicly by default', () => {
    expect(profileFieldsSchema.parse(FIELDS)).toEqual({
      ...FIELDS,
      mission: null,
      vision: null,
      contactEmail: null,
      facebookUrl: null,
      officers: [{ position: 'President', name: 'Ana Reyes', isPublic: true }],
    });
  });

  it('wants a Facebook page in its field and https links elsewhere, each once', () => {
    const bad = [
      { facebookUrl: 'https://instagram.com/jpice' },
      { links: ['https://facebook.com/jpice'] },
      { links: ['http://jpice.example.org'] },
      { links: ['https://a.test', 'https://a.test'] },
      { contactEmail: 'not an email' },
    ];
    for (const patch of bad) {
      expect(profileFieldsSchema.safeParse({ ...FIELDS, ...patch }).success).toBe(false);
    }
  });

  it('rejects official fields and needs who is acting on save', () => {
    expect(profileFieldsSchema.safeParse({ ...FIELDS, name: 'Renamed' }).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse(FIELDS).success).toBe(false);
    expect(updateProfileRequestSchema.safeParse({ ...FIELDS, actingAs: 'Ana' }).success).toBe(true);
  });
});

describe('uploadConstitutionRequestSchema', () => {
  const key = `uploads/${'0'.repeat(8)}-0000-7000-8000-${'0'.repeat(12)}/${'1'.repeat(8)}-1111-7111-8111-${'1'.repeat(12)}`;

  it('takes a date and an optional note', () => {
    expect(
      uploadConstitutionRequestSchema.parse({ uploadKey: key, actingAs: 'Ana', amendedOn: '2026-08-01' })
        .note,
    ).toBeUndefined();
    expect(
      uploadConstitutionRequestSchema.parse({
        uploadKey: key,
        actingAs: 'Ana',
        amendedOn: '2026-08-01',
        note: '  ',
      }).note,
    ).toBeNull();
    expect(
      uploadConstitutionRequestSchema.safeParse({ uploadKey: key, actingAs: 'Ana', amendedOn: '1 Aug' })
        .success,
    ).toBe(false);
  });
});
