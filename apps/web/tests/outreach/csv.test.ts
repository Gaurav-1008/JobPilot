/**
 * CSV import parsing (P5.1.3).
 *
 * The BOM and quoted-field cases are the two that produce silently wrong rows
 * rather than errors — the worst failure mode for an import that ends in email.
 */

import { describe, expect, it } from "vitest";

import { CsvError, MAX_IMPORT_ROWS, parseCsv } from "@/lib/outreach/csv";

describe("parseCsv", () => {
  it("strips a UTF-8 BOM before parsing headers (EC-P5-09)", () => {
    const file = "﻿recipient_email,recipient_name\npriya@example.com,Priya\n";
    const { rows } = parseCsv(file, ["recipient_email"]);
    expect(rows[0].recipient_email).toBe("priya@example.com");
  });

  it("sniffs semicolon and tab delimiters (EC-P5-10)", () => {
    const semi = parseCsv("recipient_email;recipient_name\na@x.com;Ann\n");
    expect(semi.rows[0]).toEqual({ recipient_email: "a@x.com", recipient_name: "Ann" });

    const tab = parseCsv("recipient_email\trecipient_name\na@x.com\tAnn\n");
    expect(tab.rows[0]).toEqual({ recipient_email: "a@x.com", recipient_name: "Ann" });
  });

  it("handles CRLF line endings (EC-P5-10)", () => {
    const { rows } = parseCsv("recipient_email\r\na@x.com\r\nb@x.com\r\n");
    expect(rows.map((r) => r.recipient_email)).toEqual(["a@x.com", "b@x.com"]);
  });

  it("keeps commas and newlines inside quoted fields (EC-P5-11)", () => {
    const file =
      'recipient_email,personalization_note\n' +
      'a@x.com,"Met at PyCon, Bengaluru"\n' +
      'b@x.com,"line one\nline two"\n';
    const { rows } = parseCsv(file, ["recipient_email"]);
    expect(rows[0].personalization_note).toBe("Met at PyCon, Bengaluru");
    expect(rows[1].personalization_note).toBe("line one\nline two");
  });

  it("unescapes doubled quotes (EC-P5-11)", () => {
    const { rows } = parseCsv('recipient_email,note\na@x.com,"She said ""hi"""\n');
    expect(rows[0].note).toBe('She said "hi"');
  });

  it("matches headers case-insensitively and normalizes separators (EC-P5-12)", () => {
    const { rows } = parseCsv("Recipient_Email,Recipient Name\na@x.com,Ann\n", [
      "recipient_email",
    ]);
    expect(rows[0].recipient_email).toBe("a@x.com");
    expect(rows[0].recipient_name).toBe("Ann");
  });

  it("names the missing column rather than saying 'bad CSV' (EC-P5-12)", () => {
    expect(() => parseCsv("name,company\nAnn,Acme\n", ["recipient_email"])).toThrow(
      /Missing required column "recipient_email"/,
    );
    expect(() => parseCsv("name\n", ["recipient_email"])).toThrow(CsvError);
  });

  it("caps the import and reports truncation (EC-P5-13)", () => {
    const body = Array.from(
      { length: MAX_IMPORT_ROWS + 25 },
      (_, i) => `user${i}@example.com`,
    ).join("\n");
    const { rows, truncated } = parseCsv(`recipient_email\n${body}\n`);
    expect(rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(truncated).toBe(true);
  });

  it("does not report truncation at exactly the cap", () => {
    const body = Array.from(
      { length: MAX_IMPORT_ROWS },
      (_, i) => `user${i}@example.com`,
    ).join("\n");
    const { rows, truncated } = parseCsv(`recipient_email\n${body}\n`);
    expect(rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(truncated).toBe(false);
  });

  it("stores formula-injection cells raw (EC-P5-15)", () => {
    // The risk lives in the EXPORT the user opens in Excel (P6.3.3), not here.
    // Escaping on ingest would corrupt the stored value and still leave the
    // export unsafe.
    const { rows } = parseCsv('recipient_email,note\na@x.com,"=cmd()"\n');
    expect(rows[0].note).toBe("=cmd()");
  });

  it("rejects an empty file", () => {
    expect(() => parseCsv("   ")).toThrow(CsvError);
  });

  it("ignores a trailing newline rather than emitting a blank row", () => {
    const { rows } = parseCsv("recipient_email\na@x.com\n\n");
    expect(rows).toHaveLength(1);
  });
});
