/**
 * CSV writing for the proof bundle (P6.3.3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P6-25 / EC-P5-15 — FORMULA INJECTION IS THE POINT OF THIS FILE.
 *
 * A cell beginning `=`, `+`, `-`, `@`, tab or CR is executed as a formula when
 * the file is opened in Excel, Sheets, or LibreOffice. `=cmd()` and
 * `=HYPERLINK(...)` are the classic payloads, and the second one exfiltrates
 * quietly.
 *
 * Phase 5 deliberately stored such cells RAW on import, on the grounds that the
 * danger is downstream. This is downstream. The proof bundle is explicitly the
 * artifact a user shares to demonstrate their job search — it exists to be
 * opened in a spreadsheet by someone else, which is exactly the situation the
 * attack needs.
 *
 * The escape is a leading apostrophe, which spreadsheets strip on display, so
 * the visible value is unchanged for an honest cell.
 * ─────────────────────────────────────────────────────────────────────────
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** Neutralize a formula-triggering cell without altering what a reader sees. */
export function escapeCell(value: unknown): string {
  const text =
    value === null || value === undefined ? "" : String(value);

  // Escape BEFORE quoting: a leading apostrophe inside the quoted field is
  // what the spreadsheet acts on, so the order matters.
  const guarded = DANGEROUS_PREFIX.test(text) ? `'${text}` : text;

  // RFC 4180 quoting. Always quoted rather than conditionally, so a value that
  // later gains a comma cannot silently break the column alignment of a file
  // someone is reading as evidence.
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [
    headers.map(escapeCell).join(","),
    ...rows.map((row) => row.map(escapeCell).join(",")),
  ];
  // CRLF: RFC 4180, and the only line ending Excel reliably respects.
  return `${lines.join("\r\n")}\r\n`;
}
