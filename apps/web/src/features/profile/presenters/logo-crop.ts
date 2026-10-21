import { LOGO_MAX_BYTES, LOGO_MIN_WIDTH } from '@orghive/shared';

/*
 * The logo cropper's geometry. The HexFrame shows a logo as a square, centred with room
 * around it, so the crop is a square: the image is panned and zoomed under a square window
 * and exactly that window is exported. Positions are in window widths, so they hold at any
 * on-screen size.
 */

export interface CropState {
  /** 1 = the whole image fits inside the window (nothing cut off); up to MAX_ZOOM. */
  zoom: number;
  /** Where the image's centre sits, from the window's centre, in window widths. */
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Arrow keys move the image by this many window widths; Shift moves it 5 times as far. */
export const KEY_STEP = 0.02;
/** The exported square: as sharp as the source allows, at most this many pixels a side. */
export const EXPORT_MAX = 1024;

export const INITIAL_CROP: CropState = { zoom: 1, x: 0, y: 0 };

/** The image's drawn size in window widths: at zoom 1 its longer side spans the window. */
export function drawnSize(natural: { width: number; height: number }, zoom: number) {
  const longer = Math.max(natural.width, natural.height);
  return { width: (natural.width / longer) * zoom, height: (natural.height / longer) * zoom };
}

/**
 * Keeps the image covering the window's centre: it can move until its edge reaches the
 * middle, never further, so the logo cannot be dragged out of the frame.
 */
export function clampCrop(state: CropState, natural: { width: number; height: number }): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom));
  const size = drawnSize(natural, zoom);
  const limitX = size.width / 2;
  const limitY = size.height / 2;
  return {
    zoom,
    x: Math.min(limitX, Math.max(-limitX, state.x)),
    y: Math.min(limitY, Math.max(-limitY, state.y)),
  };
}

/** The keyboard: arrows move, + and - zoom. Null for any other key. */
export function cropAfterKey(
  state: CropState,
  key: string,
  shift: boolean,
  natural: { width: number; height: number },
): CropState | null {
  const step = KEY_STEP * (shift ? 5 : 1);
  const moves: Record<string, Partial<CropState>> = {
    ArrowLeft: { x: state.x - step },
    ArrowRight: { x: state.x + step },
    ArrowUp: { y: state.y - step },
    ArrowDown: { y: state.y + step },
    '+': { zoom: state.zoom + 0.1 },
    '=': { zoom: state.zoom + 0.1 },
    '-': { zoom: state.zoom - 0.1 },
  };
  const move = moves[key];
  return move ? clampCrop({ ...state, ...move }, natural) : null;
}

/**
 * Where to draw the source on a square canvas of `side` pixels so the canvas shows exactly
 * the window. Transparent wherever the image does not reach (logos keep their alpha).
 */
export function exportRect(
  state: CropState,
  natural: { width: number; height: number },
  side: number,
) {
  const size = drawnSize(natural, state.zoom);
  const width = size.width * side;
  const height = size.height * side;
  return {
    x: side / 2 + state.x * side - width / 2,
    y: side / 2 + state.y * side - height / 2,
    width,
    height,
  };
}

/** The exported square's side: the window's width in source pixels, within the limits. */
export function exportSide(state: CropState, natural: { width: number; height: number }): number {
  const longer = Math.max(natural.width, natural.height);
  const sourcePixels = Math.round(longer / state.zoom);
  return Math.min(EXPORT_MAX, Math.max(LOGO_MIN_WIDTH * 2, sourcePixels));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Draws the window onto a canvas and encodes it: WebP where the browser can (smaller, with
 * transparency), PNG otherwise, halving the size until it is under the logo limit.
 */
export async function exportCrop(
  image: CanvasImageSource,
  natural: { width: number; height: number },
  state: CropState,
): Promise<Blob> {
  let side = exportSide(state, natural);
  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot crop images');
    context.imageSmoothingQuality = 'high';
    const rect = exportRect(state, natural, side);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    const blob = (await toBlob(canvas, 'image/webp', 0.92)) ?? (await toBlob(canvas, 'image/png'));
    if (!blob) throw new Error('This browser cannot crop images');
    if (blob.size <= LOGO_MAX_BYTES || side <= LOGO_MIN_WIDTH * 2) return blob;
    side = Math.round(side / 2);
  }
}
