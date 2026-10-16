import { HexFrame } from '@/components/hex-frame';
import { Skeleton } from '@/components/skeleton';

/** Shown while the silent refresh decides whether anyone is signed in. Shaped like the auth screens. */
export function AuthSkeleton() {
  return (
    <div
      aria-busy="true"
      className="bg-surface-sweep mx-auto grid min-h-dvh w-full max-w-6xl content-center items-center gap-10 px-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-20 lg:px-12"
    >
      <span className="sr-only">Checking your session</span>
      <HexFrame
        shadow={false}
        className="mx-auto w-28 animate-pulse opacity-60 motion-reduce:animate-none sm:w-36 lg:w-full lg:max-w-[26rem]"
      />
      <div className="w-full">
        <Skeleton className="h-12 w-48" />
        <Skeleton className="mt-8 h-12 w-full" />
        <Skeleton className="mt-6 h-12 w-full" />
        <Skeleton className="mt-8 h-14 w-36" />
      </div>
    </div>
  );
}
