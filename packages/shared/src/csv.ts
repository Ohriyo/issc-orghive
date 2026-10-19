/**
 * Builds RFC 4180 CSV for exports. Cells that start with =, +, - or @ (or a tab or carriage
 * return) are prefixed with an apostrophe, so a spreadsheet shows them as text instead of
 * running them as formulas (CSV injection).
 */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
