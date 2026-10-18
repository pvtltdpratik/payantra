/**
 * CSV for spreadsheets (RFC 4180), safe to open in Excel/Sheets.
 *
 * Two traps are handled here so no report can forget them:
 *  - quoting: any cell with a comma, quote or line break is wrapped in quotes with inner quotes doubled;
 *  - formula injection: a TEXT cell that starts with = + - @ (or a tab/CR) would be executed as a formula by a
 *    spreadsheet — and customers control names, addresses and order notes. Such cells get a leading apostrophe.
 *    Numbers are written as numbers (so "-120" for a refund stays a number, never a formula risk).
 */
export type CsvCell = string | number | boolean | Date | null | undefined;

const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  let text = value instanceof Date ? value.toISOString() : value;
  if (DANGEROUS_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // The BOM makes Excel read the file as UTF-8 (names, ₹ and Indic scripts survive); CRLF is the CSV standard.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
