import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { HexFrame } from '@/components/hex-frame';
import { WaveDivider } from '@/components/wave-divider';

export interface AuthLayoutProps {
  /** Document title, e.g. "Sign in". */
  title: string;
  heading: string;
  /** One or two plain sentences under the heading. */
  intro?: ReactNode;
  children: ReactNode;
}

/**
 * Shared frame of the sign-in screens, in the organization page's language: wave bands top
 * and bottom, the Orghive mark in a framed hexagon, and the form on the open surface.
 */
export function AuthLayout({ title, heading, intro, children }: AuthLayoutProps) {
  return (
    <div className="bg-surface-sweep relative isolate flex min-h-page flex-col overflow-hidden">
      <title>{`${title} | Orghive`}</title>
      <meta name="robots" content="noindex" />
      <WaveDivider className="pointer-events-none absolute inset-x-0 top-0 -z-10 -translate-y-[45%]" />
      <WaveDivider className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 translate-y-[55%] rotate-180" />

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-center items-center gap-10 px-4 pt-[calc(10vw+2rem)] pb-[calc(9vw+3rem)] sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-20 lg:px-12">
        {/* Decorative: the header's logo is the way home. */}
        <div aria-hidden="true" className="mx-auto block w-28 sm:w-36 lg:w-full lg:max-w-[26rem]">
          <HexFrame className="w-full" contentClassName="p-[28%]">
            <FileText className="size-full text-white" strokeWidth={1.4} />
          </HexFrame>
        </div>

        <div className="w-full">
          <h1 className="text-h1 font-bold text-balance text-ink">{heading}</h1>
          {intro ? <div className="mt-4 text-body-lg text-pretty text-ink">{intro}</div> : null}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** The form-level error: what went wrong and what to do, announced when it appears. */
export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-2xl bg-destructive/8 px-5 py-3 text-body text-destructive">
      {message}
    </p>
  );
}

export const TEXT_LINK =
  'font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 tap-area hover:decoration-leaf focus-visible:decoration-leaf';
