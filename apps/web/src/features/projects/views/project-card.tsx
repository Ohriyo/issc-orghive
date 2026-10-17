import { CalendarDays, MapPin } from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import type { ProjectCard as ProjectCardModel } from '../presenters/use-projects';
import { DeadlineBadge, ProjectStatusChip } from './project-badges';

/** One project: status, event date and place, and the next deadline. The title is the link. */
export function ProjectCard({ project }: { project: ProjectCardModel }) {
  return (
    <article className="flex h-full flex-col gap-3 rounded-2xl bg-white p-4 shadow-pool ring-1 ring-ink/10 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ProjectStatusChip status={project.status} label={project.statusLabel} />
      </div>
      <h3 className="text-body-lg leading-snug font-semibold break-words text-ink">
        <OriginLink to={project.href} className="tap-area hover:underline focus-visible:underline">
          {project.name}
        </OriginLink>
      </h3>
      <dl className="flex flex-col gap-1.5 text-small text-ink-muted">
        <div className="flex items-start gap-2">
          <dt>
            <CalendarDays aria-hidden="true" className="mt-0.5 size-4" />
            <span className="sr-only">Event date</span>
          </dt>
          <dd>{project.eventDate}</dd>
        </div>
        <div className="flex items-start gap-2">
          <dt>
            <MapPin aria-hidden="true" className="mt-0.5 size-4" />
            <span className="sr-only">Location</span>
          </dt>
          <dd className="min-w-0 break-words">{project.location}</dd>
        </div>
      </dl>
      <div className="mt-auto pt-1">
        {project.next ? (
          <DeadlineBadge deadline={project.next.deadline} prefix={`${project.next.taskLabel}:`} />
        ) : (
          <span className="text-small text-ink-muted">
            {project.status === 'completed' ? 'Every task is submitted.' : 'No deadline right now.'}
          </span>
        )}
      </div>
    </article>
  );
}
