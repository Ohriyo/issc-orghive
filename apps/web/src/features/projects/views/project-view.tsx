import { useRef } from 'react';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  FileUp,
  Lock,
  MapPin,
  Users,
} from 'lucide-react';
import { TASK_UPLOAD_ACCEPT, type ProjectTaskStatus } from '@orghive/shared';
import { OriginLink } from '@/navigation/origin-link';
import { ActingAsField } from '@/components/acting-as-field';
import { Container } from '@/components/container';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { VisibilitySelect } from '@/components/visibility-select';
import { cn } from '@/lib/utils';
import type {
  Phase,
  ProjectPageModel,
  ProjectPageState,
  TaskItem,
} from '../presenters/use-project';
import { TASK_FILE_TYPES_LABEL } from '../presenters/upload-task-file';
import { DeadlineBadge, LockedNote, ProjectStatusChip } from './project-badges';

export type ProjectViewProps = Exclude<ProjectPageState, { status: 'not-found' }> & {
  /** The block or freeze banner with "Submit appeal" (spec section 3). */
  compliance?: React.ReactNode;
  /** The project's appeal history. */
  appeals?: React.ReactNode;
};

/** /projects/:id: the project and its milestone checklist as a vertical stepper. */
export function ProjectView(props: ProjectViewProps) {
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {props.status === 'ready' ? `${props.project.name} | Orghive` : 'Project | Orghive'}
      </title>
      <Container as="main" className="max-w-4xl pt-4 pb-section lg:pt-6">
        {props.status === 'ready' ? (
          <ProjectDetails
            project={props.project}
            compliance={props.compliance}
            appeals={props.appeals}
          />
        ) : props.status === 'error' ? (
          <SectionError
            className="mt-8"
            message="This project could not be loaded. Check your connection and try again."
            onRetry={props.retry}
          />
        ) : (
          <div aria-busy="true" className="mt-8">
            <h1 className="sr-only">Loading the project</h1>
            <Skeleton className="h-7 w-28 rounded-full" />
            <Skeleton className="mt-4 h-12 w-full max-w-xl" />
            <Skeleton className="mt-10 h-40 w-full rounded-2xl" />
            <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
          </div>
        )}
      </Container>
    </div>
  );
}

function ProjectDetails({
  project,
  compliance,
  appeals,
}: {
  project: ProjectPageModel;
  compliance?: React.ReactNode;
  appeals?: React.ReactNode;
}) {
  return (
    <article className="mt-6">
      <ProjectStatusChip status={project.status} label={project.statusLabel} />
      <h1 className="mt-3 text-h1 font-bold text-pretty break-words text-ink">{project.name}</h1>
      <dl className="mt-5 grid gap-3 text-body text-ink sm:grid-cols-2">
        <Fact icon={CalendarDays} term="Event date">
          {project.eventDate}
        </Fact>
        <Fact icon={MapPin} term="Location">
          {project.location}
        </Fact>
        <Fact icon={Users} term="Target beneficiaries" className="sm:col-span-2">
          {project.beneficiaries}
        </Fact>
      </dl>
      <p className="mt-5 max-w-prose text-body-lg text-pretty text-ink">{project.description}</p>
      {compliance ? <div className="mt-6">{compliance}</div> : null}

      <h2 className="mt-10 text-h2 font-bold text-ink">Checklist</h2>
      <p aria-live="polite" className="mt-1 text-small text-ink-muted">
        {project.checking
          ? 'A file is being checked for viruses. This page updates when it is done.'
          : 'A task is complete once its file is uploaded and passes the virus scan.'}
      </p>
      {project.actingAs ? (
        <ActingAsField
          className="mt-6 max-w-md"
          orgAcronym={project.org.acronym}
          value={project.actingAs.value}
          onChange={(event) => project.actingAs?.onChange(event.target.value)}
          error={project.actingAs.error}
        />
      ) : null}
      <ol className="mt-6">
        {project.phases.map((phase, i) => (
          <PhaseStep
            key={phase.key}
            phase={phase}
            project={project}
            last={i === project.phases.length - 1}
          />
        ))}
      </ol>
      {appeals}
    </article>
  );
}

function Fact({
  icon: Icon,
  term,
  children,
  className,
}: {
  icon: typeof MapPin;
  term: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2.5', className)}>
      <dt className="shrink-0">
        <Icon aria-hidden="true" className="mt-0.5 size-5 text-forest-700" />
        <span className="sr-only">{term}</span>
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const PHASE_STATE_TEXT: Record<Phase['state'], string> = {
  done: 'Done',
  current: 'In progress',
  upcoming: 'Not yet',
};

/** One phase: a marker on the rail, its title and its tasks. */
function PhaseStep({
  phase,
  project,
  last,
}: {
  phase: Phase;
  project: ProjectPageModel;
  last: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 md:gap-x-5">
      {/* The rail between markers. */}
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-11 bottom-0 left-5 w-0.5 -translate-x-1/2 bg-ink/15"
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 grid size-10 place-items-center rounded-full ring-4 ring-surface',
          phase.state === 'done'
            ? 'bg-forest-band text-white'
            : phase.state === 'current'
              ? 'border-2 border-forest-700 bg-white text-forest-700'
              : 'border-2 border-ink/25 bg-white text-ink-muted',
        )}
      >
        {phase.state === 'done' ? (
          <Check className="size-5" />
        ) : (
          <Circle className={cn('size-3', phase.state === 'current' && 'fill-current')} />
        )}
      </span>
      <div className={cn('min-w-0', last ? 'pb-0' : 'pb-10')}>
        <h3 className="flex flex-wrap items-baseline gap-x-3 pt-1.5 text-h3 font-bold text-ink">
          {phase.title}
          <span className="text-small font-medium text-ink-muted">
            {PHASE_STATE_TEXT[phase.state]}
          </span>
        </h3>
        {phase.key === 'event' ? (
          <p className="mt-2 text-body text-ink">
            {project.eventDate} at {project.location}. The Activity Completion Report and Financial
            Report open on this day.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {phase.tasks.map((task) => (
              <li key={task.type}>
                <TaskCard task={task} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

const TASK_STATUS: Record<
  ProjectTaskStatus,
  { label: string; icon: typeof Lock; className: string }
> = {
  locked: { label: 'Locked', icon: Lock, className: 'border-ink/25 text-ink-muted' },
  open: { label: 'Open', icon: Circle, className: 'border-olive text-ink' },
  submitted: { label: 'Submitted', icon: CheckCircle2, className: 'border-leaf text-ink' },
};

function TaskCard({ task }: { task: TaskItem }) {
  const status = TASK_STATUS[task.status];
  const StatusIcon = status.icon;
  return (
    <section
      aria-label={task.label}
      className={cn(
        'flex flex-col gap-4 rounded-2xl p-4 ring-1 md:p-5',
        task.status === 'locked' ? 'bg-white/60 ring-ink/10' : 'bg-white shadow-pool ring-ink/10',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h4 className="min-w-0 text-body-lg leading-snug font-semibold text-ink">{task.label}</h4>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-white px-2.5 py-0.5 text-caption font-semibold',
            status.className,
          )}
        >
          <StatusIcon aria-hidden="true" className="size-3.5" />
          {status.label}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {task.deadline ? <DeadlineBadge deadline={task.deadline} /> : null}
        {task.status === 'open' && !task.deadline ? (
          <span className="text-small text-ink-muted">No deadline.</span>
        ) : null}
        {task.lockedHint ? <LockedNote text={task.lockedHint} /> : null}
        {task.submittedOn ? (
          <span className="inline-flex items-center gap-1.5 text-small text-ink">
            <CheckCircle2 aria-hidden="true" className="size-4 text-forest-700" />
            {task.submittedOn}
          </span>
        ) : null}
        {task.file ? <TaskFile file={task.file} /> : null}
      </div>

      {task.canUpload ? <TaskUpload task={task} /> : null}
    </section>
  );
}

function TaskFile({ file }: { file: NonNullable<TaskItem['file']> }) {
  return (
    <div className="flex flex-col text-small text-ink">
      {/* Its own 44px row: a small-text link alone is shorter than a tap target. */}
      <OriginLink
        to={file.href}
        className="flex min-h-11 items-center self-start font-medium break-words underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf"
      >
        {file.title}
      </OriginLink>
      {file.state === 'scanning' ? (
        <span className="text-ink-muted">Checking for viruses…</span>
      ) : file.state === 'quarantined' ? (
        <span className="font-medium text-destructive">
          The virus scan refused this file. Upload a clean copy.
        </span>
      ) : null}
    </div>
  );
}

function TaskUpload({ task }: { task: TaskItem }) {
  const input = useRef<HTMLInputElement>(null);
  const state = task.upload;
  const busy = state.status === 'uploading' || state.status === 'saving';
  const replacing = task.status === 'submitted' || task.file !== null;
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:items-start md:gap-5">
      <VisibilitySelect
        className="md:w-60"
        value={task.visibility}
        documentTitle={task.label}
        disabled={busy}
        onChange={task.setVisibility}
      />
      {/* md:pt-8 lines the button up with the select, below its label. */}
      <div className="flex min-w-0 flex-col gap-2 md:flex-1 md:pt-8">
        <input
          ref={input}
          type="file"
          accept={TASK_UPLOAD_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) task.uploadFile(file);
          }}
        />
        <PillButton
          size="md"
          variant={replacing ? 'light' : 'forest'}
          disabled={busy}
          onClick={() => input.current?.click()}
          className="self-start max-sm:w-full"
        >
          <FileUp aria-hidden="true" />
          {replacing ? 'Upload a new version' : 'Upload file'}
          <span className="sr-only">: {task.label}</span>
        </PillButton>
        <div aria-live="polite" className="text-small">
          {busy ? (
            <div className="flex flex-col gap-1">
              <div
                role="progressbar"
                aria-label={`Upload of the ${task.label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.status === 'saving' ? 100 : state.progress}
                className="h-1.5 w-full overflow-hidden rounded-full bg-surface-deep"
              >
                <div
                  className="bg-forest-band h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${state.status === 'saving' ? 100 : state.progress}%` }}
                />
              </div>
              <span className="text-ink-muted">
                {state.status === 'saving' ? 'Saving…' : `Uploading ${state.progress}%`}
              </span>
            </div>
          ) : state.status === 'done' ? (
            <span className="text-ink">Uploaded. It counts once the virus scan passes.</span>
          ) : state.status === 'error' ? (
            <span role="alert" className="font-medium text-destructive">
              {state.message}
            </span>
          ) : (
            <span className="text-ink-muted">{TASK_FILE_TYPES_LABEL}</span>
          )}
        </div>
      </div>
    </div>
  );
}
