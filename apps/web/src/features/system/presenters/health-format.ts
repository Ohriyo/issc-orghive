import type { HealthFact, HealthStatus } from '@orghive/shared';
import { formatCount, formatDateTime } from './system-format';

/*
 * Formatting for /system/health and /system/metrics: sizes, durations and shares in the
 * console's voice. No JSX.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 → "1.5 KB"; binary steps, one decimal under 10. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** 0.0523 → "5.2%"; whole percent from 10% up. */
export function formatPercent(ratio: number): string {
  const percent = ratio * 100;
  return `${percent >= 10 || percent === 0 ? Math.round(percent) : percent.toFixed(1)}%`;
}

/** 850 → "850 ms", 2400 → "2.4 s". */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 90 → "1 min", 7_200 → "2 h", 200_000 → "2 d 7 h". */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `${Math.round(seconds)} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** A health fact as text: "Not known" when the service did not say. */
export function formatFact(fact: HealthFact): string {
  if (fact.value === null) return 'Not known';
  if (typeof fact.value === 'string') {
    return fact.unit === 'datetime' ? formatDateTime(fact.value) : fact.value;
  }
  switch (fact.unit) {
    case 'bytes':
      return formatBytes(fact.value);
    case 'percent':
      return formatPercent(fact.value);
    case 'ms':
      return formatMs(fact.value);
    case 'seconds':
      return formatDuration(fact.value);
    default:
      return formatCount(fact.value);
  }
}

/** Never color alone: every status also has words. */
export const STATUS_LABELS: Record<HealthStatus, string> = {
  ok: 'Healthy',
  warn: 'Needs a look',
  down: 'Down',
};
