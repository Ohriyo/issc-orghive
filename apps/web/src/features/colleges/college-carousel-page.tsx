import { useCollegeCarousel } from './presenters/use-college-carousel';
import { CarouselPage } from './views/carousel-page';

/** /colleges: pick a college to open its Collegiate Student Council. */
export function CollegeCarouselPage() {
  const { items, initialIndex, onSelectedChange, isLoading, isError, retry } = useCollegeCarousel();

  return (
    <CarouselPage
      title="Collegiate Student Councils"
      variant="tower"
      label="Collegiate Student Councils"
      itemNoun="college"
      items={items}
      initialIndex={initialIndex}
      onSelectedChange={onSelectedChange}
      isLoading={isLoading}
      error={
        isError
          ? {
              message: 'The colleges could not be loaded. Check your connection and try again.',
              onRetry: retry,
            }
          : undefined
      }
      emptyState="No colleges have been added yet. They will appear here once an admin adds them."
    />
  );
}
