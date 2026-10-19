import { useParams } from 'react-router';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useCollegePlace } from '@/navigation/use-places';
import { useSboCarousel } from './presenters/use-sbo-carousel';
import { CarouselPage } from './views/carousel-page';
import { CollegeNotFound } from './views/college-not-found';

/** /colleges/:slug/organizations: pick one of the college's student body organizations. */
export function SboCarouselPage() {
  const { slug = '' } = useParams();
  const sbo = useSboCarousel(slug);
  usePageChrome(chrome.collegeOrganizations(slug, useCollegePlace(slug)));

  if (sbo.isNotFound) return <CollegeNotFound />;

  return (
    <CarouselPage
      title="Student Body Organizations"
      subtitle={sbo.college?.name}
      variant="hex"
      label={
        sbo.college
          ? `Student Body Organizations of the ${sbo.college.name}`
          : 'Student Body Organizations'
      }
      itemNoun="organization"
      items={sbo.items}
      initialIndex={sbo.initialIndex}
      onSelectedChange={sbo.onSelectedChange}
      isLoading={sbo.isLoading}
      error={
        sbo.isError
          ? {
              message:
                'The organizations could not be loaded. Check your connection and try again.',
              onRetry: sbo.retry,
            }
          : undefined
      }
      emptyState={`No student body organizations have been added to the ${
        sbo.college?.name ?? 'college'
      } yet.`}
    />
  );
}
