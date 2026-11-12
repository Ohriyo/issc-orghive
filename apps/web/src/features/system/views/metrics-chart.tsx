import { useId } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { usePrefersReducedMotion } from '@/components/motion';
import type { ChartModel } from '../presenters/use-system-metrics';

/** Colors from the theme tokens, never raw values (CLAUDE.md, UI conventions). */
const INK = 'var(--color-ink)';
const MUTED = 'var(--color-ink-muted)';
const GRID = 'var(--color-border)';
const FILL = 'var(--color-sage)';

const AXIS = { fontSize: 12, fill: MUTED } as const;

/**
 * One metric over time. A figure with a caption and the newest value in words, so the
 * numbers do not depend on reading the chart; points with no data are gaps, not zeros.
 */
export function MetricsChart({ chart }: { chart: ChartModel }) {
  const reduced = usePrefersReducedMotion();
  const captionId = useId();
  const data = chart.points.map((p) => ({ label: p.label, value: p.value }));
  const tooltip = (
    <Tooltip
      formatter={(value) => [
        typeof value === 'number' ? chart.format(value) : 'No data',
        chart.title,
      ]}
      contentStyle={{ borderRadius: 12, borderColor: 'var(--color-border)', fontSize: 13 }}
      labelStyle={{ color: INK, fontWeight: 600 }}
    />
  );
  const axes = (
    <>
      <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey="label"
        tick={AXIS}
        tickLine={false}
        axisLine={{ stroke: GRID }}
        minTickGap={24}
      />
      <YAxis
        tick={AXIS}
        tickLine={false}
        axisLine={false}
        width={64}
        tickFormatter={(v: number) => chart.format(v)}
        allowDecimals={false}
      />
    </>
  );
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 }, title: chart.title };

  return (
    <figure
      aria-labelledby={captionId}
      className="flex min-w-0 flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-border"
    >
      <figcaption
        id={captionId}
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      >
        <span className="text-body-lg font-semibold text-ink">{chart.title}</span>
        <span className="text-small text-ink-muted">
          Latest: <span className="font-semibold text-ink tabular-nums">{chart.latest}</span>
        </span>
        <span className="sr-only">{chart.description}</span>
      </figcaption>
      <p aria-hidden="true" className="-mt-2 text-small text-ink-muted">
        {chart.description}
      </p>
      <div className="h-48 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          {chart.kind === 'bar' ? (
            <BarChart {...common}>
              {axes}
              {tooltip}
              <Bar
                dataKey="value"
                fill={FILL}
                stroke={INK}
                radius={[6, 6, 0, 0]}
                isAnimationActive={!reduced}
              />
            </BarChart>
          ) : chart.kind === 'area' ? (
            <AreaChart {...common}>
              {axes}
              {tooltip}
              <Area
                type="monotone"
                dataKey="value"
                stroke={INK}
                strokeWidth={2}
                fill={FILL}
                fillOpacity={0.35}
                connectNulls={false}
                isAnimationActive={!reduced}
              />
            </AreaChart>
          ) : (
            <LineChart {...common}>
              {axes}
              {tooltip}
              <Line
                type="monotone"
                dataKey="value"
                stroke={INK}
                strokeWidth={2}
                dot={false}
                connectNulls={false}
                isAnimationActive={!reduced}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
