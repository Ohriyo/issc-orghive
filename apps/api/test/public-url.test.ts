import { describe, expect, it } from 'vitest';
import { createPublicUrl, logoSrcSet, logoVariantKey } from '#src/lib/public-url';

describe('createPublicUrl', () => {
  const publicUrl = createPublicUrl('https://cdn.example/orghive/');

  it('joins the base URL and a logos/ key', () => {
    expect(publicUrl('logos/csc cea.png')).toBe('https://cdn.example/orghive/logos/csc%20cea.png');
  });

  it('returns null for a missing key', () => {
    expect(publicUrl(null)).toBeNull();
  });

  it('never exposes keys outside the public logos/ prefix', () => {
    expect(publicUrl('documents/secret.pdf')).toBeNull();
  });
});

describe('logoSrcSet', () => {
  const publicUrl = createPublicUrl('https://cdn.example');

  it('lists each resized variant, smallest first', () => {
    expect(logoVariantKey('logos/issc-ab12.webp', 256)).toBe('logos/issc-ab12-256.webp');
    expect(logoSrcSet(publicUrl, 'logos/issc-ab12.webp', [512, 128, 256])).toBe(
      'https://cdn.example/logos/issc-ab12-128.webp 128w, ' +
        'https://cdn.example/logos/issc-ab12-256.webp 256w, ' +
        'https://cdn.example/logos/issc-ab12-512.webp 512w',
    );
  });

  it('is null without a logo, without variants, or for a non-webp key', () => {
    expect(logoSrcSet(publicUrl, null, [128])).toBeNull();
    expect(logoSrcSet(publicUrl, 'logos/issc-ab12.webp', [])).toBeNull();
    expect(logoSrcSet(publicUrl, 'logos/issc.png', [128])).toBeNull();
  });

  it('never builds URLs outside the public logos/ prefix', () => {
    expect(logoSrcSet(publicUrl, 'documents/x.webp', [128])).toBeNull();
  });
});
