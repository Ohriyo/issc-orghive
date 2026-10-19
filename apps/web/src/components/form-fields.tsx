import { useId, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const FIELD =
  'w-full border border-input bg-white text-body text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-300 hover:border-forest-500 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-60';

interface FieldShellProps {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

/** Label, control, hint and error, wired together for screen readers. */
function FieldShell({ label, error, hint, className, children }: FieldShellProps) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-body font-medium text-ink">
        {label}
      </label>
      {children({ id, describedBy: describedBy || undefined })}
      {hint ? (
        <p id={`${id}-hint`} className="text-small text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-small font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps extends Omit<ComponentProps<'select'>, 'id'> {
  label: string;
  options: { value: string; label: string }[];
  /** First, empty option, e.g. "Choose a type". */
  placeholder?: string;
  error?: string;
  hint?: string;
}

/** A labelled select in the pill shape. */
export function SelectField({
  label,
  options,
  placeholder,
  error,
  hint,
  className,
  ...select
}: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy }) => (
        <div className="relative">
          <select
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={cn(FIELD, 'h-12 cursor-pointer appearance-none rounded-full pr-11 pl-5')}
            {...select}
          >
            {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
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
      )}
    </FieldShell>
  );
}

export interface TextAreaFieldProps extends Omit<ComponentProps<'textarea'>, 'id'> {
  label: string;
  error?: string;
  hint?: string;
}

/** A labelled multi-line field. */
export function TextAreaField({ label, error, hint, className, ...textarea }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint} className={className}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(FIELD, 'min-h-24 rounded-2xl px-5 py-3')}
          {...textarea}
        />
      )}
    </FieldShell>
  );
}
