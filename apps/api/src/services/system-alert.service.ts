import { ALERT_KINDS, alertKindSchema, type AlertKind, type SystemAlerts } from '@orghive/shared';
import type { Mailer } from '#src/lib/mailer';
import { escapeHtml } from '#src/lib/report-template';
import type { Logger } from '#src/logger';
import type { SystemAlertRepository } from '#src/repositories/system-alert.repository';
import type { SystemMetricsRepository } from '#src/repositories/system-metrics.repository';
import type { SystemRepository } from '#src/repositories/system.repository';
import type { SystemSettingsService } from '#src/services/system-settings.service';
import { planAlerts, shouldNotify, THRESHOLDS } from '#src/services/system-health-rules';

const SUBJECTS: Record<AlertKind, string> = {
  error_rate: 'Requests are failing',
  slow_responses: 'Responses are slow',
  worker_down: 'The worker is down',
  disk_full: 'The disk is almost full',
  clamav_outdated: 'Virus signatures are out of date',
};

export interface SystemAlertServiceDeps {
  alerts: Pick<
    SystemAlertRepository,
    'listOpen' | 'open' | 'updateMessage' | 'resolve' | 'lastNotifiedAt' | 'claimNotification'
  >;
  metrics: Pick<SystemMetricsRepository, 'traffic'>;
  /** The probes the alerts need; each may throw (that condition is then not judged). */
  probes: {
    workerHeartbeat: () => Promise<Date | null>;
    diskUsedRatio: () => Promise<number>;
    clamavSignaturesAt: () => Promise<Date | null>;
  };
  settings: Pick<SystemSettingsService, 'alertCooldownMinutes'>;
  superAdmins: Pick<SystemRepository, 'activeSuperAdminEmails'>;
  mailer: Mailer;
  logger: Logger;
  webOrigin: string;
  now?: () => Date;
}

/**
 * Console alerts (/system): every API instance evaluates them each minute. An alert opens
 * when its condition holds (system-health-rules.ts) and resolves when it clears. Opening one
 * emails every super admin, unless the same kind was emailed within the cooldown. The
 * database keeps instances from opening or emailing the same alert twice.
 */
export function createSystemAlertService(deps: SystemAlertServiceDeps) {
  const { alerts, logger } = deps;
  const now = deps.now ?? (() => new Date());

  async function notify(kind: AlertKind, message: string) {
    const recipients = await deps.superAdmins.activeSuperAdminEmails();
    const url = new URL('/system/health', deps.webOrigin).toString();
    for (const to of recipients) {
      await deps.mailer.send({
        to,
        subject: `Orghive alert: ${SUBJECTS[kind]}`,
        text: [message, '', `See the system console: ${url}`].join('\n'),
        html: `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(url)}">See the system console</a></p>`,
      });
    }
  }

  /** Null when the probe failed: that condition is not judged this round. */
  const settle = <T>(promise: Promise<T>, what: string): Promise<T | null> =>
    promise.catch((err: unknown) => {
      logger.warn({ err, probe: what }, 'Alert probe failed');
      return null;
    });

  return {
    /** GET /system/alerts: what the console banner shows. */
    async listOpen(): Promise<SystemAlerts> {
      const rows = await alerts.listOpen();
      return {
        alerts: rows.flatMap((row) => {
          const kind = alertKindSchema.safeParse(row.kind);
          return kind.success
            ? [{ id: row.id, kind: kind.data, message: row.message, openedAt: row.openedAt.toISOString() }]
            : [];
        }),
      };
    },

    /** Opens, updates and resolves alerts; returns the kinds open after it. */
    async evaluate(): Promise<AlertKind[]> {
      const at = now();
      const windowStart = new Date(at.getTime() - THRESHOLDS.alertWindowMinutes * 60_000);
      // Wrapped, so "the probe failed" (null) differs from "no heartbeat" or "no date".
      const [traffic, heartbeat, disk, clamav] = await Promise.all([
        settle(deps.metrics.traffic(windowStart), 'traffic'),
        settle(deps.probes.workerHeartbeat().then((value) => ({ value })), 'worker'),
        settle(deps.probes.diskUsedRatio(), 'disk'),
        settle(deps.probes.clamavSignaturesAt().then((value) => ({ value })), 'clamav'),
      ]);

      const plan = planAlerts({
        now: at,
        traffic: traffic ?? { requests: 0, serverErrors: 0, p95Ms: null },
        workerHeartbeatAt: heartbeat ? heartbeat.value : at,
        diskUsedRatio: disk,
        clamavSignaturesAt: clamav?.value ?? null,
      });
      // A probe that failed leaves its alerts as they were rather than resolving them: with
      // Redis down the worker cannot be judged (health shows Redis red instead).
      const unjudged = new Set<AlertKind>([
        ...(traffic === null ? (['error_rate', 'slow_responses'] as const) : []),
        ...(heartbeat === null ? (['worker_down'] as const) : []),
        ...(disk === null ? (['disk_full'] as const) : []),
        ...(clamav === null ? (['clamav_outdated'] as const) : []),
      ]);

      const cooldown = await deps.settings.alertCooldownMinutes();
      const open: AlertKind[] = [];
      for (const kind of ALERT_KINDS) {
        const message = plan[kind];
        if (unjudged.has(kind)) continue;
        if (message === undefined) {
          await alerts.resolve(kind, at);
          continue;
        }
        open.push(kind);
        const created = await alerts.open(kind, message, at);
        if (!created) {
          await alerts.updateMessage(kind, message);
          continue;
        }
        logger.warn({ alert: kind }, message);
        const last = await alerts.lastNotifiedAt(kind);
        if (shouldNotify(last, at, cooldown) && (await alerts.claimNotification(created.id, at))) {
          await notify(kind, message).catch((err: unknown) =>
            logger.error({ err, alert: kind }, 'Alert email failed'),
          );
        }
      }
      return open;
    },
  };
}

export type SystemAlertService = ReturnType<typeof createSystemAlertService>;
