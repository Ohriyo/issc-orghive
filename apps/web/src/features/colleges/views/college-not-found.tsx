import { NotFoundPanel } from '@/components/not-found-panel';

/** Shown for /colleges/:slug/... when the slug matches no college. */
export function CollegeNotFound() {
  return (
    <NotFoundPanel
      title="College not found"
      message="There is no college at this address. Choose one from the list of colleges instead."
      action={{ label: 'See all colleges', to: '/colleges' }}
    />
  );
}
