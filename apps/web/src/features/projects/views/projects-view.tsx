import { FolderKanban, Plus } from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { OrgSwitcher } from '@/features/dashboard/views/org-switcher';
import type {
  ProjectCard as ProjectCardModel,
  ProjectsPageModel,
} from '../presenters/use-projects';
import { ProjectCard } from './project-card';

type Ready = Extract<ProjectsPageModel, { status: 'ready' }>;

/** /dashboard/projects: an organization's projects, in progress first. */
export function ProjectsView({ model }: { model: ProjectsPageModel }) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {model.status === 'ready'
          ? `${model.org.acronym} projects | Orghive`
          : 'Projects | Orghive'}
      </title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        {model.status === 'loading' ? (
          <div aria-busy="true" aria-label="Loading projects" className="mt-8">
            <Skeleton className="h-12 w-64" />
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 rounded-2xl" />
              ))}
            </div>
          </div>
        ) : model.status === 'error' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Projects</h1>
            <SectionError
              className="mt-6"
              message="Your projects could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : model.status === 'no-organization' ? (
          <>
            <h1 className="mt-8 text-h1 font-bold text-ink">Projects</h1>
            <p className="mt-4 max-w-prose text-body-lg text-ink">
              You’re not in an organization yet, so there are no projects to show.
            </p>
          </>
        ) : (
          <ReadyView model={model} />
        )}
      </Container>
    </div>
  );
}

function ReadyView({ model }: { model: Ready }) {
  return (
    <>
      {model.organizations.length > 1 ? (
        <OrgSwitcher
          className="mt-6"
          organizations={model.organizations}
          selectedId={model.org.id}
          onSelect={model.selectOrganization}
        />
      ) : null}
      <header className="mt-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
        <div className="min-w-0">
          <h1 className="text-h1 font-bold text-ink">{model.org.acronym} projects</h1>
          <p className="mt-1 max-w-prose text-lead text-ink">
            Each project’s checklist: the proposal within 14 days, then the reports within 14 days
            after the event.
          </p>
        </div>
        {model.newHref ? (
          <PillButton asChild size="md" className="self-start md:self-end">
            <OriginLink to={model.newHref}>
              <Plus aria-hidden="true" />
              New project
            </OriginLink>
          </PillButton>
        ) : null}
      </header>
      <ProjectLists model={model} />
    </>
  );
}

function ProjectLists({ model }: { model: Ready }) {
  const list = model.list;
  if (list.status === 'loading') {
    return (
      <div aria-busy="true" className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (list.status === 'error') {
    return (
      <SectionError
        className="mt-8"
        message="These projects could not be loaded. Check your connection and try again."
        onRetry={list.retry}
      />
    );
  }
  if (list.inProgress.length === 0 && list.completed.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl bg-white/70 p-6 ring-1 ring-ink/10">
        <FolderKanban aria-hidden="true" className="size-8 text-forest-700" />
        <p className="max-w-prose text-body-lg text-ink">
          No projects yet.{' '}
          {model.newHref
            ? 'Create one for your next event and its checklist tells you what to upload, and by when.'
            : 'Your officers create them for each event.'}
        </p>
        {model.newHref ? (
          <PillButton asChild size="md">
            <OriginLink to={model.newHref}>
              <Plus aria-hidden="true" />
              New project
            </OriginLink>
          </PillButton>
        ) : null}
      </div>
    );
  }
  return (
    <>
      <Group title="In progress" empty="Nothing in progress." projects={list.inProgress} />
      {list.completed.length > 0 ? (
        <Group title="Completed" empty="" projects={list.completed} />
      ) : null}
    </>
  );
}

function Group({
  title,
  empty,
  projects,
}: {
  title: string;
  empty: string;
  projects: ProjectCardModel[];
}) {
  const id = `projects-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-h3 font-bold text-ink">
        {title} <span className="text-body font-normal text-ink-muted">({projects.length})</span>
      </h2>
      {projects.length === 0 ? (
        <p className="mt-3 text-body text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
