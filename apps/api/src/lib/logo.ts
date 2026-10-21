import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { COVER_MIN_WIDTH, LOGO_MIME_TYPES, LOGO_MIN_WIDTH } from '@orghive/shared';
import { logoVariantKey } from './public-url';

/** Widths for srcset. Never larger than the source: upscaling adds bytes, not detail. */
const LOGO_WIDTHS = [128, 256, 512, 1024];

/** Logos are public and content-addressed, so CDNs may keep them forever. */
export const LOGO_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface ProcessedLogo {
  /** `logos/<slug>-<hash>.webp`: a replaced logo gets a new URL. */
  key: string;
  widths: number[];
  /** The full-size WebP and each resized copy, keyed for storage. */
  files: { key: string; body: Buffer }[];
}

export class LogoRejectedError extends Error {}

export function logoWidthsFor(sourceWidth: number): number[] {
  const widths = LOGO_WIDTHS.filter((w) => w < sourceWidth);
  return [...widths, Math.min(sourceWidth, LOGO_WIDTHS.at(-1)!)];
}

/** Cover widths for srcset; the largest is also the cap for the stored original. */
const COVER_WIDTHS = [640, 1280, 1920, 2400];

interface ImageRules {
  /** Storage key without the hash and extension, e.g. `logos/jpice`. */
  keyBase: string;
  minWidth: number;
  label: string;
  widths: (sourceWidth: number) => number[];
  /** Centre-crop to a square first (logos from the profile editor, already cropped there). */
  square?: boolean;
  /** Shrink anything wider than this before storing it. */
  maxWidth?: number;
}

async function processPublicImage(body: Buffer, rules: ImageRules): Promise<ProcessedLogo> {
  const type = await fileTypeFromBuffer(body);
  if (!type || !(LOGO_MIME_TYPES as readonly string[]).includes(type.mime)) {
    throw new LogoRejectedError('Upload a PNG, JPEG or WebP image');
  }
  const meta = await sharp(body).metadata();
  if (!meta.width || !meta.height || meta.width < rules.minWidth) {
    throw new LogoRejectedError(`The ${rules.label} must be at least ${rules.minWidth} pixels wide`);
  }

  // Normalise once (orientation, square crop, size cap); every copy is made from this.
  let base = sharp(body).rotate();
  let width = meta.width;
  if (rules.square) {
    width = Math.min(meta.width, meta.height);
    base = base.resize({ width, height: width, fit: 'cover', position: 'centre' });
  }
  if (rules.maxWidth && width > rules.maxWidth) {
    base = base.resize({ width: rules.maxWidth });
    width = rules.maxWidth;
  }
  const source = await base.png().toBuffer();

  const original = await sharp(source).webp({ quality: 90 }).toBuffer();
  const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
  const key = `${rules.keyBase}-${hash}.webp`;
  const widths = rules.widths(width);
  const files = [{ key, body: original }];
  for (const w of widths) {
    files.push({
      key: logoVariantKey(key, w),
      body: await sharp(source).resize({ width: w }).webp({ quality: 82 }).toBuffer(),
    });
  }
  return { key, widths, files };
}

/**
 * Checks an uploaded logo by its bytes (not its name or declared type) and turns it into
 * WebP files for the public `logos/` prefix: the original size plus srcset variants.
 * `square` centre-crops it first, so it sits in the HexFrame as the editor showed it.
 */
export function processLogo(
  slug: string,
  body: Buffer,
  { square = false }: { square?: boolean } = {},
): Promise<ProcessedLogo> {
  return processPublicImage(body, {
    keyBase: `logos/${slug}`,
    minWidth: LOGO_MIN_WIDTH,
    label: 'logo',
    widths: logoWidthsFor,
    square,
  });
}

/** A profile cover: same checks as a logo, stored under `logos/covers/`, at most 2400px wide. */
export function processCover(slug: string, body: Buffer): Promise<ProcessedLogo> {
  return processPublicImage(body, {
    keyBase: `logos/covers/${slug}`,
    minWidth: COVER_MIN_WIDTH,
    label: 'cover image',
    widths: (w) => [...COVER_WIDTHS.filter((c) => c < w), Math.min(w, COVER_WIDTHS.at(-1)!)],
    maxWidth: COVER_WIDTHS.at(-1),
  });
}
