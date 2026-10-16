import { useId } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { PillButton } from '@/components/pill-button';
import { cn } from '@/lib/utils';
import type {
  FilterOption,
  PaperworksFilterModel,
  SelectFilter,
} from '../presenters/use-paperworks';

const FIELD =
  'h-12 w-full rounded-full border border-input bg-white text-body text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-300 hover:border-forest-500';
const LABEL = 'mb-1.5 block text-small font-medium text-ink';

const SELECTS: {
  name: SelectFilter;
  label: string;
  all: string;
  options: keyof PaperworksFilterModel['options'];
}[] = [
  { name: 'type', label: 'Type', all: 'All types', options: 'types' },
  { name: 'year', label: 'Academic year', all: 'All years', options: 'years' },
  { name: 'semester', label: 'Semester', all: 'All semesters', options: 'semesters' },
];

/**
 * The search box and filter selects. `row` is for md and up (search above the selects on
 * tablets, all in one line from lg);
 * `stack` puts them one under another (inside the phone bottom sheet).
 */
export function FilterFields({
  filters,
  layout,
}: {
  filters: PaperworksFilterModel;
  layout: 'row' | 'stack';
}) {
  const id = useId();
  return (
    <div
      className={cn(
        'grid gap-4',
        // Tablets: search on its own row, the three selects below; lg: all four in one row.
        layout === 'row' &&
          'grid-cols-3 items-end gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]',
      )}
    >
      <div className={cn(layout === 'row' && 'col-span-3 lg:col-span-1')}>
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
            placeholder="Title or description"
            enterKeyHint="search"
            className={cn(FIELD, 'pr-5 pl-11 placeholder:text-ink-muted/80')}
          />
        </div>
      </div>
      {SELECTS.map((select) => (
        <FilterSelect
          key={select.name}
          id={`${id}-${select.name}`}
          label={select.label}
          all={select.all}
          value={filters.values[select.name]}
          options={filters.options[select.options]}
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
export function FilterSheet({ filters }: { filters: PaperworksFilterModel }) {
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
          <FilterFields filters={filters} layout="stack" />
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
