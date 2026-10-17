import type { DocumentVisibility } from '@orghive/shared';
import { SelectField } from './form-fields';
import { VISIBILITY_OPTIONS } from './visibility';

export interface VisibilitySelectProps {
  value: DocumentVisibility;
  onChange: (visibility: DocumentVisibility) => void;
  /** While a change is being saved. */
  disabled?: boolean;
  /** Names the document for screen readers when several selects share a page. */
  documentTitle?: string;
  error?: string;
  className?: string;
}

/** Who can see a document, changed in one step. Renders and emits only. */
export function VisibilitySelect({
  value,
  onChange,
  disabled,
  documentTitle,
  error,
  className,
}: VisibilitySelectProps) {
  const hint = VISIBILITY_OPTIONS.find((o) => o.value === value)?.hint;
  return (
    <SelectField
      label="Who can see it"
      aria-label={documentTitle ? `Who can see it: ${documentTitle}` : undefined}
      options={VISIBILITY_OPTIONS.map(({ value: v, label }) => ({ value: v, label }))}
      value={value}
      disabled={disabled}
      hint={hint}
      error={error}
      className={className}
      onChange={(event) => onChange(event.target.value as DocumentVisibility)}
    />
  );
}
