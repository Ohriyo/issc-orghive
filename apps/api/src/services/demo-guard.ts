import type { DemoDataCounts } from '@orghive/shared';
import type { Logger } from '#src/logger';
import { totalOf } from '#src/repositories/demo-data.repository';
import { demoDataGuard } from './demo-rules';

export interface DemoGuardDeps {
  counts: () => Promise<DemoDataCounts>;
  nodeEnv: string;
  allowDemoData: boolean;
  logger: Pick<Logger, 'fatal' | 'warn'>;
}

/**
 * Run before the API or worker starts (docs/DEPLOYMENT.md, "Demo data"). False: production
 * with demo data and no ALLOW_DEMO_DATA=true, so the process must not start.
 */
export async function demoDataStartAllowed({
  counts,
  nodeEnv,
  allowDemoData,
  logger,
}: DemoGuardDeps): Promise<boolean> {
  if (nodeEnv !== 'production') return true;
  const rows = await counts();
  const demoRows = totalOf(rows);
  const verdict = demoDataGuard({ nodeEnv, allowDemoData, demoRows });
  if (verdict === 'refuse') {
    logger.fatal(
      { demoRows, counts: rows },
      'DEMO DATA PRESENT IN PRODUCTION. Refusing to start. Remove it with `pnpm --filter api db:unseed:demo` (or the super admin console), or set ALLOW_DEMO_DATA=true to start anyway.',
    );
    return false;
  }
  if (verdict === 'allowed') {
    logger.warn(
      { demoRows },
      'Demo data present in production; starting because ALLOW_DEMO_DATA=true',
    );
  }
  return true;
}
