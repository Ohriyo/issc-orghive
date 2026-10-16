import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button } from '@/components/ui/button';

export function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <title>{notFound ? 'Page not found | Orghive' : 'Something went wrong | Orghive'}</title>
      <h1 className="text-2xl font-semibold">
        {notFound ? 'Page not found' : 'Something went wrong'}
      </h1>
      <p className="text-muted-foreground">
        {notFound
          ? 'The page you are looking for does not exist.'
          : 'Please try again. If the problem continues, contact the ISSC.'}
      </p>
      <Button asChild>
        <Link to="/">Back to home</Link>
      </Button>
    </main>
  );
}
