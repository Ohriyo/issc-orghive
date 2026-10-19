import { FolderKanban, Plus } from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import type { ProjectsOverviewModel } from '../presenters/use-projects';
import { ProjectCard } from './project-card';

const TEXT_LINK =
  'tap-area font-semibold text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';

/** The dashboard's "Projects" section: the most urgent projects in progress. */
export function ProjectsOverview({ model }: { model: ProjectsOverviewModel }) {
  return (
    <section aria-labelledby="projects-heading">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 id="projects-heading" className="text-h3 font-bold text-ink">
          Projects
        </h2>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <OriginLink to={model.allHref} className={cn(TEXT_LINK, 'text-small')}>
            All projects{model.more > 0 ? ` (${model.more} more)` : ''}
          </OriginLink>
          {model.newHref ? (
            <PillButton asChild variant="light" size="md">
              <OriginLink to={model.newHref}>
                <Plus aria-hidden="true" />
                New project
              </OriginLink>
            </PillButton>
          ) : null}
        </div>
      </div>
      {model.status === 'loading' ? (
        <div aria-busy="true" className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : model.status === 'error' ? (
        <SectionError
          className="mt-4"
          message="Projects could not be loaded. Check your connection and try again."
          onRetry={model.retry}
        />
      ) : model.items.length === 0 ? (
        <p className="mt-4 flex items-start gap-3 rounded-2xl bg-white/70 p-5 text-body text-ink ring-1 ring-ink/10">
          <FolderKanban aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-forest-700" />
          No projects in progress.{' '}
          {model.newHref
            ? 'Create one for your next event; its checklist tells you what to upload and when.'
            : 'Your officers create them for each event.'}
        </p>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {model.items.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
