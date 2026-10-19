import type { ComponentProps } from 'react';
import { ACTING_AS_MAX_LENGTH } from '@orghive/shared';
import { TextField } from './text-field';

export interface ActingAsFieldProps extends Omit<ComponentProps<'input'>, 'id'> {
  /** The organization whose shared account is signed in, e.g. "JPICE". */
  orgAcronym: string;
  error?: string;
}

/**
 * "Acting as": the officer using the organization's shared account. Saved with the file or
 * action, shown only to the organization itself, and remembered on this device.
 */
export function ActingAsField({ orgAcronym, error, ...input }: ActingAsFieldProps) {
  return (
    <TextField
      label="Acting as"
      hint={`Your name, as the ${orgAcronym} officer using this account. Saved with the file and shown only to ${orgAcronym}. Remembered on this device.`}
      error={error}
      autoComplete="name"
      maxLength={ACTING_AS_MAX_LENGTH}
      placeholder="e.g. Juan Dela Cruz"
      {...input}
    />
  );
}
