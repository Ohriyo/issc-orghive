import { useId, useRef, useState, type DragEvent } from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PillButton } from './pill-button';

export interface FileDropzoneProps {
  onFiles: (files: File[]) => void;
  /** For the file picker, e.g. ".pdf,.docx". */
  accept: string;
  multiple?: boolean;
  /** Button text, e.g. "Choose files". */
  buttonLabel: string;
  /** What is allowed, shown under the button, e.g. "PDF, DOCX… up to 25 MB". */
  hint: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Pick files with the button (keyboard and touch), or drop them on the zone (mouse).
 * The button is the primary path: phones cannot drag files.
 */
export function FileDropzone({
  onFiles,
  accept,
  multiple = false,
  buttonLabel,
  hint,
  disabled = false,
  className,
}: FileDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [dragging, setDragging] = useState(false);

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) take(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-input bg-white/70 px-5 py-8 text-center transition-colors duration-300 sm:py-10',
        dragging && 'border-forest-500 bg-accent',
        disabled && 'opacity-60',
        className,
      )}
    >
      <UploadCloud aria-hidden="true" className="size-10 text-forest-500" strokeWidth={1.5} />
      <PillButton
        type="button"
        size="md"
        disabled={disabled}
        aria-describedby={hintId}
        onClick={() => input.current?.click()}
      >
        {buttonLabel}
      </PillButton>
      <p id={hintId} className="max-w-prose text-small text-ink-muted">
        <span className="hidden md:inline">Or drag them here. </span>
        {hint}
      </p>
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          take(event.target.files);
          event.target.value = ''; // the same file can be picked again after removing it
        }}
      />
    </div>
  );
}
