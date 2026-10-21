import { describe, expect, it } from 'vitest';
import {
  clampCrop,
  cropAfterKey,
  drawnSize,
  EXPORT_MAX,
  exportRect,
  exportSide,
  INITIAL_CROP,
  MAX_ZOOM,
} from './logo-crop';

const WIDE = { width: 400, height: 200 };

describe('logo crop geometry', () => {
  it('fits the whole image at zoom 1, longer side across the window', () => {
    expect(drawnSize(WIDE, 1)).toEqual({ width: 1, height: 0.5 });
    expect(drawnSize(WIDE, 2)).toEqual({ width: 2, height: 1 });
  });

  it('keeps zoom in range and the image over the window centre', () => {
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, WIDE).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, WIDE).zoom).toBe(1);
    expect(clampCrop({ zoom: 1, x: 3, y: -3 }, WIDE)).toEqual({ zoom: 1, x: 0.5, y: -0.25 });
  });

  it('moves with arrow keys (further with Shift), zooms with + and -, ignores other keys', () => {
    expect(cropAfterKey(INITIAL_CROP, 'ArrowRight', false, WIDE)).toEqual({
      zoom: 1,
      x: 0.02,
      y: 0,
    });
    expect(cropAfterKey(INITIAL_CROP, 'ArrowUp', true, WIDE)?.y).toBeCloseTo(-0.1);
    expect(cropAfterKey(INITIAL_CROP, '+', false, WIDE)?.zoom).toBeCloseTo(1.1);
    expect(cropAfterKey(INITIAL_CROP, '-', false, WIDE)?.zoom).toBe(1);
    expect(cropAfterKey(INITIAL_CROP, 'a', false, WIDE)).toBeNull();
  });

  it('draws the source so the canvas shows exactly the window', () => {
    // Zoom 1, centred: the 2:1 image spans the width, centred vertically.
    expect(exportRect(INITIAL_CROP, WIDE, 100)).toEqual({ x: 0, y: 25, width: 100, height: 50 });
    // Moved a quarter window to the right.
    expect(exportRect({ zoom: 1, x: 0.25, y: 0 }, WIDE, 100).x).toBe(25);
  });

  it('exports as sharp as the source allows, within the limits', () => {
    expect(exportSide(INITIAL_CROP, WIDE)).toBe(400);
    expect(exportSide({ zoom: 4, x: 0, y: 0 }, WIDE)).toBe(256);
    expect(exportSide(INITIAL_CROP, { width: 5000, height: 3000 })).toBe(EXPORT_MAX);
  });
});
