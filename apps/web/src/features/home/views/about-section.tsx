import { Reveal } from '@/components/reveal';

export function AboutSection() {
  return (
    <section aria-labelledby="about-heading" className="relative px-4 py-20 sm:px-8 lg:py-28">
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 id="about-heading" className="text-display font-bold text-ink">
          About Us
        </h2>
        <p className="mt-8 text-lead text-pretty text-ink lg:mt-12">
          Orghive is <strong className="font-bold">NwSSU&apos;s official digital archive</strong>{' '}
          for student body organization documents. It promotes transparency and easy access by
          securely storing proposals, reports, and official papers in one organized platform.
          Orghive supports a more{' '}
          <strong className="font-bold">accountable and future-ready student governance.</strong>
        </p>
      </Reveal>
    </section>
  );
}
