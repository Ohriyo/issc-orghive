import { Switch } from 'radix-ui';
import { cn } from '@/lib/utils';

export interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The id of the text that names it (the row's label). */
  labelledBy: string;
  describedBy?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * An on/off switch (Radix: role="switch", Space toggles). The thumb moves and the track
 * fills, so its state never relies on color alone; tap-area gives it a 44px hit target.
 */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  labelledBy,
  describedBy,
  disabled,
  className,
}: ToggleSwitchProps) {
  return (
    <Switch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      className={cn(
        'tap-area relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-300 motion-reduce:transition-none',
        'bg-surface-deep data-[state=checked]:bg-forest-700',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <Switch.Thumb className="pointer-events-none block size-6 rounded-full bg-white shadow-pool transition-transform duration-300 data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0 motion-reduce:transition-none" />
    </Switch.Root>
  );
}
