import { describe, expect, it } from 'vitest';
import { createPublicUrl } from '#src/lib/public-url';

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
