import { Globe, Mail } from 'lucide-react';
import type { SocialKind } from '@orghive/shared';
import { cn } from '@/lib/utils';

/*
 * Small line icons for an organization's links. lucide dropped its brand icons, so these are
 * simple outline marks drawn on the same 24px grid and stroke as lucide's, enough to tell
 * the links apart; the link's text label always names the site too.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const MARKS: Record<Exclude<SocialKind, 'website'>, React.ReactNode> = {
  facebook: <path d="M15 3h-2.5A3.5 3.5 0 0 0 9 6.5V10H6.5v3.5H9V21h3.5v-7.5H15l.5-3.5h-3V7a1 1 0 0 1 1-1H15z" />,
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  tiktok: <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5M14 3c.5 2.8 2.4 4.6 5 5" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="m10 9.5 4.5 2.5-4.5 2.5z" />
    </>
  ),
  x: <path d="M4 4l16 16M20 4 4 20" />,
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M8 11v5M8 8h.01M12 16v-5M12 13a2 2 0 0 1 4 0v3" />
    </>
  ),
};

export function SocialIcon({
  kind,
  className,
}: {
  kind: SocialKind | 'email';
  className?: string;
}) {
  const classes = cn('size-5 shrink-0', className);
  if (kind === 'email') return <Mail aria-hidden="true" className={classes} />;
  if (kind === 'website') return <Globe aria-hidden="true" className={classes} />;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={classes} {...STROKE}>
      {MARKS[kind]}
    </svg>
  );
}
