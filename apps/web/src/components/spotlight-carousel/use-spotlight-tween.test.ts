import { describe, expect, it } from 'vitest';
import { spotlightStyle } from './use-spotlight-tween';

describe('spotlightStyle', () => {
  it('shows the centered slide at full size, opaque and sharp', () => {
    for (const variant of ['tower', 'hex'] as const) {
      expect(spotlightStyle(variant, 0, false)).toMatchObject({
        scale: 1,
        translateY: 0,
        opacity: 1,
        blur: 0,
      });
    }
  });

  it('shrinks, fades and blurs neighbours more the further they are', () => {
    const near = spotlightStyle('tower', 1, false);
    const far = spotlightStyle('tower', 2, false);
    expect(near.scale).toBeLessThan(1);
    expect(far.opacity).toBeLessThan(near.opacity);
    expect(far.blur).toBeGreaterThan(near.blur);
    expect(far.zIndex).toBeLessThan(near.zIndex);
  });

  it('drops hex neighbours down so they tuck behind the centered hexagon', () => {
    expect(spotlightStyle('hex', 1, false).translateY).toBeGreaterThan(30);
  });

  it('never blurs with reduced motion', () => {
    expect(spotlightStyle('tower', 1, true).blur).toBe(0);
    expect(spotlightStyle('hex', 2, true).blur).toBe(0);
  });
});
