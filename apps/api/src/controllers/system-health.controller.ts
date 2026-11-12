import type { RequestHandler } from 'express';
import { systemMetricsQuerySchema } from '@orghive/shared';
import type { SystemAlertService } from '#src/services/system-alert.service';
import type { SystemHealthService } from '#src/services/system-health.service';
import type { SystemMetricsService } from '#src/services/system-metrics.service';

/** /system/health, /system/metrics and /system/alerts: reads only, for the super admin. */
export function createSystemHealthController(
  health: Pick<SystemHealthService, 'check'>,
  metrics: Pick<SystemMetricsService, 'read'>,
  alerts: Pick<SystemAlertService, 'listOpen'>,
) {
  const getHealth: RequestHandler = async (_req, res) => {
    res.json(await health.check());
  };

  const getMetrics: RequestHandler = async (req, res) => {
    const { range } = systemMetricsQuerySchema.parse(req.query);
    res.json(await metrics.read(range));
  };

  const getAlerts: RequestHandler = async (_req, res) => {
    res.json(await alerts.listOpen());
  };

  return { getHealth, getMetrics, getAlerts };
}
