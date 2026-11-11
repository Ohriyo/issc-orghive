import { useId, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, FileText, PenLine } from 'lucide-react';
import { EmphasizedText } from '@/components/emphasized-text';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { SocialIcon } from '@/components/social-icon';
import type { PostCardModel } from '@/features/posts/presenters/post-format';
import { PostRow } from '@/features/posts/views/org-post-sections';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ChecklistItem, SectionId } from '../presenters/org-page-layout';
import type { ConstitutionModel } from '../presenters/use-constitution';
import {
  firstProjects,
  type OrgShowcaseState,
  type ShowcaseProjectModel,
} from '../presenters/use-org-showcase';
import { initialsOf, type OrganizationPageModel } from '../presenters/use-organization-page';
import { SECTION_SCROLL_MARGIN } from './section-nav';

const H2 = 'text-h2 font-bold text-balance text-ink';
const LEAD = 'mt-2 text-body text-pretty text-ink-muted';
const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';
/** A text link that is its own 44px-tall box (rows where the tap-area overhang would overlap). */
const TALL = 'inline-flex min-h-11 items-center';
/** An outlined pill for secondary actions: "View all updates", "Open Paperworks". */
const OUTLINE_PILL = 'border border-ink';

/** One section of the template: an anchor for "On this page", its heading and a short lead. */
export function PageSection({
  id,
  title,
  lead,
  children,
}: {
  id: SectionId;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={SECTION_SCROLL_MARGIN}>
      <h2 id={`${id}-heading`} className={H2}>
        {title}
      </h2>
      {lead ? <p className={LEAD}>{lead}</p> : null}
      {children}
    </section>
  );
}

/* About -------------------------------------------------------------------------------- */

export function AboutSection({ page }: { page: OrganizationPageModel }) {
  const empty = !page.description && !page.about && !page.cover;
  return (
    <PageSection id="about" title="About">
      {page.cover ? (
        <figure className="mt-6 overflow-hidden rounded-[1.25rem] bg-surface-deep">
          <img
            src={page.cover.src}
            srcSet={page.cover.srcSet}
            sizes="(width >= 80rem) 860px, (width >= 64rem) 70vw, calc(100vw - 2rem)"
            alt={`${page.acronym} cover photo`}
            loading="lazy"
            decoding="async"
            className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]"
          />
        </figure>
      ) : null}
      {page.description ? (
        <p className="mt-6 max-w-[65ch] text-lead text-pretty whitespace-pre-line text-ink">
          <EmphasizedText segments={page.description} />
        </p>
      ) : null}
      {page.about ? (
        <dl className="mt-8 grid gap-8 md:grid-cols-2">
          {page.about.mission ? <Statement term="Mission" text={page.about.mission} /> : null}
          {page.about.vision ? <Statement term="Vision" text={page.about.vision} /> : null}
        </dl>
      ) : null}
      {empty ? (
        <div className="mt-6 max-w-[60ch] space-y-3 text-body text-pretty text-ink-muted">
          <p>{page.acronym} hasn’t written its description yet.</p>
          <p>
            Highlights, updates, projects, officers and documents appear here as {page.acronym}{' '}
            adds them. Completed projects are listed automatically.
          </p>
        </div>
      ) : null}
    </PageSection>
  );
}

function Statement({ term, text }: { term: string; text: string }) {
  return (
    <div>
      <dt className="text-body-lg font-semibold text-forest-700">{term}</dt>
      <dd className="mt-2 max-w-[60ch] text-body whitespace-pre-line text-pretty text-ink">
        {text}
      </dd>
    </div>
  );
}

/* The own account's checklist --------------------------------------------------------- */

export function FillInChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((item) => item.done).length;
  return (
    <aside
      aria-labelledby="fill-in-heading"
      className="rounded-[1.25rem] border border-dashed border-sage bg-white/70 p-5 sm:p-6"
    >
      <h2 id="fill-in-heading" className="text-h3 font-bold text-ink">
        Fill in your page
      </h2>
      <p className="mt-1 text-small text-pretty text-ink-muted">
        Only your account sees this. Each section shows up for visitors once it has content.{' '}
        {done} of {items.length} done.
      </p>
      <ul className="mt-4">
        {items.map((item) => (
          <li
            key={item.label}
            className="flex min-h-14 items-center gap-3 border-t border-sage/40 py-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full border',
                item.done ? 'border-leaf bg-leaf text-white' : 'border-sage bg-white',
              )}
            >
              {item.done ? <Check className="size-4" /> : null}
            </span>
            <span className={cn('min-w-0 flex-1 text-body', item.done ? 'text-ink-muted' : 'text-ink')}>
              {item.label}
              <span className="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
            </span>
            {item.done ? null : (
              <OriginLink to={item.href} className={cn(LINK, 'shrink-0 text-small')}>
                {item.action}
                <span className="sr-only">: {item.label}</span>
              </OriginLink>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* Updates ------------------------------------------------------------------------------ */

export function UpdatesSection({
  acronym,
  updates,
  total,
  href,
  isOwner,
}: {
  acronym: string;
  updates: PostCardModel[];
  total: number;
  href: string;
  isOwner: boolean;
}) {
  return (
    <PageSection id="updates" title="Updates" lead={`News from ${acronym}, newest first.`}>
      <ol className="mt-6 border-b border-sage/50">
        {updates.map((update) => (
          <li key={update.id}>
            <PostRow post={update} compact />
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
        <PillButton asChild variant="light" className={OUTLINE_PILL}>
          <OriginLink to={href}>
            {total > updates.length ? `View all ${total} updates` : 'View all updates'}
            <ArrowRight aria-hidden="true" />
          </OriginLink>
        </PillButton>
        {isOwner ? <ManagePostsLink acronym={acronym} /> : null}
      </div>
    </PageSection>
  );
}

export function ManagePostsLink({ acronym }: { acronym: string }) {
  return (
    <OriginLink to="/dashboard/posts" className={cn(LINK, 'inline-flex items-center gap-2')}>
      <PenLine aria-hidden="true" className="size-4" />
      Manage {acronym}’s highlights and updates
    </OriginLink>
  );
}

/* Projects ----------------------------------------------------------------------------- */

export function ProjectsSection({ acronym, state }: { acronym: string; state: OrgShowcaseState }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const lead = `Completed projects, listed automatically from ${acronym}’s project records.`;

  if (state.status === 'loading') {
    return (
      <PageSection id="projects" title="Projects" lead={lead}>
        <div aria-busy="true" className="mt-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-16 w-full" />
        </div>
      </PageSection>
    );
  }
  if (state.status === 'error') {
    return (
      <PageSection id="projects" title="Projects" lead={lead}>
        <SectionError
          className="mt-6"
          message="Projects could not be loaded. Check your connection and try again."
          onRetry={state.retry}
        />
      </PageSection>
    );
  }

  const { semesters, projectCount, projectsShown } = state.showcase;
  const hidden = Math.max(0, projectCount - projectsShown);
  const visible = expanded ? semesters : firstProjects(semesters, projectsShown);

  return (
    <PageSection id="projects" title="Projects" lead={lead}>
      <div id={listId}>
        {visible.map((semester) => (
          <div key={semester.label} className="mt-8">
            <h3 className="text-small font-semibold text-forest-700">{semester.label}</h3>
            <ul>
              {semester.projects.map((project) => (
                <li key={project.id} className="border-b border-sage/50 py-6 last:border-b-0">
                  <ProjectEntry project={project} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {hidden > 0 && !expanded ? (
        <button
          type="button"
          aria-controls={listId}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className={cn(LINK, 'mt-2 inline-flex min-h-11 items-center gap-1')}
        >
          Show {hidden} earlier {hidden === 1 ? 'project' : 'projects'}
          <ChevronDown aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </PageSection>
  );
}

function ProjectEntry({ project }: { project: ShowcaseProjectModel }) {
  return (
    <article>
      <h4 className="text-body-lg font-semibold text-pretty text-ink">{project.title}</h4>
      <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 text-small sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        <dt className="text-ink-muted">Date</dt>
        <dd className="text-ink">
          <time dateTime={project.dateTime}>{project.date}</time>
        </dd>
        <dt className="text-ink-muted">Location</dt>
        <dd className="text-pretty text-ink">{project.location}</dd>
        <dt className="text-ink-muted">Beneficiaries</dt>
        <dd className="text-pretty text-ink">{project.beneficiaries}</dd>
      </dl>
      {project.files.length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label={`Documents of ${project.title}`}>
          {project.files.map((file) => (
            <li key={file.href}>
              <OriginLink
                to={file.href}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-sage px-4 text-small font-medium text-ink transition-colors duration-300 hover:border-ink focus-visible:border-ink"
              >
                <FileText aria-hidden="true" className="size-4 text-forest-700" />
                {file.label}
              </OriginLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-small text-ink-muted">No public documents for this project.</p>
      )}
    </article>
  );
}

/* Officers ----------------------------------------------------------------------------- */

export function OfficersSection({ officers }: { officers: OrganizationPageModel['officers'] }) {
  return (
    <PageSection id="officers" title="Officers">
      <ul className="mt-6 grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {officers.map((officer, i) => (
          <li key={`${officer.position}-${officer.name}-${i}`} className="flex items-center gap-3">
            <HexFrame
              band={false}
              shadow={false}
              className="w-12 shrink-0"
              contentClassName="bg-forest-band p-0 grid place-items-center"
            >
              <span aria-hidden="true" className="text-small font-bold text-white">
                {initialsOf(officer.name)}
              </span>
            </HexFrame>
            <p className="min-w-0">
              <span className="block text-body font-semibold text-pretty text-ink">
                {officer.name}
              </span>{' '}
              <span className="block text-small text-ink-muted">{officer.position}</span>
            </p>
          </li>
        ))}
      </ul>
    </PageSection>
  );
}

/* Documents ---------------------------------------------------------------------------- */

export function DocumentsSection({
  page,
  constitution,
  showcase,
}: {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
  showcase?: OrgShowcaseState;
}) {
  const ready = showcase?.status === 'ready' ? showcase.showcase : null;
  const count = ready?.publicDocumentCount ?? 0;
  return (
    <PageSection
      id="documents"
      title="Documents"
      lead="Public documents. Open any of them in the viewer; they can’t be downloaded."
    >
      <div className="mt-6">
        <ConstitutionCard page={page} constitution={constitution} />
      </div>
      {ready && ready.documents.length > 0 ? (
        <ul className="mt-4">
          {ready.documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-4 border-b border-sage/50 py-4 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="hidden size-11 shrink-0 place-items-center rounded-lg bg-surface-deep/60 text-forest-700 sm:grid"
              >
                <FileText className="size-5" />
              </span>
              <p className="min-w-0 flex-1">
                <span className="block text-body font-medium text-pretty text-ink">{doc.title}</span>{' '}
                <span className="block text-small text-ink-muted">{doc.meta}</span>
              </p>
              <PillButton asChild variant="light" className={cn(OUTLINE_PILL, 'shrink-0 px-4')}>
                <OriginLink to={doc.href} aria-label={`View ${doc.title}`}>
                  View
                </OriginLink>
              </PillButton>
            </li>
          ))}
        </ul>
      ) : null}
      {showcase?.status === 'error' ? (
        <SectionError
          className="mt-4"
          message="The newest documents could not be loaded. Check your connection and try again."
          onRetry={showcase.retry}
        />
      ) : null}
      <PillButton asChild variant="light" className={cn(OUTLINE_PILL, 'mt-6')}>
        <OriginLink to={page.paperworksHref}>
          {count > 0
            ? `Open Paperworks (${count} public ${count === 1 ? 'file' : 'files'})`
            : 'Open Paperworks'}
        </OriginLink>
      </PillButton>
    </PageSection>
  );
}

function ConstitutionCard({
  page,
  constitution,
}: {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
}) {
  if (constitution.status === 'loading') {
    return <Skeleton aria-busy="true" className="h-20 w-full rounded-[1.25rem]" />;
  }
  if (constitution.status === 'error') {
    return (
      <SectionError
        message="The Constitution & By-laws could not be loaded. Check your connection and try again."
        onRetry={constitution.retry}
      />
    );
  }
  const seal = (
    <HexFrame shadow={false} className="w-12 shrink-0" contentClassName="p-[18%]">
      <OrgLogo
        name={page.name}
        src={page.logoSrc}
        srcSet={page.logoSrcSet}
        sizes="48px"
        alt=""
        fallbackText={page.acronym}
        className="size-full"
      />
    </HexFrame>
  );
  if (constitution.status === 'none') {
    return (
      <div className="flex items-center gap-4 rounded-[1.25rem] border border-dashed border-sage bg-white/50 p-4">
        {seal}
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-ink">Constitution &amp; By-laws</h3>
          <p className="text-small text-pretty text-ink-muted">
            {page.acronym} has not uploaded its Constitution &amp; By-laws.
          </p>
          {constitution.canUpload ? (
            <OriginLink to="/dashboard/profile#constitution" className={cn(LINK, 'mt-1 inline-block text-small')}>
              Upload it from your profile
            </OriginLink>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div id="constitution" className={cn('rounded-[1.25rem] bg-white p-4 shadow-pool ring-1 ring-ink/5', SECTION_SCROLL_MARGIN)}>
      <div className="flex items-center gap-4">
        {seal}
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-ink">Constitution &amp; By-laws</h3>
          {constitution.dateLine ? (
            <p className="text-small text-ink-muted">
              <time dateTime={constitution.dateIso ?? undefined}>{constitution.dateLine}</time>
            </p>
          ) : null}
        </div>
        <PillButton asChild className="shrink-0 px-5">
          <OriginLink to={constitution.readHref} aria-label="Read the constitution">
            Read
          </OriginLink>
        </PillButton>
      </div>
      {constitution.history.length > 1 ? (
        <details className="group/history mt-2 border-t border-sage/40 pt-1">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-small font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf [&::-webkit-details-marker]:hidden">
            Amendment history ({constitution.history.length} versions)
            <ChevronDown
              aria-hidden="true"
              className="size-4 transition-transform duration-300 group-open/history:rotate-180 motion-reduce:transition-none"
            />
          </summary>
          <ol>
            {constitution.history.map((entry) => (
              <li key={entry.id} className="border-t border-sage/40 py-3 first:border-t-0">
                <p className="text-small font-semibold text-ink">{entry.label}</p>
                {entry.note ? (
                  <p className="mt-1 text-small whitespace-pre-line text-pretty text-ink">
                    {entry.note}
                  </p>
                ) : null}
                {entry.isCurrent ? (
                  <p className="mt-1 text-small text-ink-muted">Current version</p>
                ) : entry.state === 'ready' ? (
                  <OriginLink to={entry.href} className={cn(LINK, 'mt-1 inline-block text-small')}>
                    View this version
                  </OriginLink>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

/* Contact ------------------------------------------------------------------------------ */

export function ContactSection({ page }: { page: OrganizationPageModel }) {
  const contact = page.contact;
  return (
    <PageSection id="contact" title="Contact">
      <dl className="mt-6 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        {contact?.email ? (
          <ContactRow term="Email">
            <a
              href={`mailto:${contact.email}`}
              aria-label={`Email ${contact.email}`}
              className={cn(LINK, TALL, 'break-all')}
            >
              {contact.email}
            </a>
          </ContactRow>
        ) : null}
        {contact?.links.map((link) => (
          <ContactRow key={link.url} term={link.label}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${link.label} ${link.display} (opens in a new tab)`}
              className={cn(LINK, TALL, 'break-all')}
            >
              {link.display}
            </a>
          </ContactRow>
        ))}
        {page.context ? (
          <ContactRow term="College">
            <OriginLink to={page.context.college.href} className={cn(LINK, TALL)}>
              {page.context.college.name}
            </OriginLink>
          </ContactRow>
        ) : null}
      </dl>
    </PageSection>
  );
}

function ContactRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="py-2.5 text-small text-ink-muted">{term}</dt>
      <dd className="min-w-0 py-2.5 text-body">{children}</dd>
    </>
  );
}

/** The header's round icon links: email first, then the organization's links in order. */
export function SocialLinks({ page }: { page: OrganizationPageModel }) {
  const contact = page.contact;
  if (!contact) return null;
  const ICON =
    'grid size-11 place-items-center rounded-full border border-sage/70 bg-white/70 text-ink transition-colors duration-300 hover:border-ink hover:bg-white focus-visible:border-ink focus-visible:bg-white';
  return (
    <ul className="flex flex-wrap gap-2" aria-label={`${page.acronym} online`}>
      {contact.email ? (
        <li>
          <a href={`mailto:${contact.email}`} className={ICON} aria-label={`Email ${page.acronym}`}>
            <SocialIcon kind="email" />
          </a>
        </li>
      ) : null}
      {contact.links.map((link) => (
        <li key={link.url}>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={ICON}
            aria-label={`${page.acronym} on ${link.label} (opens in a new tab)`}
          >
            <SocialIcon kind={link.kind} />
          </a>
        </li>
      ))}
    </ul>
  );
}
