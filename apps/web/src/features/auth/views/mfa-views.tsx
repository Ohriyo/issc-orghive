import { Check, Copy, Download } from 'lucide-react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { PillButton } from '@/components/pill-button';
import { TextField } from '@/components/text-field';
import type { MfaStepModel } from '../presenters/use-auth-forms';
import { AuthLayout, FormAlert, TEXT_LINK } from './auth-layout';

/* Views only: they render presenter output and emit events. No fetching, no rules. */

const LINK_BUTTON = `${TEXT_LINK} cursor-pointer text-left`;

/** The second sign-in step for super admins: a TOTP code, or a recovery code instead. */
export function MfaCodeView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  usingRecoveryCode,
  toggleRecoveryCode,
  backToPassword,
}: Omit<MfaStepModel, 'onSubmit'> & { onSubmit: () => void }) {
  return (
    <AuthLayout
      title="Two-step sign-in"
      heading="Enter your code"
      intro={
        <p>
          {usingRecoveryCode
            ? 'Enter one of the recovery codes you saved when you set up your authenticator. Each code works once.'
            : 'Open your authenticator app and enter the 6-digit code for Orghive.'}
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          key={usingRecoveryCode ? 'recovery' : 'totp'}
          label={usingRecoveryCode ? 'Recovery code' : 'Authentication code'}
          autoComplete="one-time-code"
          inputMode={usingRecoveryCode ? 'text' : 'numeric'}
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder={usingRecoveryCode ? 'abcde-fghij' : '123456'}
          error={errors.code?.message}
          {...register('code')}
        />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <PillButton type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? 'Checking…' : 'Sign in'}
          </PillButton>
          <button type="button" onClick={toggleRecoveryCode} className={LINK_BUTTON}>
            {usingRecoveryCode ? 'Use my authenticator app' : 'Use a recovery code'}
          </button>
        </div>
        <button type="button" onClick={backToPassword} className={`${LINK_BUTTON} self-start`}>
          Back to email and password
        </button>
      </form>
    </AuthLayout>
  );
}

/** The 10 one-time codes, with ways to keep them. Shown once. */
export function RecoveryCodesPanel({
  codes,
  copied,
  onCopy,
  onDownload,
}: {
  codes: string[];
  copied: boolean;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-2xl bg-white p-5 font-mono text-body text-ink ring-1 ring-border min-[400px]:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code} className="tabular-nums">
            {code}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-3">
        <PillButton type="button" variant="light" onClick={onCopy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy codes'}
        </PillButton>
        <PillButton type="button" variant="light" onClick={onDownload}>
          <Download aria-hidden="true" />
          Download as text
        </PillButton>
      </div>
    </div>
  );
}

export interface MfaSetupViewProps {
  register: UseFormRegister<{ code: string }>;
  errors: FieldErrors<{ code: string }>;
  onSubmit: () => void;
  isSubmitting: boolean;
  formError?: string;
  recoveryCodes: string[] | null;
  copied: boolean;
  copyCodes: () => void;
  downloadCodes: () => void;
  finish: () => void;
}

/**
 * /mfa-setup: confirm the authenticator the create-super-admin command printed, then keep
 * the recovery codes. Nothing else opens until this is done.
 */
export function MfaSetupView({
  register,
  errors,
  onSubmit,
  isSubmitting,
  formError,
  recoveryCodes,
  copied,
  copyCodes,
  downloadCodes,
  finish,
}: MfaSetupViewProps) {
  if (recoveryCodes) {
    return (
      <AuthLayout
        title="Save your recovery codes"
        heading="Save your recovery codes"
        intro={
          <p>
            If you lose your phone, each of these codes signs you in once instead of an
            authenticator code. Keep them somewhere safe. They will not be shown again.
          </p>
        }
      >
        <div role="status" className="flex flex-col gap-8">
          <RecoveryCodesPanel
            codes={recoveryCodes}
            copied={copied}
            onCopy={copyCodes}
            onDownload={downloadCodes}
          />
          <PillButton type="button" size="lg" onClick={finish} className="self-start">
            I saved them. Open the console
          </PillButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set up two-step sign-in"
      heading="Set up two-step sign-in"
      intro={
        <p>
          Super admin accounts need an authenticator app. Scan the QR code the create-super-admin
          command printed, then enter the 6-digit code it shows.
        </p>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <FormAlert message={formError} />
        <TextField
          label="Authentication code"
          autoComplete="one-time-code"
          inputMode="numeric"
          autoFocus
          placeholder="123456"
          hint="Lost the QR code? Ask for a new one with create-super-admin --reset-mfa."
          error={errors.code?.message}
          {...register('code')}
        />
        <PillButton type="submit" size="lg" disabled={isSubmitting} className="self-start">
          {isSubmitting ? 'Checking…' : 'Confirm'}
        </PillButton>
      </form>
    </AuthLayout>
  );
}
