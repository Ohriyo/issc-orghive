import { useId } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { PillButton } from '@/components/pill-button';
import { cn } from '@/lib/utils';
export interface FilterOption {
  value: string;
  label: string;
}

/** What a presenter gives a filter bar: a search box plus selects, kept in the URL. */
export interface FilterBarModel<K extends string> {
  values: Record<K, string>;
  /** What the search box shows right away; the URL follows after a short pause. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  set: (name: K, value: string) => void;
  clear: () => void;
  /** How many filters are on, for the phone Filters button. */
  activeCount: number;
}

export interface FilterSelectSpec<K extends string> {
  name: K;
  label: string;
  /** The empty option, e.g. "All types". */
  all: string;
  options: FilterOption[];
}

interface FilterBarProps<K extends string> {
  filters: FilterBarModel<K>;
  selects: FilterSelectSpec<K>[];
  /** Placeholder of the search box: what it searches. */
  placeholder: string;
  /** False when the page shows its own search box (the /search page): selects only. */
  search?: boolean;
}

const FIELD =
  'h-12 w-full rounded-full border border-input bg-white text-body text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-300 hover:border-forest-500';
const LABEL = 'mb-1.5 block text-small font-medium text-ink';

/** Selects only: two per row on tablets, all in one row from lg. */
const SELECTS_ONLY_ROW = 'grid-cols-2 items-end gap-3 lg:grid-cols-4';

/**
 * Row layouts by number of selects (static class names for Tailwind). The search box has its
 * own row on tablets; everything shares one row from lg with three selects, from xl with four.
 */
const ROW_LAYOUT: Record<3 | 4, { grid: string; search: string }> = {
  3: {
    grid: 'grid-cols-3 items-end gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]',
    search: 'col-span-3 lg:col-span-1',
  },
  4: {
    grid: 'grid-cols-4 items-end gap-3 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]',
    search: 'col-span-4 xl:col-span-1',
  },
};

/**
 * The search box and filter selects. `row` is for md and up (search above the selects on
 * tablets, all in one line on wide screens);
 * `stack` puts them one under another (inside the phone bottom sheet).
 */
export function FilterFields<K extends string>({
  filters,
  selects,
  placeholder,
  search = true,
  layout,
}: FilterBarProps<K> & { layout: 'row' | 'stack' }) {
  const id = useId();
  const row = ROW_LAYOUT[selects.length === 4 ? 4 : 3];
  return (
    <div className={cn('grid gap-4', layout === 'row' && (search ? row.grid : SELECTS_ONLY_ROW))}>
      {search ? (
        <div className={cn(layout === 'row' && row.search)}>
          <label htmlFor={`${id}-q`} className={LABEL}>
            Search
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-muted"
            />
            <input
              id={`${id}-q`}
              type="search"
              value={filters.searchInput}
              onChange={(event) => filters.setSearchInput(event.target.value)}
              placeholder={placeholder}
              enterKeyHint="search"
              className={cn(FIELD, 'pr-5 pl-11 placeholder:text-ink-muted/80')}
            />
          </div>
        </div>
      ) : null}
      {selects.map((select) => (
        <FilterSelect
          key={select.name}
          id={`${id}-${select.name}`}
          label={select.label}
          all={select.all}
          value={filters.values[select.name]}
          options={select.options}
          onChange={(value) => filters.set(select.name, value)}
        />
      ))}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  all,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  all: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(FIELD, 'cursor-pointer appearance-none pr-11 pl-5')}
        >
          <option value="">{all}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2 text-ink-muted"
        />
      </div>
    </div>
  );
}

/**
 * Below md: a Filters button that opens the fields in a bottom sheet (a modal dialog:
 * focus stays inside, Esc or "Show results" closes it). Filters apply as they change.
 */
export function FilterSheet<K extends string>({
  filters,
  selects,
  placeholder,
  search,
}: FilterBarProps<K>) {
  const count = filters.activeCount;
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <PillButton variant="light" size="md">
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {count > 0 ? (
            <span className="grid size-6 place-items-center rounded-full bg-ink text-caption text-white">
              {count}
              <span className="sr-only"> on</span>
            </span>
          ) : null}
        </PillButton>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-ink/40 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-3xl bg-white px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] shadow-pool-lift duration-300 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom motion-reduce:animate-none"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-surface-deep"
          />
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-h3 font-bold text-ink">Filters</Dialog.Title>
            <Dialog.Close
              aria-label="Close filters"
              className="grid size-11 cursor-pointer place-items-center rounded-full text-ink transition-colors duration-300 hover:bg-surface focus-visible:bg-surface"
            >
              <X aria-hidden="true" className="size-6" />
            </Dialog.Close>
          </div>
          <FilterFields
            filters={filters}
            selects={selects}
            placeholder={placeholder}
            search={search}
            layout="stack"
          />
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <PillButton variant="light" size="md" onClick={filters.clear} disabled={count === 0}>
              Clear all
            </PillButton>
            <Dialog.Close asChild>
              <PillButton size="md">Show results</PillButton>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
