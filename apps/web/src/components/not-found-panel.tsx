import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { siteSeo } from '@orghive/shared';
import { HexFrame } from './hex-frame';
import { PillButton } from './pill-button';
import { Seo } from './seo';

export interface NotFoundPanelProps {
  title: string;
  message: string;
  action: { label: string; to: string };
}

/**
 * A friendly dead end: an empty hexagon where the logo would be, what happened, and the
 * nearest place to continue from. Kept out of search results.
 */
export function NotFoundPanel({ title, message, action }: NotFoundPanelProps) {
  return (
    <main className="bg-surface-sweep flex min-h-page flex-col items-center justify-center px-4 py-16 text-center">
      <Seo seo={{ ...siteSeo(), title: `${title} | Orghive`, description: message }} noindex />
      <HexFrame className="w-40 sm:w-48" contentClassName="p-[30%]">
        <SearchX aria-hidden="true" className="size-full text-white" strokeWidth={1.5} />
      </HexFrame>
      <h1 className="mt-10 text-h1 font-bold text-balance text-ink">{title}</h1>
      <p className="mt-4 max-w-md text-body-lg text-pretty text-ink">{message}</p>
      <PillButton asChild size="lg" className="mt-10">
        <Link to={action.to}>{action.label}</Link>
      </PillButton>
    </main>
  );
}
