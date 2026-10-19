import { PenLine, Trash2 } from 'lucide-react';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { ConfirmLeaveDialog } from '@/navigation/unsaved-changes-dialog';
import type { UpdateModel } from '../presenters/use-update';
import { UpdateSheet } from './update-sheet';
import { CouncilChip } from './updates-view';

export interface UpdateViewProps {
  model: Exclude<UpdateModel, { status: 'not-found' }>;
  /** After a delete: back to where the reader came from, with a toast. */
  onDeleted: () => void;
}

/** /updates/:id: one update, in a readable column. */
export function UpdateView({ model, onDeleted }: UpdateViewProps) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {model.status === 'ready' ? `${model.item.title} | Updates | Orghive` : 'Update | Orghive'}
      </title>
      <Container as="main" className="max-w-3xl pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" className="mt-6 space-y-4">
            <span className="sr-only">Loading the update</span>
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-10 w-3/4 rounded-full" />
            <Skeleton className="h-64 w-full rounded-2xl" />
          </div>
        ) : model.status === 'error' ? (
          <div className="mt-6">
            <SectionError
              message="This update could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </div>
        ) : (
          <article className="mt-6">
            <header>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-ink-muted">
                <CouncilChip acronym={model.item.council.acronym} />
                <span>{model.item.council.name}</span>
              </p>
              <h1 className="mt-4 text-h1 font-bold text-balance text-ink">{model.item.title}</h1>
              <p className="mt-3 text-small text-ink-muted">
                <time dateTime={model.item.publishedAt}>{model.item.published}</time>
                {model.item.edited ? <span> · {model.item.edited}</span> : null}
              </p>
            </header>

            {model.editor || model.remover ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {model.editor ? (
                  <PillButton variant="light" size="md" onClick={() => model.editor!.setOpen(true)}>
                    <PenLine aria-hidden="true" />
                    Edit
                  </PillButton>
                ) : null}
                {model.remover ? (
                  <PillButton variant="light" size="md" onClick={model.remover.ask}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </PillButton>
                ) : null}
              </div>
            ) : null}

            <div className="mt-8 rounded-2xl bg-white p-5 shadow-pool ring-1 ring-ink/10 md:p-8">
              {model.item.paragraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className="max-w-prose text-body-lg text-pretty whitespace-pre-line text-ink [&+&]:mt-5"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </article>
        )}
      </Container>

      {model.status === 'ready' && model.editor ? (
        <UpdateSheet
          mode="edit"
          open={model.editor.open}
          onOpenChange={model.editor.setOpen}
          councils={[{ slug: model.item.council.slug, acronym: model.item.council.acronym }]}
          initial={model.item.draft}
          onSave={(_council, values) => model.editor!.save(values)}
        />
      ) : null}
      {model.status === 'ready' && model.remover ? (
        <ConfirmLeaveDialog
          open={model.remover.confirming}
          title="Delete this update?"
          description="It disappears from Updates for everyone. This cannot be undone here."
          leaveLabel={model.remover.deleting ? 'Deleting…' : 'Delete update'}
          stayLabel="Keep it"
          onStay={model.remover.cancel}
          onLeave={() => {
            const remover = model.remover!;
            void remover.confirm().then((deleted) => {
              if (deleted) onDeleted();
            });
          }}
        />
      ) : null}
    </div>
  );
}
