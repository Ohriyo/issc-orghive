import { TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { AlertItem } from '../presenters/use-system-alerts';

/**
 * Open system alerts, above the title of every console page. Shown until the condition
 * clears; the super admins were also emailed.
 */
export function AlertBanner({ alerts }: { alerts: AlertItem[] }) {
  if (alerts.length === 0) return null;
  return (
    <section
      aria-labelledby="system-alerts-heading"
      className="mb-6 rounded-xl bg-destructive px-5 py-4 text-white"
    >
      <h2 id="system-alerts-heading" className="flex items-center gap-2 text-body-lg font-semibold">
        <TriangleAlert aria-hidden="true" className="size-5 shrink-0" />
        {alerts.length === 1 ? 'An alert is open' : `${alerts.length} alerts are open`}
      </h2>
      <ul className="mt-2 flex flex-col gap-1.5 text-body">
        {alerts.map((alert) => (
          <li key={alert.id}>
            {alert.message} <span className="text-small opacity-90">Since {alert.since}.</span>
          </li>
        ))}
      </ul>
      <Link
        to="/system/health"
        className="tap-area mt-3 inline-block text-body font-semibold underline underline-offset-4"
      >
        See system health
      </Link>
    </section>
  );
}
