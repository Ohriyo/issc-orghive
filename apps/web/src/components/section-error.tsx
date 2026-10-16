import { RotateCw } from 'lucide-react';
import { PillButton } from '@/components/pill-button';
import { cn } from '@/lib/utils';

export interface SectionErrorProps {
  message: string;
  onRetry: () => void;
  className?: string;
}

/** A section that failed to load: what went wrong and a way to try again. */
export function SectionError({ message, onRetry, className }: SectionErrorProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-4', className)}>
      <p className="text-body text-ink">{message}</p>
      <PillButton variant="light" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Try again
      </PillButton>
    </div>
  );
}
