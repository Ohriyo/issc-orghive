import { createHash } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { LOGO_MIME_TYPES, LOGO_MIN_WIDTH } from '@orghive/shared';
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

/**
 * Checks an uploaded logo by its bytes (not its name or declared type) and turns it into
 * WebP files for the public `logos/` prefix: the original size plus srcset variants.
 */
export async function processLogo(slug: string, body: Buffer): Promise<ProcessedLogo> {
  const type = await fileTypeFromBuffer(body);
  if (!type || !(LOGO_MIME_TYPES as readonly string[]).includes(type.mime)) {
    throw new LogoRejectedError('Upload a PNG, JPEG or WebP image');
  }
  const { width } = await sharp(body).metadata();
  if (!width || width < LOGO_MIN_WIDTH) {
    throw new LogoRejectedError(`The logo must be at least ${LOGO_MIN_WIDTH} pixels wide`);
  }

  const original = await sharp(body).webp({ quality: 90 }).toBuffer();
  const hash = createHash('sha256').update(original).digest('hex').slice(0, 12);
  const key = `logos/${slug}-${hash}.webp`;
  const widths = logoWidthsFor(width);
  const files = [{ key, body: original }];
  for (const w of widths) {
    files.push({
      key: logoVariantKey(key, w),
      body: await sharp(body).resize({ width: w }).webp({ quality: 82 }).toBuffer(),
    });
  }
  return { key, widths, files };
}
