import { useState, type ReactNode } from 'react';
import { DocumentCard, DocumentCardSkeleton } from '@/components/document-card';
import { HexFrame } from '@/components/hex-frame';
import { HexGrid } from '@/components/hex-grid';
import { PillButton } from '@/components/pill-button';
import { SpotlightCarousel } from '@/components/spotlight-carousel/spotlight-carousel';
import { WaveDivider } from '@/components/wave-divider';
import { ceaOrganizations, colleges, homeGrid, pagePreview } from './demo-data';

/** Dev-only component gallery at /dev/components. Not registered in production builds. */
export function ComponentsPage() {
  const [gridState, setGridState] = useState<'ready' | 'loading' | 'empty' | 'error'>('ready');

  return (
    <div className="bg-surface-sweep min-h-dvh pb-24">
      <title>Components | Orghive</title>
      <header className="mx-auto max-w-6xl px-4 pt-12 pb-8 md:px-8">
        <h1 className="text-h1 font-bold text-ink">Orghive components</h1>
        <nav aria-label="Components" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-small">
          {[
            'tokens',
            'hex-frame',
            'hex-grid',
            'wave-divider',
            'pill-button',
            'spotlight-carousel',
            'document-card',
          ].map((id) => (
            <a key={id} href={`#${id}`} className="text-ink underline-offset-4 hover:underline">
              {id}
            </a>
          ))}
        </nav>
      </header>

      <Section id="tokens" title="Tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            ['ink', 'bg-ink'],
            ['forest-500', 'bg-forest-500'],
            ['forest-700', 'bg-forest-700'],
            ['forest-900', 'bg-forest-900'],
            ['leaf', 'bg-leaf'],
            ['olive', 'bg-olive'],
            ['sage', 'bg-sage'],
            ['surface', 'bg-surface'],
            ['surface-deep', 'bg-surface-deep'],
            ['pill-light', 'bg-pill-light'],
            ['hex-gap', 'bg-hex-gap'],
            ['ink-muted', 'bg-ink-muted'],
          ].map(([name, bg]) => (
            <div key={name} className="overflow-hidden rounded-lg bg-white ring-1 ring-ink/10">
              <div className={`h-14 ${bg}`} />
              <p className="px-3 py-2 text-caption text-ink">{name}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 space-y-3 text-ink">
          <p className="text-display font-bold">Display 72</p>
          <p className="text-h1 font-bold">Heading 1, 48</p>
          <p className="text-h2 font-bold">Heading 2, 36</p>
          <p className="text-h3 font-bold">Heading 3, 24</p>
          <p className="text-lead">Lead, 21: Organizing unity, archiving transparency</p>
          <p className="text-body-lg">Body large, 18</p>
          <p className="text-body">Body, 16: The quick brown fox jumps over the lazy dog.</p>
          <p className="text-small">Small, 14</p>
          <p className="text-caption">Caption, 12</p>
          <p className="text-body-lg italic">“Designing Structures, Engineering Solutions.”</p>
        </div>
      </Section>

      <Section id="hex-frame" title="HexFrame">
        <div className="flex flex-wrap items-end gap-8">
          <Demo label="flat, band + ring">
            <HexFrame className="w-64">
              <img src={ceaOrganizations[0]!.logoSrc} alt="" className="size-full object-contain" />
            </HexFrame>
          </Demo>
          <Demo label="pointy">
            <HexFrame orientation="pointy" className="w-48">
              <img src={colleges[0]!.logoSrc} alt="" className="size-full object-contain" />
            </HexFrame>
          </Demo>
          <Demo label="no ring">
            <HexFrame ring={false} className="w-40" />
          </Demo>
          <Demo label="fill only">
            <HexFrame band={false} ring={false} shadow={false} className="w-32" />
          </Demo>
        </div>
      </Section>

      <Section id="hex-grid" title="HexGrid">
        <div className="mb-4 flex gap-2" role="group" aria-label="Grid state">
          {(['ready', 'loading', 'empty', 'error'] as const).map((state) => (
            <PillButton
              key={state}
              variant={gridState === state ? 'forest' : 'light'}
              aria-pressed={gridState === state}
              onClick={() => setGridState(state)}
            >
              {state}
            </PillButton>
          ))}
        </div>
        <div className="max-w-3xl rounded-2xl bg-hex-gap/60 p-4">
          <HexGrid
            label="Colleges"
            cells={gridState === 'empty' ? [] : homeGrid}
            isLoading={gridState === 'loading'}
            emptyState={
              <p className="py-16 text-center text-body text-ink">
                No colleges yet. An ISSC admin adds them from the admin page.
              </p>
            }
            error={
              gridState === 'error' ? (
                <DemoError what="colleges" onRetry={() => setGridState('ready')} />
              ) : undefined
            }
          />
        </div>
      </Section>

      <Section id="wave-divider" title="WaveDivider" bleed>
        <WaveDivider />
        <div className="h-12" />
        <WaveDivider flip />
      </Section>

      <Section id="pill-button" title="PillButton">
        <div className="flex flex-wrap items-center gap-5">
          <PillButton>Paperworks</PillButton>
          <PillButton size="lg">Paperworks</PillButton>
          <PillButton variant="light">Proceed</PillButton>
          <PillButton asChild>
            <a href="#pill-button">Browse repository</a>
          </PillButton>
          <PillButton disabled>Disabled</PillButton>
        </div>
      </Section>

      <Section id="spotlight-carousel" title="SpotlightCarousel" bleed>
        <h3 className="mb-2 px-4 text-center text-h1 font-bold text-ink">
          Collegiate Student Councils
        </h3>
        <SpotlightCarousel
          variant="tower"
          label="Collegiate Student Councils"
          itemNoun="college"
          items={colleges}
          className="mx-auto max-w-[1400px]"
        />
        <div className="h-20" />
        <h3 className="px-4 text-center text-h1 font-bold text-ink">Student Body Organizations</h3>
        <p className="mb-4 text-center text-lead text-ink">
          College of Engineering and Architecture
        </p>
        <SpotlightCarousel
          variant="hex"
          label="Student Body Organizations of the College of Engineering and Architecture"
          itemNoun="organization"
          items={ceaOrganizations}
          className="mx-auto max-w-[1400px]"
        />

        <div className="mx-auto mt-20 grid max-w-6xl gap-x-8 gap-y-14 px-4 md:grid-cols-2 md:px-8">
          <Demo
            wide
            label="Two items: no loop, arrows disable at the ends; second logo fails and falls back"
          >
            <SpotlightCarousel
              label="Two-item carousel"
              itemNoun="college"
              items={[
                colleges[0]!,
                { ...colleges[1]!, logoSrc: '/missing-logo.png', shortName: 'CAT' },
              ]}
              className="w-full"
            />
          </Demo>
          <Demo wide label="One item: a still spotlight, no controls">
            <SpotlightCarousel
              variant="hex"
              label="One-item carousel"
              items={[ceaOrganizations[2]!]}
              className="w-full"
            />
          </Demo>
          <Demo wide label="Loading">
            <SpotlightCarousel label="Loading carousel" items={[]} isLoading className="w-full" />
          </Demo>
          <Demo wide label="Error and empty">
            <div className="flex w-full flex-col gap-6">
              <SpotlightCarousel
                label="Failed carousel"
                items={[]}
                error={<DemoError what="student councils" onRetry={() => {}} />}
              />
              <SpotlightCarousel
                label="Empty carousel"
                items={[]}
                emptyState={
                  <p className="text-center text-body text-ink">
                    This college has no student body organizations yet.
                  </p>
                }
              />
            </div>
          </Demo>
        </div>
      </Section>

      <Section id="document-card" title="DocumentCard">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <DocumentCard
            title="First semester accomplishment report"
            typeLabel="Accomplishment report"
            date="2026-10-12"
            href="#document-card"
            fileType="pdf"
            thumbnailSrc={pagePreview}
            isNew
            org={{ name: 'JPICE', logoSrc: ceaOrganizations[0]!.logoSrc }}
            status="approved"
          />
          <DocumentCard
            title="Resolution no. 4: Adopting the revised constitution and by-laws of the council for academic year 2026 to 2027"
            typeLabel="Resolution"
            date="2026-09-03"
            href="#document-card"
            fileType="docx"
            org={{ name: 'CSC-CEA', logoSrc: colleges[0]!.logoSrc }}
            status="pending"
          />
          <DocumentCard
            title="Engineering week budget"
            typeLabel="Financial report"
            date="2026-08-21"
            href="#document-card"
            fileType="xlsx"
            org={{ name: 'PSME', shortName: 'PSME' }}
            status="rejected"
          />
          <DocumentCardSkeleton />
        </div>
      </Section>
    </div>
  );
}

function Section({
  id,
  title,
  bleed = false,
  children,
}: {
  id: string;
  title: string;
  bleed?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-8 py-12">
      <h2
        id={`${id}-title`}
        className="mx-auto mb-6 max-w-6xl px-4 text-h3 font-semibold text-ink md:px-8"
      >
        {title}
      </h2>
      <div className={bleed ? undefined : 'mx-auto max-w-6xl px-4 md:px-8'}>{children}</div>
    </section>
  );
}

function DemoError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-4 py-12 text-center">
      <p className="max-w-md text-body text-ink">
        Couldn&apos;t load the {what}. Check your connection, then try again.
      </p>
      <PillButton variant="light" onClick={onRetry}>
        Try again
      </PillButton>
    </div>
  );
}

function Demo({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <figure className={`flex flex-col items-center gap-3 ${wide ? 'w-full' : ''}`}>
      {children}
      <figcaption className="text-caption text-ink-muted">{label}</figcaption>
    </figure>
  );
}
