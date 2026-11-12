import { RotateCw } from 'lucide-react';
import { Link } from 'react-router';
import type { SecurityRange } from '@orghive/shared';
import { SelectField } from '@/components/form-fields';
import { PillButton } from '@/components/pill-button';
import { SectionError } from '@/components/section-error';
import { cn } from '@/lib/utils';
import { OriginLink } from '@/navigation/origin-link';
import type { SecurityCenterModel } from '../presenters/use-security-center';
import { SystemLoading } from './system-layout';

type Ready = Extract<SecurityCenterModel, { status: 'ready' }>;

const PANEL = 'rounded-xl bg-white ring-1 ring-border';
const LINK =
  'tap-area rounded-sm font-medium text-ink underline decoration-transparent underline-offset-4 transition-colors hover:decoration-ink focus-visible:decoration-ink';

export function SecurityCenterRefreshButton({ model }: { model: SecurityCenterModel }) {
  if (model.status !== 'ready') return null;
  return (
    <PillButton variant="light" onClick={model.refresh} disabled={model.isRefreshing}>
      <RotateCw aria-hidden="true" className={cn(model.isRefreshing && 'animate-spin')} />
      Refresh
    </PillButton>
  );
}

/** One titled list; an empty one says so instead of disappearing. */
function Section({
  id,
  title,
  description,
  empty,
  count,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 id={id} className="text-h3 font-bold text-ink">
          {title}
        </h2>
        {description ? <p className="text-small text-ink-muted">{description}</p> : null}
      </div>
      {count === 0 ? (
        <p className={cn(PANEL, 'px-5 py-4 text-body text-ink-muted')}>{empty}</p>
      ) : (
        <ul className={cn(PANEL, 'divide-y divide-border')}>{children}</ul>
      )}
    </section>
  );
}

/** A row: what on the left, how many or when on the right. */
function Row({
  main,
  detail,
  aside,
}: {
  main: React.ReactNode;
  detail?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <div className="text-body break-words text-ink">{main}</div>
        {detail ? <div className="text-small break-words text-ink-muted">{detail}</div> : null}
      </div>
      {aside ? (
        <div className="shrink-0 text-right text-body font-semibold text-ink tabular-nums">
          {aside}
        </div>
      ) : null}
    </li>
  );
}

/** /system/security-center */
export function SecurityCenterView({ model }: { model: SecurityCenterModel }) {
  return (
    <div className="flex flex-col gap-8">
      <SelectField
        label="Period"
        className="sm:max-w-xs"
        options={model.rangeOptions}
        value={model.range}
        onChange={(event) => model.setRange(event.target.value as SecurityRange)}
      />
      {model.status === 'loading' ? (
        <SystemLoading label="Loading the security center" />
      ) : model.status === 'error' ? (
        <SectionError message="The security center could not be loaded." onRetry={model.retry} />
      ) : (
        <Ready model={model} />
      )}
    </div>
  );
}

function Ready({ model }: { model: Ready }) {
  const stats = [
    { label: 'Failed sign-ins', value: model.failedLogins.total },
    { label: 'Accounts on hold', value: String(model.lockedAccounts.length) },
    { label: 'Rate limit hits', value: model.rateLimits.total },
    { label: 'Quarantined files', value: String(model.quarantined.total) },
  ];
  return (
    <>
      <dl className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className={cn(PANEL, 'flex flex-col gap-1 p-5')}>
            <dt className="text-small font-medium text-ink-muted">{stat.label}</dt>
            <dd className="order-first text-h2 font-bold text-ink tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-4 text-small text-ink-muted">
        Since {model.since}, as of {model.generatedAt}, Manila time. Holds and quarantine are shown
        whenever they started.
      </p>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          id="failed-ip-heading"
          title="Failed sign-ins by IP"
          description="Wrong passwords, blocked accounts and wrong authenticator codes."
          empty="No failed sign-ins in this period."
          count={model.failedLogins.byIp.length}
        >
          {model.failedLogins.byIp.map((row) => (
            <Row key={row.key} main={row.ip} detail={`Last ${row.last}`} aside={row.count} />
          ))}
        </Section>
        <Section
          id="failed-account-heading"
          title="Failed sign-ins by account"
          description="An email that belongs to no account is listed as typed."
          empty="No failed sign-ins in this period."
          count={model.failedLogins.byAccount.length}
        >
          {model.failedLogins.byAccount.map((row) => (
            <Row
              key={row.key}
              main={
                row.userId ? (
                  <OriginLink
                    to={`/system/users/${row.userId}`}
                    className={cn(LINK, 'break-words')}
                  >
                    {row.account}
                  </OriginLink>
                ) : (
                  <span className="break-words">{row.account}</span>
                )
              }
              detail={`${row.detail} · last ${row.last}`}
              aside={row.count}
            />
          ))}
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          id="holds-heading"
          title="Accounts on hold"
          description="Locked by a super admin or the end of term. Open one to lift its hold."
          empty="No account is on hold."
          count={model.lockedAccounts.length}
        >
          {model.lockedAccounts.map((row) => (
            <Row
              key={row.userId}
              main={
                <OriginLink to={`/system/users/${row.userId}`} className={cn(LINK, 'break-words')}>
                  {row.account}
                </OriginLink>
              }
              detail={`${row.reason} · since ${row.since}`}
            />
          ))}
        </Section>
        <Section
          id="lockouts-heading"
          title="Super admin lockouts"
          description="5 wrong passwords or codes in 15 minutes lock that account and IP for 15 minutes."
          empty="No lockouts in this period."
          count={model.superAdminLockouts.length}
        >
          {model.superAdminLockouts.map((row) => (
            <Row key={row.key} main={row.account} detail={`${row.ip} · ${row.at}`} />
          ))}
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          id="limits-heading"
          title="Rate limit hits by limit"
          description="Requests refused with “Too many attempts”."
          empty="No request was refused in this period."
          count={model.rateLimits.byLimiter.length}
        >
          {model.rateLimits.byLimiter.map((row) => (
            <Row key={row.key} main={row.label} aside={row.hits} />
          ))}
        </Section>
        <Section
          id="limits-ip-heading"
          title="Rate limit hits by IP"
          empty="No request was refused in this period."
          count={model.rateLimits.byIp.length}
        >
          {model.rateLimits.byIp.map((row) => (
            <Row key={row.key} main={row.ip} detail={row.limiters} aside={row.hits} />
          ))}
        </Section>
      </div>

      <Section
        id="admin-actions-heading"
        title="Recent super admin actions"
        description="Page views left out."
        empty="No super admin action yet."
        count={model.adminActions.length}
      >
        {model.adminActions.map((row) => (
          <Row
            key={row.id}
            main={
              <>
                <span className="font-semibold">{row.action}</span> · {row.actor}
              </>
            }
            detail={
              <>
                <span className="break-all">{row.target}</span> · {row.when}
              </>
            }
          />
        ))}
      </Section>
      <p className="-mt-4 text-body">
        <Link to="/system/audit" className={LINK}>
          Open the full audit log
        </Link>
      </p>

      <Section
        id="quarantine-heading"
        title="Quarantined files"
        description={
          model.quarantined.shown < model.quarantined.total
            ? `The newest ${model.quarantined.shown} of ${model.quarantined.total}. Only the uploading organization sees them; private titles stay hidden here.`
            : 'Only the uploading organization sees them; private titles stay hidden here.'
        }
        empty="No file is in quarantine."
        count={model.quarantined.rows.length}
      >
        {model.quarantined.rows.map((row) => (
          <Row
            key={row.id}
            main={
              <>
                <span className="font-semibold">{row.organization}</span> · {row.title}
              </>
            }
            detail={
              <>
                {row.kind}
                {row.reason ? <span className="break-words">: {row.reason}</span> : null} ·{' '}
                {row.file} · {row.when}
              </>
            }
          />
        ))}
      </Section>
    </>
  );
}
