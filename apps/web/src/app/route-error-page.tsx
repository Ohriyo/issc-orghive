import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { usePageChrome } from '@/navigation/page-chrome';

function ErrorPanel({ notFound }: { notFound: boolean }) {
  usePageChrome({ section: null, trail: [], parent: { path: '/', label: 'Home' } });
  return (
    <Container
      as="main"
      className="min-h-page flex max-w-md flex-col items-center justify-center gap-4 pb-section text-center"
    >
      <title>{notFound ? 'Page not found | Orghive' : 'Something went wrong | Orghive'}</title>
      <h1 className="text-h2 font-bold text-ink">
        {notFound ? 'Page not found' : 'Something went wrong'}
      </h1>
      <p className="text-body text-ink-muted">
        {notFound
          ? 'The page you are looking for does not exist.'
          : 'Please try again. If the problem continues, contact the ISSC.'}
      </p>
      <PillButton asChild size="md">
        <Link to="/">Back to home</Link>
      </PillButton>
    </Container>
  );
}

/** A route threw (or failed to load): shown inside the shell, so the header stays. */
export function RouteErrorPage() {
  const error = useRouteError();
  return <ErrorPanel notFound={isRouteErrorResponse(error) && error.status === 404} />;
}

/** No route matched. */
export function NotFoundPage() {
  return <ErrorPanel notFound />;
}
