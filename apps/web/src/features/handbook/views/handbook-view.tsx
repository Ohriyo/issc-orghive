import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Download, ListTree, RotateCw, X } from 'lucide-react';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { PageViewer } from '@/features/documents/views/page-viewer';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { OriginLink } from '@/navigation/origin-link';
import type { HandbookModel } from '../presenters/use-handbook';
import { HandbookGuide } from './handbook-guide';

type Ready = Extract<HandbookModel, { status: 'ready' }>;

const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

/**
 * /handbook and /handbook/:year: the Student Handbook, read page by page (view only), with
 * its contents and search beside it from lg, and in a sheet on phones and tablets.
 */
export function HandbookView({ model }: { model: HandbookModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {model.status === 'ready'
          ? `Student Handbook ${model.yearLabel} | Orghive`
          : 'Student Handbook | Orghive'}
      </title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        {model.status === 'ready' ? (
          <Reader model={model} />
        ) : model.status === 'none' ? (
          <Empty year={model.year} />
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Student Handbook</h1>
            <SectionError
              className="mt-6"
              message="The Student Handbook could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : (
          <div aria-busy="true" className="mt-8">
            <h1 className="sr-only">Loading the Student Handbook</h1>
            <Skeleton className="h-12 w-72" />
            <Skeleton className="mt-4 h-5 w-56" />
            <div className="mt-8 grid gap-8 lg:grid-cols-[19rem_minmax(0,1fr)]">
              <Skeleton className="hidden h-96 rounded-2xl lg:block" />
              <Skeleton className="h-[32rem] rounded-2xl" />
            </div>
          </div>
        )}
      </Container>
    </div>
  );
}

function Empty({ year }: { year: string | null }) {
  return (
    <div className="mt-8 max-w-prose">
      <h1 className="text-h1 font-bold text-ink">Student Handbook</h1>
      <p className="mt-4 text-body-lg text-pretty text-ink">
        {year
          ? `There is no ${year.replace('-', '–')} edition to read.`
          : 'The Student Handbook has not been published here yet. The ISSC posts each edition when it takes effect.'}
      </p>
      <p className="mt-6">
        <OriginLink to="/handbook/editions" className={LINK}>
          See every edition
        </OriginLink>
      </p>
    </div>
  );
}

function Reader({ model }: { model: Ready }) {
  const wide = useBreakpoint('lg');
  const [sheetOpen, setSheetOpen] = useState(false);
  const { edition } = model;

  const guide = (onOpen: (page: number) => void) => (
    <HandbookGuide
      query={model.query}
      setQuery={model.setQuery}
      search={model.search}
      contents={model.contents}
      currentPage={model.currentPage}
      onOpen={onOpen}
    />
  );

  return (
    <>
      <header className="mt-8 max-w-prose">
        <h1 className="text-h1 font-bold text-balance text-ink">Student Handbook</h1>
        <p className="mt-3 text-body-lg text-ink">
          The {model.yearLabel} edition
          {edition.pageCount ? `, ${edition.pageCount} pages` : ''}.{' '}
          <OriginLink to="/handbook/editions" className={LINK}>
            Past editions
          </OriginLink>
        </p>
      </header>
      {model.isPast ? (
        <p
          role="status"
          className="mt-6 max-w-prose rounded-2xl bg-caution-surface px-5 py-4 text-body text-caution"
        >
          <strong className="font-semibold">Past edition</strong> — kept for reference.{' '}
          <OriginLink to="/handbook" className={LINK}>
            View current edition
          </OriginLink>
        </p>
      ) : null}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        {wide ? (
          <aside
            aria-label="Contents and search"
            className="sticky top-[calc(var(--header-h)+1.5rem)] max-h-[calc(100dvh-var(--header-h)-3rem)] overflow-y-auto overscroll-contain rounded-2xl bg-surface-deep/50 p-4 ring-1 ring-ink/10 [scrollbar-color:var(--color-sage)_transparent] [scrollbar-width:thin]"
          >
            {guide(model.goTo)}
          </aside>
        ) : (
          <Dialog.Root open={sheetOpen} onOpenChange={setSheetOpen}>
            <Dialog.Trigger asChild>
              <PillButton variant="light" className="justify-self-start">
                <ListTree aria-hidden="true" />
                Contents and search
              </PillButton>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40 duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
              <Dialog.Content className="pb-safe fixed inset-x-0 bottom-0 z-[60] flex max-h-[85dvh] flex-col rounded-t-3xl bg-surface shadow-pool-lift duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none">
                <div className="flex items-center justify-between gap-4 border-b border-ink/10 py-2 pr-2 pl-5">
                  <Dialog.Title className="text-body-lg font-semibold text-ink">
                    Contents and search
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close"
                    className="flex size-11 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-white focus-visible:bg-white"
                  >
                    <X aria-hidden="true" className="size-5" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Search the handbook or pick a section to open its page.
                </Dialog.Description>
                <div className="overflow-y-auto overscroll-contain p-5">
                  {guide((page) => {
                    setSheetOpen(false);
                    model.goTo(page);
                  })}
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}

        <PageViewer
          className="min-w-0"
          heading={`Pages of the ${model.yearLabel} edition`}
          pages={model.pages}
          isOwner={model.download !== null}
          title={`the Student Handbook ${model.yearLabel}`}
          jumpTo={model.jump}
          onPageChange={model.onPageChange}
          preparingTitle="Preparing pages…"
          unavailableAction={
            model.retryRendering ? <RetryRenderingButton retry={model.retryRendering} /> : null
          }
        />
      </div>
      {model.download ? (
        <div className="mt-6 flex flex-wrap items-center gap-4 lg:ml-[calc(19rem+2rem)] xl:ml-[calc(21rem+2rem)]">
          <PillButton variant="light" onClick={model.download}>
            <Download aria-hidden="true" />
            Download the original PDF
          </PillButton>
          {model.downloadError ? (
            <p role="alert" className="text-small font-medium text-destructive">
              {model.downloadError}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** The ISSC account's way out when the pages could not be prepared: queue them again. */
function RetryRenderingButton({ retry }: { retry: NonNullable<Ready['retryRendering']> }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <PillButton variant="light" onClick={retry.run} disabled={retry.busy}>
        <RotateCw aria-hidden="true" className={retry.busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
        {retry.busy ? 'Queuing…' : 'Retry rendering'}
      </PillButton>
      {retry.error ? (
        <p role="alert" className="text-small font-medium text-destructive">
          {retry.error}
        </p>
      ) : null}
    </div>
  );
}
