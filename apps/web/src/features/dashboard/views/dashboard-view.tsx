import { AlertTriangle, Compass, ExternalLink, Upload } from 'lucide-react';
import { OriginLink } from '@/navigation/origin-link';
import { Container } from '@/components/container';
import { HexFrame } from '@/components/hex-frame';
import { OrgLogo } from '@/components/org-logo';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { WaveDivider } from '@/components/wave-divider';
import type { ComplianceModel } from '@/features/appeals/presenters/use-compliance';
import { ComplianceBanner } from '@/features/appeals/views/compliance-banner';
import type { ProjectsOverviewModel } from '@/features/projects/presenters/use-projects';
import type { SemestralReportsModel } from '@/features/reports/presenters/use-semestral-reports';
import { SemestralReportsPanel } from '@/features/reports/views/semestral-reports-panel';
import { ProjectsOverview } from '@/features/projects/views/projects-overview';
import type { ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import type { MyStandingModel } from '@/features/leaderboard/presenters/use-my-standing';
import { StandingCard } from '@/features/leaderboard/views/standing-card';
import type { DashboardModel, SelectedOrganization } from '../presenters/use-dashboard';
import {
  NeedsAttention,
  RecentActivity,
  RolePanels,
  StatTiles,
  ThisSemester,
} from './dashboard-sections';
import { OrgSwitcher } from './org-switcher';

export interface DashboardViewProps {
  model: DashboardModel;
  /** The selected organization's projects in progress (null until one is selected). */
  projects?: ProjectsOverviewModel | null;
  /** The selected organization's blocks and freezes (spec section 3). */
  compliance?: ComplianceModel | null;
  /** The Semestral End Report panel, for the selected organization's officers only. */
  reports?: SemestralReportsModel | null;
  /** Its place on the leaderboard (SBOs and CSCs; off for the ISSC). */
  standing?: MyStandingModel | null;
}

/**
 * /dashboard: where signed-in users land. One organization at a time: its header, counts
 * by status, what needs attention and what happened lately. On phones the two main
 * actions stay in a bar at the bottom of the screen.
 */
export function DashboardView({
  model,
  projects = null,
  compliance = null,
  reports = null,
  standing = null,
}: DashboardViewProps) {
  const selected = model.status === 'ready' ? model.selected : null;
  return (
    <div className="bg-surface-sweep min-h-page">
      <title>
        {selected ? `${selected.org.acronym} dashboard | Orghive` : 'Dashboard | Orghive'}
      </title>
      <Container
        as="main"
        className={selected ? 'pt-6 pb-36 md:pb-section lg:pt-10' : 'pt-6 pb-section lg:pt-10'}
      >
        {model.status === 'loading' ? (
          <DashboardSkeleton />
        ) : model.status === 'error' ? (
          <>
            <h1 className="text-h1 font-bold text-ink">Dashboard</h1>
            <SectionError
              className="mt-6"
              message="Your dashboard could not be loaded. Check your connection and try again."
              onRetry={model.retry}
            />
          </>
        ) : (
          <>
            <p className="text-lead text-ink-muted">{model.greeting}</p>
            {model.organizations.length > 1 && selected ? (
              <OrgSwitcher
                className="mt-5"
                organizations={model.organizations}
                selectedId={selected.org.id}
                onSelect={model.selectOrganization}
              />
            ) : null}
            {selected ? (
              <OrganizationDashboard
                org={selected}
                onRevise={(id, file) => void model.revise(id, file)}
                actingAs={model.actingAs}
                panels={<RolePanels panels={model.panels} />}
                projects={projects ? <ProjectsOverview model={projects} /> : null}
                compliance={
                  <ComplianceBanner model={compliance} showProjectLink className="mt-6" />
                }
                reports={reports ? <SemestralReportsPanel model={reports} /> : null}
                standing={standing ? <StandingCard model={standing} /> : null}
              />
            ) : (
              <NoOrganization panels={<RolePanels panels={model.panels} />} />
            )}
          </>
        )}
      </Container>
      {selected ? <MobileActions org={selected} /> : null}
    </div>
  );
}

function OrganizationDashboard({
  org,
  onRevise,
  actingAs,
  panels,
  projects,
  compliance,
  reports,
  standing,
}: {
  org: SelectedOrganization;
  onRevise: (documentId: string, file: File) => void;
  actingAs: ActingAsModel;
  panels: React.ReactNode;
  projects: React.ReactNode;
  compliance: React.ReactNode;
  reports: React.ReactNode;
  standing: React.ReactNode;
}) {
  const { org: summary, term } = org;
  return (
    <>
      <header className="mt-6 flex flex-col items-center gap-6 text-center md:flex-row md:items-center md:text-left">
        <HexFrame className="w-32 shrink-0 md:w-36 lg:w-44" contentClassName="p-[18%]">
          <OrgLogo
            name={summary.name}
            src={summary.logoUrl ?? undefined}
            srcSet={summary.logoSrcSet ?? undefined}
            sizes="(width >= 64rem) 7rem, 6rem"
            fallbackText={summary.acronym}
            priority
            className="size-full"
          />
        </HexFrame>
        <div className="min-w-0 flex-1">
          <h1 className="text-h1 font-bold break-words text-ink">{summary.acronym}</h1>
          <p className="mt-1 text-lead text-ink">{summary.name}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
            {org.roles.map((role, i) => (
              <span
                key={`${role.label}-${i}`}
                className="inline-flex items-center rounded-full bg-ink px-3 py-1 text-small font-semibold text-white"
              >
                {role.title && role.title !== role.label
                  ? `${role.label}, ${role.title}`
                  : role.label}
              </span>
            ))}
            {term ? <span className="text-small text-ink-muted">{term.label}</span> : null}
          </div>
        </div>
        <div className="hidden shrink-0 flex-col gap-3 md:flex lg:flex-row">
          <PrimaryActions org={org} />
        </div>
      </header>

      {term?.endingSoon ? (
        <p
          role="status"
          className="mt-6 flex items-start gap-3 rounded-2xl bg-caution-surface p-4 text-body text-caution"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>
            {term.daysLeft <= 0
              ? 'This officer term ends today.'
              : `This officer term ends in ${term.daysLeft} ${term.daysLeft === 1 ? 'day' : 'days'}.`}{' '}
            At the end of term the ISSC issues new passwords to the incoming officers. Prepare the
            handover of your projects and files.
          </span>
        </p>
      ) : null}
      {compliance}

      <WaveDivider stretch className="mt-8 -mb-2 h-10 md:h-14" />

      {org.isEmpty ? (
        <section
          aria-labelledby="welcome-heading"
          className="mt-8 flex flex-col items-start gap-4 rounded-3xl bg-white p-6 shadow-pool ring-1 ring-ink/10 md:p-10"
        >
          <h2 id="welcome-heading" className="text-h2 font-bold text-ink">
            Welcome to the {org.org.acronym} workspace
          </h2>
          <p className="max-w-prose text-body-lg text-ink">
            Nothing has been filed yet.{' '}
            {org.uploadHref
              ? 'Upload the first document: once it passes the virus scan it is shared with whoever you choose, and you can change that at any time.'
              : `${org.org.acronym}'s officers upload documents here; they show up on this page as they are filed.`}
          </p>
          {org.uploadHref ? (
            <PillButton asChild size="lg">
              <OriginLink to={org.uploadHref}>
                <Upload aria-hidden="true" />
                Upload document
              </OriginLink>
            </PillButton>
          ) : null}
        </section>
      ) : (
        <div className="mt-8 flex flex-col gap-12">
          <StatTiles tiles={org.tiles} />
          {org.semester ? <ThisSemester semester={org.semester} /> : null}
          {standing}
          {projects}
          {reports}
          {panels}
          <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10">
            <NeedsAttention
              items={org.quarantined}
              canRevise={org.canRevise}
              onRevise={onRevise}
              actingAs={actingAs}
              orgAcronym={summary.acronym}
            />
            <RecentActivity
              activity={org.activity}
              recentDocuments={org.recentDocuments}
              documentsHref={org.documentsHref}
            />
          </div>
        </div>
      )}
      {org.isEmpty ? (
        <div className="mt-8 flex flex-col gap-12">
          {org.semester ? <ThisSemester semester={org.semester} /> : null}
          {projects}
          {reports}
          {panels}
        </div>
      ) : null}
    </>
  );
}

function PrimaryActions({
  org,
  compact = false,
}: {
  org: SelectedOrganization;
  compact?: boolean;
}) {
  // The phone bar has room for two short labels; the full names stay for screen readers.
  return (
    <>
      {org.uploadHref ? (
        <PillButton asChild size="md" className={compact ? 'min-w-0 flex-1' : undefined}>
          <OriginLink to={org.uploadHref}>
            <Upload aria-hidden="true" />
            {compact ? (
              <span>
                Upload<span className="sr-only"> document</span>
              </span>
            ) : (
              'Upload document'
            )}
          </OriginLink>
        </PillButton>
      ) : null}
      <PillButton
        asChild
        variant="light"
        size="md"
        className={compact ? 'min-w-0 flex-1' : undefined}
      >
        <OriginLink to={org.paperworksHref}>
          <ExternalLink aria-hidden="true" />
          {compact ? (
            <span>
              <span className="sr-only">View public </span>Paperworks
            </span>
          ) : (
            'View public Paperworks'
          )}
        </OriginLink>
      </PillButton>
    </>
  );
}

/** Below md the actions stay reachable at the bottom of the screen. */
function MobileActions({ org }: { org: SelectedOrganization }) {
  return (
    <nav
      aria-label={`${org.org.acronym} actions`}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 pb-safe shadow-pool-lift backdrop-blur-sm md:hidden"
    >
      <Container className="flex gap-3 py-3">
        <PrimaryActions org={org} compact />
      </Container>
    </nav>
  );
}

function NoOrganization({ panels }: { panels: React.ReactNode }) {
  return (
    <>
      <section
        aria-labelledby="no-org-heading"
        className="mt-6 flex flex-col items-start gap-4 rounded-3xl bg-white p-6 shadow-pool ring-1 ring-ink/10 md:p-10"
      >
        <h1 id="no-org-heading" className="text-h1 font-bold text-ink">
          This account has no organization
        </h1>
        <p className="max-w-prose text-body-lg text-ink">
          Each organization signs in with its own shared account, and its workspace appears here.
          Every organization’s public Paperworks are open to browse meanwhile.
        </p>
        <PillButton asChild size="lg">
          <OriginLink to="/colleges">
            <Compass aria-hidden="true" />
            Browse colleges
          </OriginLink>
        </PillButton>
      </section>
      <div className="mt-8">{panels}</div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your dashboard">
      <Skeleton className="h-6 w-56" />
      <div className="mt-6 flex flex-col items-center gap-6 md:flex-row">
        <Skeleton className="aspect-[1.1547] w-32 rounded-3xl md:w-36" />
        <div className="flex w-full flex-1 flex-col items-center gap-3 md:items-start">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-6 w-72 max-w-full" />
        </div>
      </div>
      <div className="mt-12 grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-12 h-40 rounded-2xl" />
    </div>
  );
}
