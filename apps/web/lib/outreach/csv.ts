/**
 * Minimal RFC 4180 CSV reader for contact import (P5.1.3).
 *
 * Hand-written rather than a dependency: this is the only CSV surface in the
 * platform, and the edge cases that actually bite (EC-P5-09 through EC-P5-14)
 * are ones a general-purpose parser still leaves to the caller — BOM stripping,
 * dialect sniffing, and case-insensitive header matching.
 *
 * EC-P5-11 is the reason this is a state machine and not `split(",")`: a quoted
 * field may legally contain commas, newlines, and doubled quotes. Splitting on
 * delimiters produces silently wrong rows rather than an error, which is the
 * worst possible failure for an import that ends in sending email.
 *
 * EC-P5-15 — cells beginning `=`, `+`, `-`, or `@` are stored RAW. Formula
 * injection is an EXPORT concern (P6.3.3): the danger is the audit log the user
 * later opens in Excel, not the database. Escaping on the way in would corrupt
 * legitimate values and still leave the export unsafe.
 */

/** EC-P5-13: importing is not sending, but an unbounded import is a memory problem. */
export const MAX_IMPORT_ROWS = 500;

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/**
 * Pick the delimiter by counting candidates outside quoted regions in the
 * header line. Counting inside quotes would let a single `Doe, Jane` cell
 * outvote the real delimiter.
 */
function sniffDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = 0;

  for (const candidate of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < headerLine.length; i += 1) {
      const ch = headerLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return best;
}

/** The first physical line, respecting quotes so a quoted newline stays inside its field. */
function firstLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if ((ch === "\n" || ch === "\r") && !inQuotes) return text.slice(0, i);
  }
  return text;
}

/** Full RFC 4180 tokenizer: quoted fields, `""` escapes, CRLF or LF row breaks. */
function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // A trailing newline yields one empty field; that is not a row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF or a lone CR both terminate the row.
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

export interface ParsedCsv {
  /** Header-keyed rows. Keys are lowercased and underscored for stable lookup. */
  rows: Record<string, string>[];
  /** True when the file had more data rows than MAX_IMPORT_ROWS. */
  truncated: boolean;
}

/** `Recipient Email` / `recipient-email` / `RECIPIENT_EMAIL` all key as `recipient_email`. */
function canonicalHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Parse a CSV into header-keyed rows.
 *
 * @param required column names (canonical form) that must be present; a missing
 *        one throws a CsvError naming it, per EC-P5-12.
 */
export function parseCsv(input: string, required: string[] = []): ParsedCsv {
  // EC-P5-09: the BOM must go before header parsing, or the first column name
  // becomes "﻿recipient_email" and every lookup against it misses.
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) throw new CsvError("The file is empty.");

  const delimiter = sniffDelimiter(firstLine(text));
  const raw = parseRows(text, delimiter);
  if (raw.length === 0) throw new CsvError("The file is empty.");

  const headers = raw[0].map(canonicalHeader);
  for (const column of required) {
    if (!headers.includes(column)) {
      throw new CsvError(
        `Missing required column "${column}". Found: ${headers.join(", ") || "none"}.`,
      );
    }
  }

  const body = raw.slice(1);
  const truncated = body.length > MAX_IMPORT_ROWS;

  const rows = body.slice(0, MAX_IMPORT_ROWS).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { rows, truncated };
}
