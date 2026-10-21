import type { CSSProperties, ReactNode } from 'react';
import { ArrowUpRight, Mail } from 'lucide-react';
import { Container } from '@/components/container';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { Reveal } from '@/components/reveal';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { ConstitutionModel } from '../presenters/use-constitution';
import type { ContactLink, OrganizationPageModel } from '../presenters/use-organization-page';

export interface OrganizationRecordProps {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
  /** Scroll reveals on the live page; off in the editor's preview, which is never scrolled into. */
  animate?: boolean;
}

const H2 = 'text-h2 font-bold text-ink text-balance';
const LINK =
  'tap-area font-medium text-ink underline decoration-1 underline-offset-4 transition-colors duration-300 hover:decoration-leaf focus-visible:decoration-leaf';
/** A sheet of paper, as the constitution is filed: US letter, the NwSSU standard. */
const SHEET = 'aspect-[8.5/11] w-full rounded-[3px]';

/**
 * Below the hero on /orgs/:slug: the organization's own profile, as an official record.
 * Mission and vision, then the officers it shows publicly, in a wide column; its
 * Constitution & By-laws and contact details in a narrow rail beside them from lg (on
 * phones they follow the officers). Sections the organization has not written are left
 * out, except the constitution, whose absence is worth saying.
 */
export function OrganizationRecord({ page, constitution, animate = true }: OrganizationRecordProps) {
  const Block = animate ? Reveal : Plain;
  // Without About or Officers the rail has no column to sit beside; it spreads out instead.
  const hasMain = page.about !== null || page.officers.length > 0;
  return (
    <Container className="pt-16 pb-section">
      {page.cover ? (
        <Block className="mb-16">
          <figure className="overflow-hidden rounded-[1.75rem] bg-surface-deep shadow-pool">
            <img
              src={page.cover.src}
              srcSet={page.cover.srcSet}
              sizes="(width >= 80rem) 1120px, calc(100vw - 2rem)"
              alt={`${page.acronym} cover photo`}
              loading="lazy"
              decoding="async"
              className="aspect-[16/9] w-full object-cover sm:aspect-[21/9] lg:aspect-[3/1]"
            />
          </figure>
        </Block>
      ) : null}

      <div
        className={cn(
          'grid gap-16',
          hasMain && 'lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[minmax(0,1fr)_21rem]',
        )}
      >
        {hasMain ? (
          <div className="flex min-w-0 flex-col gap-16">
            {page.about ? (
              <Block>
                <section aria-labelledby="about-heading">
                  <h2 id="about-heading" className={H2}>
                    About {page.acronym}
                  </h2>
                  <dl className="mt-8">
                    {page.about.mission ? (
                      <Statement term="Mission" text={page.about.mission} />
                    ) : null}
                    {page.about.vision ? <Statement term="Vision" text={page.about.vision} /> : null}
                  </dl>
                </section>
              </Block>
            ) : null}

            {page.officers.length > 0 ? (
              <Block>
                <section aria-labelledby="officers-heading">
                  <h2 id="officers-heading" className={H2}>
                    Officers
                  </h2>
                  <ul className="mt-8 grid gap-x-10 sm:grid-cols-2">
                    {page.officers.map((officer, i) => (
                      <li
                        key={`${officer.position}-${officer.name}-${i}`}
                        className="border-t border-sage/50 py-4"
                      >
                        <p className="text-small text-ink-muted">{officer.position}</p>
                        <p className="mt-0.5 text-body-lg font-semibold text-pretty text-ink">
                          {officer.name}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              </Block>
            ) : null}
          </div>
        ) : null}

        <div
          className={cn(
            'min-w-0',
            hasMain ? 'flex flex-col gap-16' : 'grid gap-16 md:grid-cols-2',
          )}
        >
          <Block>
            <ConstitutionPanel acronym={page.acronym} logo={page} constitution={constitution} />
          </Block>
          {page.contact ? (
            <Block>
              <ContactPanel email={page.contact.email} links={page.contact.links} />
            </Block>
          ) : null}
        </div>
      </div>
    </Container>
  );
}

function Plain({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}

/** One statement of the About list: the term hangs in its own column from md. */
function Statement({ term, text }: { term: string; text: string }) {
  return (
    <div className="grid gap-2 border-t border-sage/50 py-6 md:grid-cols-[7.5rem_minmax(0,1fr)] md:gap-8">
      <dt className="text-body-lg font-semibold text-forest-700">{term}</dt>
      <dd className="max-w-[60ch] text-lead whitespace-pre-line text-pretty text-ink">{text}</dd>
    </div>
  );
}

interface ConstitutionPanelProps {
  acronym: string;
  logo: Pick<OrganizationPageModel, 'name' | 'logoSrc' | 'logoSrcSet'>;
  constitution: ConstitutionModel;
}

/**
 * The Constitution & By-laws as a filed sheet: page 1 (watermarked) on top, one paper behind
 * it for each earlier version (up to three), and the organization's seal stamped on the
 * corner. The stack is the amendment count at a glance; the history lists each one.
 */
export function ConstitutionPanel({ acronym, logo, constitution }: ConstitutionPanelProps) {
  return (
    <section id="constitution" aria-labelledby="constitution-heading" className="scroll-mt-28">
      <h2 id="constitution-heading" className={H2}>
        Constitution &amp; By-laws
      </h2>
      {constitution.status === 'ready' ? (
        <div className="group/panel mt-8 flex flex-col items-start">
          {/* The sheet repeats the pill's link for pointers; keyboards and readers use the pill. */}
          <OriginLink
            to={constitution.readHref}
            tabIndex={-1}
            aria-hidden="true"
            className="group/sheet relative block w-[min(100%,15rem)] pr-[18px] pb-[18px]"
          >
            {Array.from({ length: constitution.layers }, (_, i) => constitution.layers - i).map(
              (depth) => (
                <span
                  key={depth}
                  className={cn(
                    SHEET,
                    'ease-cinematic absolute top-0 left-0 border border-surface-deep bg-white shadow-[0_6px_14px_-8px_rgb(0_0_0/0.35)] transition-transform duration-500 motion-reduce:transition-none',
                    '[transform:translate(calc(var(--depth)*6px),calc(var(--depth)*6px))]',
                    'group-hover/sheet:[transform:translate(calc(var(--depth)*10px),calc(var(--depth)*7px))_rotate(calc(var(--depth)*1.2deg))]',
                    'group-has-[[data-read]:focus-visible]/panel:[transform:translate(calc(var(--depth)*10px),calc(var(--depth)*7px))_rotate(calc(var(--depth)*1.2deg))]',
                  )}
                  style={{ '--depth': depth } as CSSProperties}
                />
              ),
            )}
            <span
              className={cn(
                SHEET,
                'ease-cinematic relative block overflow-hidden border border-surface-deep bg-white shadow-pool transition-transform duration-500 group-hover/sheet:-translate-y-1.5 group-has-[[data-read]:focus-visible]/panel:-translate-y-1.5 motion-reduce:transition-none',
              )}
            >
              {constitution.thumbnail ? (
                <img
                  src={constitution.thumbnail}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover object-top"
                />
              ) : (
                // Until page 1 is rendered: a plain title page, never imitation text.
                <span className="flex size-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <span className="text-h3 font-bold text-ink">{acronym}</span>
                  <span aria-hidden="true" className="h-px w-10 bg-sage" />
                  <span className="text-small text-ink-muted">Constitution &amp; By-laws</span>
                </span>
              )}
            </span>
            <HexFrame
              shadow
              className="absolute right-0 bottom-0 w-[4.5rem]"
              contentClassName="p-[20%]"
            >
              <OrgLogo
                name={logo.name}
                src={logo.logoSrc}
                srcSet={logo.logoSrcSet}
                sizes="72px"
                alt=""
                fallbackText={acronym}
                className="size-full"
              />
            </HexFrame>
          </OriginLink>

          {constitution.dateLine ? (
            <p className="mt-6 text-body text-ink">
              <time dateTime={constitution.dateIso ?? undefined}>{constitution.dateLine}</time>
            </p>
          ) : null}
          <PillButton asChild className="mt-4">
            <OriginLink to={constitution.readHref} data-read>
              Read the constitution
            </OriginLink>
          </PillButton>
          <p className="mt-3 text-small text-ink-muted">
            View only. {acronym} keeps the original file.
          </p>

          {constitution.history.length > 1 ? (
            <details className="group/history mt-6 w-full">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-full text-body font-medium text-ink underline decoration-1 underline-offset-4 hover:decoration-leaf focus-visible:decoration-leaf [&::-webkit-details-marker]:hidden">
                Amendment history ({constitution.history.length} versions)
              </summary>
              <ol className="mt-2">
                {constitution.history.map((entry) => (
                  <li key={entry.id} className="border-t border-sage/50 py-4">
                    <p className="text-body font-semibold text-ink">{entry.label}</p>
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
      ) : constitution.status === 'none' ? (
        <div className="mt-8 flex flex-col items-start">
          <div
            className={cn(
              SHEET,
              'flex w-[min(100%,15rem)] items-center justify-center border-2 border-dashed border-sage bg-white/50 px-6 text-center',
            )}
          >
            <p className="text-body font-medium text-ink-muted">Not uploaded yet</p>
          </div>
          <p className="mt-6 max-w-[34ch] text-body text-pretty text-ink">
            {acronym} has not uploaded its Constitution &amp; By-laws.
          </p>
          {constitution.canUpload ? (
            <PillButton asChild className="mt-4">
              <OriginLink to="/dashboard/profile#constitution">Upload it from your profile</OriginLink>
            </PillButton>
          ) : null}
        </div>
      ) : constitution.status === 'error' ? (
        <SectionError
          className="mt-8"
          message="The Constitution & By-laws could not be loaded. Check your connection and try again."
          onRetry={constitution.retry}
        />
      ) : (
        <div aria-busy="true" className="mt-8">
          <Skeleton className={cn(SHEET, 'w-[min(100%,15rem)]')} />
          <Skeleton className="mt-6 h-5 w-52" />
        </div>
      )}
    </section>
  );
}

function ContactPanel({ email, links }: { email: string | null; links: ContactLink[] }) {
  return (
    <section aria-labelledby="contact-heading">
      <h2 id="contact-heading" className={H2}>
        Contact
      </h2>
      <ul className="mt-6">
        {email ? (
          <li className="border-t border-sage/50">
            <a href={`mailto:${email}`} className="group flex min-h-14 items-center gap-3 py-3">
              <Mail aria-hidden="true" className="size-5 shrink-0 text-forest-700" />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-ink">Email</span>
                {' '}
                <span className="block text-small break-all text-ink-muted underline decoration-transparent underline-offset-4 transition-colors duration-300 group-hover:decoration-leaf group-focus-visible:decoration-leaf">
                  {email}
                </span>
              </span>
            </a>
          </li>
        ) : null}
        {links.map((link) => (
          <li key={link.url} className="border-t border-sage/50">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex min-h-14 items-center gap-3 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink">{link.label}</span>
                {' '}
                <span className="block text-small break-all text-ink-muted underline decoration-transparent underline-offset-4 transition-colors duration-300 group-hover:decoration-leaf group-focus-visible:decoration-leaf">
                  {link.display}
                </span>
              </span>
              <ArrowUpRight
                aria-hidden="true"
                className="size-5 shrink-0 text-ink-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-focus-visible:translate-x-0.5 group-focus-visible:-translate-y-0.5 motion-reduce:transition-none"
              />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
