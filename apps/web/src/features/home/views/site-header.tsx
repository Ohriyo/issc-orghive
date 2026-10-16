import { Search } from 'lucide-react';
import { Link } from 'react-router';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';

/** Floats over the hero, top left, as in the prototype. */
export function SiteHeader() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <Container
        as="nav"
        aria-label="Main"
        className="flex items-center gap-8 pt-6 sm:gap-16 sm:pt-10"
      >
        <PillButton asChild size="lg">
          <Link to="/search">
            <Search aria-hidden="true" />
            Search
          </Link>
        </PillButton>
        <Link
          to="/login"
          className="text-lead font-medium text-ink underline decoration-2 underline-offset-4 transition-colors duration-300 hover:decoration-leaf"
        >
          Login
        </Link>
      </Container>
    </header>
  );
}
