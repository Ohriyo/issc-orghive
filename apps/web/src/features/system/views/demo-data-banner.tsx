import { TriangleAlert } from 'lucide-react';
import type { DemoDataModel } from '../presenters/use-demo-data';
import { ConfirmDialog, StepUpDialog } from './system-dialogs';

/** Red and on every console page while demo data exists: it must go before deployment. */
export function DemoDataBanner({ model }: { model: DemoDataModel }) {
  if (!model.present) return null;
  return (
    <section
      aria-labelledby="demo-data-banner"
      className="mb-6 rounded-xl bg-destructive p-4 text-white sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <h2 id="demo-data-banner" className="text-body-lg font-bold">
              Demo data present — remove before deployment
            </h2>
            <p className="mt-1 text-body text-pretty">
              {model.total === 1 ? '1 demo row' : `${model.total} demo rows`}:{' '}
              {model.items.map((i) => `${i.count} ${i.label.toLowerCase()}`).join(', ')}.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={model.askRemove}
          disabled={model.removing}
          className="inline-flex h-11 shrink-0 items-center rounded-full bg-white px-6 text-body font-semibold text-destructive transition-opacity duration-300 hover:opacity-90 focus-visible:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
        >
          {model.removing ? 'Removing…' : 'Remove demo data'}
        </button>
      </div>
      <ConfirmDialog confirming={model.confirming} onCancel={model.cancelConfirm} />
      <StepUpDialog {...model.stepUp} />
    </section>
  );
}
