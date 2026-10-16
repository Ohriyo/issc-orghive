import { useState } from 'react';
import { initialsOf } from '@/lib/initials';
import { cn } from '@/lib/utils';

export interface OrgLogoProps {
  name: string;
  src?: string;
  /** Resized variants for the browser to pick from, e.g. "…-128.webp 128w, …-256.webp 256w". */
  srcSet?: string;
  /**
   * How wide the logo is drawn, for choosing from srcSet, e.g. "(width >= 64rem) 24rem, 60vw".
   * Required in practice whenever srcSet is given: the browser otherwise assumes 100vw.
   */
  sizes?: string;
  /** Defaults to "<name> logo". Pass "" when the name is already shown next to the logo. */
  alt?: string;
  /** Short name shown when the image is missing or fails, e.g. "CSC-CEA". Defaults to initials. */
  fallbackText?: string;
  /** The page's main image (above the fold): load it eagerly and first, for LCP. */
  priority?: boolean;
  className?: string;
}

/**
 * An organization logo for forest surfaces. When the image is missing or fails to load
 * (uploads can be removed or corrupt), it shows the organization's initials instead of a
 * broken-image icon, keeping the same accessible name.
 */
export function OrgLogo({
  name,
  src,
  srcSet,
  sizes,
  alt,
  fallbackText,
  priority = false,
  className,
}: OrgLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const label = alt ?? `${name} logo`;
  const decorative = label === '';

  if (!src || failedSrc === src) {
    const text = fallbackText ?? initialsOf(name);
    // An SVG keeps the seal round and centered in any box the caller gives it, and the
    // text scales with the seal, so it fits a 24 px badge and a 500 px hexagon alike.
    return (
      <span
        {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
        className={cn('block', className)}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true" className="size-full">
          <circle
            cx="50"
            cy="50"
            r="47"
            className="fill-none stroke-white/70"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-white font-bold"
            fontSize={text.length > 5 ? 14 : text.length > 3 ? 18 : 24}
          >
            {text}
          </text>
        </svg>
      </span>
    );
  }

  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      // Logos are square. The attributes only give the browser the aspect ratio before the
      // file arrives; the rendered size comes from className.
      width={512}
      height={512}
      alt={label}
      draggable={false}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : 'auto'}
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn('object-contain select-none', className)}
    />
  );
}
