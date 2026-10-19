import { useId, useState, type ComponentProps } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TextFieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  label: string;
  /** Validation message; marks the input invalid and is announced with it. */
  error?: string;
  /** Guidance shown under the input, e.g. a password rule. */
  hint?: string;
}

const INPUT =
  'h-12 w-full rounded-full border border-input bg-white px-5 text-body text-ink shadow-[inset_0_1px_2px_rgb(0_0_0/0.06)] transition-colors duration-300 placeholder:text-ink-muted hover:border-forest-500 aria-invalid:border-destructive';

/** A labelled input in the design system's pill shape, with its hint and error wired for screen readers. */
export function TextField({ label, error, hint, className, type, ...input }: TextFieldProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-body font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isPassword && revealed ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className={cn(INPUT, isPassword && 'pr-14')}
          {...input}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            aria-pressed={revealed}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            className="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-300 hover:text-ink focus-visible:text-ink"
          >
            {revealed ? (
              <EyeOff aria-hidden="true" className="size-5" />
            ) : (
              <Eye aria-hidden="true" className="size-5" />
            )}
          </button>
        ) : null}
      </div>
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
