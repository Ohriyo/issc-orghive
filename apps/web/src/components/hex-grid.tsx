import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { cn } from '@/lib/utils';
import { HexFrame } from './hex-frame';
import { LOGO_SIZES } from './logo-sizes';
import { OrgLogo } from './org-logo';

export interface HexGridItem {
  id: string;
  /** Accessible name, e.g. the organization's full name. */
  label: string;
  logoSrc?: string;
  logoSrcSet?: string;
  /** Defaults to "<label> logo". */
  logoAlt?: string;
  /** Short name shown if the logo is missing or fails, e.g. "CEA". Defaults to initials. */
  shortName?: string;
  href?: string;
}

/** `null` renders an empty decorative hexagon, as the prototype uses to fill out the honeycomb. */
export type HexGridCell = HexGridItem | null;

export interface HexGridProps {
  cells: HexGridCell[];
  /** Columns from 768 px up. */
  columns?: number;
  /** Columns below 768 px. */
  mobileColumns?: number;
  /** Gap between hexagons in px. */
  gap?: number;
  /** Decorative fillers leave random-looking holes once the grid reflows, so phones drop them. */
  hideFillersOnMobile?: boolean;
  isLoading?: boolean;
  /** Number of placeholder hexagons while loading. */
  skeletonCount?: number;
  /** Placeholders below 768 px, so the loading grid matches the real one. Defaults to `skeletonCount`. */
  mobileSkeletonCount?: number;
  /** Shown when there are no cells and nothing is loading. */
  emptyState?: ReactNode;
  /** When set, shown instead of the grid, e.g. a message with a retry button. */
  error?: ReactNode;
  className?: string;
  /** Accessible name for the grid, e.g. "Colleges". */
  label?: string;
}

const COS30 = Math.sqrt(3) / 2;

type ShownCell = HexGridCell | 'skeleton';

/**
 * Honeycomb of flat hexagons. Every other column is offset by half a hexagon and the
 * columns overlap so the slanted edges sit `gap` apart. Cells stay in data order in the
 * DOM (so Tab and screen readers follow it, row by row) and are placed with CSS.
 */
export function HexGrid({
  cells,
  columns = 4,
  mobileColumns = 2,
  gap = 14,
  hideFillersOnMobile = true,
  isLoading = false,
  skeletonCount = 8,
  mobileSkeletonCount = skeletonCount,
  emptyState,
  error,
  className,
  label,
}: HexGridProps) {
  const isDesktop = useBreakpoint('md');
  const cols = Math.max(1, isDesktop ? columns : mobileColumns);

  if (error) return <div className={className}>{error}</div>;
  if (!isLoading && cells.length === 0) return <div className={className}>{emptyState}</div>;

  const shown: ShownCell[] = isLoading
    ? Array.from(
        { length: isDesktop ? skeletonCount : mobileSkeletonCount },
        () => 'skeleton' as const,
      )
    : !isDesktop && hideFillersOnMobile
      ? cells.filter(Boolean)
      : cells;

  // Tallest column, in hexagon heights: a column with k cells is k tall, plus half when offset.
  let heightUnits = 0;
  for (let c = 0; c < cols; c++) {
    const k = Math.ceil((shown.length - c) / cols);
    if (k > 0) heightUnits = Math.max(heightUnits, k + (c % 2) / 2);
  }

  const gridStyle = {
    '--hex-gap': `${gap}px`,
    // Hexagon width that makes `cols` columns exactly fill the container.
    '--hex-w': `calc((100cqw - ${((cols - 1) * COS30 * gap).toFixed(2)}px) / ${1 + 0.75 * (cols - 1)})`,
    '--hex-h': `calc(var(--hex-w) * ${COS30})`,
    height: `calc(${heightUnits} * var(--hex-h) + ${heightUnits - 1} * var(--hex-gap))`,
  } as CSSProperties;

  return (
    <div
      className={cn('@container w-full', className)}
      aria-busy={isLoading || undefined}
      aria-label={label}
      role={label ? 'region' : undefined}
    >
      <ul className="relative" style={gridStyle}>
        {shown.map((cell, i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          const position: CSSProperties = {
            left: `calc(${c} * (var(--hex-w) * 0.75 + ${COS30} * var(--hex-gap)))`,
            top: `calc(${r + (c % 2) / 2} * (var(--hex-h) + var(--hex-gap)))`,
          };
          const decorative = cell === 'skeleton' || cell === null;
          return (
            <li
              key={cell && cell !== 'skeleton' ? cell.id : `filler-${i}`}
              className="absolute w-(--hex-w)"
              style={position}
              aria-hidden={decorative || undefined}
            >
              <HexGridCellView cell={cell} />
            </li>
          );
        })}
      </ul>
      {isLoading && <span className="sr-only">Loading</span>}
    </div>
  );
}

function HexGridCellView({ cell }: { cell: ShownCell }) {
  if (cell === 'skeleton') {
    return (
      <HexFrame
        band={false}
        ring={false}
        shadow={false}
        className="w-full animate-pulse opacity-60 motion-reduce:animate-none"
      />
    );
  }

  // Fillers are flatter than real cells, so they read as texture rather than as targets.
  if (!cell) {
    return <HexFrame band={false} ring={false} shadow={false} className="w-full opacity-80" />;
  }

  const frame = (
    <HexFrame band={false} ring="interactive" shadow={false} className="w-full">
      <OrgLogo
        name={cell.label}
        src={cell.logoSrc}
        srcSet={cell.logoSrcSet}
        sizes={LOGO_SIZES.honeycomb}
        alt={cell.logoAlt}
        fallbackText={cell.shortName}
        className="ease-cinematic size-full transition-transform duration-500 group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:transition-none"
      />
    </HexFrame>
  );

  if (!cell.href) return frame;

  // Outline and box-shadow are clipped away by the hexagon, so focus is drawn as an ink
  // ring that follows the hexagon's silhouette, with the white inner ring revealed inside it.
  return (
    <Link
      to={cell.href}
      aria-label={cell.label}
      className="group block focus-visible:hex-focus-ring focus-visible:shadow-none focus-visible:outline-none"
    >
      {frame}
    </Link>
  );
}
