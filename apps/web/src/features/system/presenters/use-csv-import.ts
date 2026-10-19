import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ACCOUNT_CSV_MAX_BYTES,
  bulkAccountsResultSchema,
  endOfTermResultSchema,
  toCsv,
  type AccountCsvRowResult,
  type BulkAccountsResult,
  type EndOfTermResult,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, messageOf } from './system-format';
import type { Confirming } from './use-system-users';
import { useStepUp } from './use-step-up';

export type ImportKind = 'bulk' | 'end-of-term';

const ACTION_LABEL: Record<AccountCsvRowResult['action'], string> = {
  create: 'Will be created',
  assign: 'Will be reassigned',
  skip: 'Skipped',
  error: 'Cannot be used',
};

export interface ImportRow {
  line: number;
  organization: string;
  officer: string;
  accountEmail: string;
  action: AccountCsvRowResult['action'];
  actionLabel: string;
  messages: string[];
}

function toRow(r: AccountCsvRowResult): ImportRow {
  return {
    line: r.line,
    organization: r.organization || '—',
    officer: r.officerName || '—',
    accountEmail: r.accountEmail ?? '—',
    action: r.action,
    actionLabel: ACTION_LABEL[r.action],
    messages: r.messages,
  };
}

/** The bulk creation's report, built in the browser: never a password. */
export function reportCsv(rows: AccountCsvRowResult[], done: boolean): string {
  const outcome = (r: AccountCsvRowResult) =>
    done && r.action === 'create'
      ? 'Created'
      : done && r.action === 'assign'
        ? 'Reassigned'
        : ACTION_LABEL[r.action];
  return toCsv([
    ['Line', 'Organization', 'Account email', 'Officer in charge', 'Outcome', 'Why'],
    ...rows.map((r) => [
      r.line,
      r.organization,
      r.accountEmail ?? '',
      r.officerName,
      outcome(r),
      r.messages.join('; '),
    ]),
  ]);
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

type Result = BulkAccountsResult | EndOfTermResult;

/**
 * /system/accounts/bulk and /system/end-of-term: choose a CSV, preview it (nothing is saved),
 * then run it. The end of term is confirmed and needs a step-up code; its ISSC password is
 * shown once. The passwords of everyone else go to the ISSC account's one-time Reveal.
 */
export function useCsvImport(kind: ImportKind) {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [termEnd, setTermEnd] = useState('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [isscPassword, setIsscPassword] = useState<string | null>(null);

  const base = kind === 'bulk' ? '/system/accounts/bulk' : '/system/end-of-term';
  // The two imports answer with different shapes; each is checked with its own schema.
  const parse = (data: unknown): Result =>
    kind === 'bulk' ? bulkAccountsResultSchema.parse(data) : endOfTermResultSchema.parse(data);
  const body = (csv: string) => (kind === 'bulk' ? { csv } : { csv, termEnd: termEnd || null });

  const check = useMutation({
    mutationFn: async (csv: string) => parse(await api.post(`${base}/preview`, body(csv))),
    onSuccess: (data) => setPreview(data),
  });

  const run = useMutation({
    mutationFn: (csv: string) =>
      kind === 'bulk'
        ? api.post(base, body(csv)).then(parse)
        : stepUp.guard(async () => parse(await api.post(base, body(csv)))),
    onSuccess: (data) => {
      if (!data) return;
      setResult(data);
      setPreview(null);
      if ('isscTemporaryPassword' in data && data.isscTemporaryPassword) {
        setIsscPassword(data.isscTemporaryPassword);
      }
      toast.success(kind === 'bulk' ? 'Accounts created' : 'The end of term is done');
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.system.all }),
  });

  const shown = result ?? preview;
  const runnable =
    preview !== null &&
    preview.problems.length === 0 &&
    (kind === 'bulk'
      ? (preview as BulkAccountsResult).counts.create > 0
      : (preview as EndOfTermResult).counts.error === 0);

  return {
    kind,
    file: file?.name ?? null,
    fileError,
    chooseFile: async (picked: File | null) => {
      setResult(null);
      setPreview(null);
      check.reset();
      if (!picked) return setFile(null);
      if (picked.size > ACCOUNT_CSV_MAX_BYTES) {
        setFile(null);
        return setFileError('The file is over 200 KB. Split it into smaller files.');
      }
      setFileError(null);
      const csv = await picked.text();
      setFile({ name: picked.name, csv });
      check.mutate(csv);
    },
    termEnd,
    setTermEnd,
    checking: check.isPending,
    checkError: check.error ? messageOf(check.error) : null,
    stage: result ? ('done' as const) : preview ? ('previewed' as const) : ('empty' as const),
    problems: shown?.problems ?? [],
    rows: (shown?.rows ?? []).map(toRow),
    counts: shown?.counts ?? null,
    toLock: shown && 'toLock' in shown ? shown.toLock : [],
    revealUntil: result?.revealExpiresAt ? formatDate(result.revealExpiresAt) : null,
    runnable,
    running: run.isPending,
    run: () => {
      if (!file || !runnable) return;
      if (kind === 'bulk') return run.mutate(file.csv);
      const p = preview as EndOfTermResult;
      setConfirming({
        kind: 'deactivate',
        title: 'Run the end of term?',
        body: `Every organization account's term ends now and every account is signed out. ${p.counts.assign} get a new officer in charge and a new temporary password; ${p.counts.lock} not in the file are locked until assigned.`,
        confirmLabel: 'Run the end of term',
        run: () => {
          setConfirming(null);
          run.mutate(file.csv);
        },
      });
    },
    downloadReport: () => {
      if (result) download('orghive-account-import-report.csv', reportCsv(result.rows, true));
    },
    isscPassword,
    closeIsscPassword: () => setIsscPassword(null),
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
  };
}

export type CsvImportModel = ReturnType<typeof useCsvImport>;
