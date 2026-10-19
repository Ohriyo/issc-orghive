import { z } from 'zod';
import { REVEAL_TTL_DAYS } from './reveal';
import { accountEmailSchema, officerInChargeInputSchema } from './system-accounts';

/*
 * CSV imports for the /system console (docs/DOMAIN_RULES.md, "Accounts"): bulk account
 * creation and the end of term. The file is parsed and checked row by row; nothing is saved
 * until the super admin confirms the preview.
 */

export const ACCOUNT_CSV_MAX_ROWS = 500;
/** Characters, which is close to bytes for these files. */
export const ACCOUNT_CSV_MAX_BYTES = 200 * 1024;

/**
 * Parses CSV text (RFC 4180: commas, quoted fields with "" escapes, CRLF or LF). Returns the
 * rows as arrays of trimmed cells; blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  // A spreadsheet's byte-order mark is not part of the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/** The columns each import reads, and the header names it accepts for them (any case). */
const COLUMN_NAMES = {
  organization: ['organization', 'org', 'acronym', 'organization acronym'],
  college: ['college', 'college code'],
  officerName: ['officer name', 'officer-in-charge name', 'officer in charge', 'name'],
  officerPosition: ['position', 'officer position'],
  officerEmail: ['contact email', 'officer email', 'officer contact email', 'email'],
  accountEmail: ['account email', 'login email', 'sign-in email'],
} as const;
export type AccountCsvColumn = keyof typeof COLUMN_NAMES;

/** A data row, by column, with its line number in the file (the header is line 1). */
export interface AccountCsvRow {
  line: number;
  organization: string;
  college: string;
  officerName: string;
  officerPosition: string;
  officerEmail: string;
  accountEmail: string;
}

export type CsvTable = { ok: true; rows: AccountCsvRow[] } | { ok: false; error: string };

/**
 * Reads the header row and maps every data row to its columns. `required` columns must have
 * a header; the others may be left out.
 */
export function readAccountCsv(text: string, required: AccountCsvColumn[]): CsvTable {
  if (text.length > ACCOUNT_CSV_MAX_BYTES) {
    return { ok: false, error: `The file is over ${ACCOUNT_CSV_MAX_BYTES / 1024} KB.` };
  }
  const [header, ...data] = parseCsv(text);
  if (!header) return { ok: false, error: 'The file is empty.' };
  const index = {} as Record<AccountCsvColumn, number>;
  for (const [column, names] of Object.entries(COLUMN_NAMES) as [
    AccountCsvColumn,
    readonly string[],
  ][]) {
    index[column] = header.findIndex((h) => names.includes(h.toLowerCase()));
  }
  const missing = required.filter((column) => index[column] === -1);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing
        .map((m) => COLUMN_NAMES[m][0])
        .join(', ')}. The first row must name the columns.`,
    };
  }
  if (data.length === 0) return { ok: false, error: 'The file has a header but no rows.' };
  if (data.length > ACCOUNT_CSV_MAX_ROWS) {
    return { ok: false, error: `Up to ${ACCOUNT_CSV_MAX_ROWS} rows per file.` };
  }
  const cell = (row: string[], column: AccountCsvColumn) =>
    index[column] === -1 ? '' : (row[index[column]] ?? '');
  return {
    ok: true,
    rows: data.map((row, i) => ({
      line: i + 2,
      organization: cell(row, 'organization'),
      college: cell(row, 'college'),
      officerName: cell(row, 'officerName'),
      officerPosition: cell(row, 'officerPosition'),
      officerEmail: cell(row, 'officerEmail'),
      accountEmail: cell(row, 'accountEmail'),
    })),
  };
}

/** The officer in charge on a row, checked with the same rule as the console form. */
export function officerOfRow(row: AccountCsvRow) {
  return officerInChargeInputSchema.safeParse({
    name: row.officerName,
    position: row.officerPosition,
    email: row.officerEmail,
  });
}

export function accountEmailOfRow(email: string) {
  return accountEmailSchema.safeParse(email);
}

/** A CSV upload: the file's text. */
export const accountCsvRequestSchema = z.strictObject({
  csv: z
    .string()
    .min(1, 'Choose a CSV file')
    .max(ACCOUNT_CSV_MAX_BYTES + 1024),
});
export type AccountCsvRequest = z.infer<typeof accountCsvRequestSchema>;

/** One previewed row. `create`/`assign`: will be applied; `skip`: left alone; `error`: why not. */
export const accountCsvRowResultSchema = z.object({
  line: z.number().int(),
  organization: z.string(),
  action: z.enum(['create', 'assign', 'skip', 'error']),
  messages: z.array(z.string()),
  accountEmail: z.string().nullable(),
  officerName: z.string(),
});
export type AccountCsvRowResult = z.infer<typeof accountCsvRowResultSchema>;

/** POST /system/accounts/bulk/preview and the result of POST /system/accounts/bulk. */
export const bulkAccountsResultSchema = z
  .object({
    /** Null while previewing; set once the accounts exist. */
    runId: z.uuid().nullable(),
    /** Problems with the file as a whole (e.g. no ISSC account to receive the passwords). */
    problems: z.array(z.string()),
    rows: z.array(accountCsvRowResultSchema),
    counts: z.object({
      create: z.number().int(),
      skip: z.number().int(),
      error: z.number().int(),
    }),
    /** After creation: until when the ISSC account can reveal the handover list. */
    revealExpiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'BulkAccountsResult' });
export type BulkAccountsResult = z.infer<typeof bulkAccountsResultSchema>;

/** POST /system/end-of-term (and its preview): when the incoming term ends, if known. */
export const endOfTermRequestSchema = accountCsvRequestSchema.extend({
  termEnd: z.iso.date().nullable().optional(),
});
export type EndOfTermRequest = z.infer<typeof endOfTermRequestSchema>;

export const endOfTermResultSchema = z
  .object({
    runId: z.uuid().nullable(),
    /** Problems with the file as a whole; the run needs none, and no row errors. */
    problems: z.array(z.string()),
    rows: z.array(accountCsvRowResultSchema),
    /** Accounts not in the file: locked until assigned. */
    toLock: z.array(z.object({ organization: z.string(), email: z.string() })),
    counts: z.object({ assign: z.number().int(), lock: z.number().int(), error: z.number().int() }),
    /** After the run: the ISSC account's own new password, shown once. */
    isscTemporaryPassword: z.string().nullable(),
    revealExpiresAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'EndOfTermResult' });
export type EndOfTermResult = z.infer<typeof endOfTermResultSchema>;

/** How long a handover list waits, for the screens' wording. */
export const HANDOVER_TTL_DAYS = REVEAL_TTL_DAYS;
