/**
 * Extraction sanity checks (P1.2.1). Each test is a document that reaches the
 * database or the LLM if the check is missing.
 */

import { describe, it, expect } from "vitest";

import {
  sanitiseResumeText, stripControlChars, sniffContentType,
  UnreadableDocumentError, MAX_RESUME_CHARS,
} from "@/lib/resume-text";

const REAL = "Backend engineer. ".repeat(30);   // comfortably over the floor

describe("stripControlChars (EC-P1-09)", () => {
  it("removes NUL, which Postgres text rejects outright", () => {
    const dirty = `Jane${String.fromCharCode(0)}Doe`;
    expect(stripControlChars(dirty)).toBe("JaneDoe");
  });

  it("keeps tabs and newlines — they carry resume structure", () => {
    const s = "a\tb\nc\r\nd";
    expect(stripControlChars(s)).toBe(s);
  });

  it("removes other C0 controls and DEL", () => {
    const dirty = `a${String.fromCharCode(1)}b${String.fromCharCode(31)}c${String.fromCharCode(127)}`;
    expect(stripControlChars(dirty)).toBe("abc");
  });
});

describe("sanitiseResumeText", () => {
  it("EC-P1-13: an empty document is rejected, not stored", () => {
    expect(() => sanitiseResumeText("   \n\t  ")).toThrow(UnreadableDocumentError);
  });

  it("EC-P1-08: a scanned image (near-zero text) is rejected with a paste hint", () => {
    try {
      sanitiseResumeText("Page 1");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnreadableDocumentError);
      expect((e as Error).message).toMatch(/scanned image|paste/i);
    }
  });

  it("EC-P1-14: truncates a runaway document AND says so", () => {
    const huge = "x".repeat(MAX_RESUME_CHARS + 5_000);
    const out = sanitiseResumeText(huge);
    expect(out.text).toHaveLength(MAX_RESUME_CHARS);
    // Silent truncation produces a wrong parse the user cannot explain.
    expect(out.warnings.join(" ")).toMatch(/truncated/i);
  });

  it("warns when control characters were present", () => {
    const out = sanitiseResumeText(REAL + String.fromCharCode(0));
    expect(out.warnings.join(" ")).toMatch(/control characters/i);
  });

  it("passes a normal resume through unchanged", () => {
    expect(sanitiseResumeText(REAL).warnings).toHaveLength(0);
  });
});

describe("sniffContentType (EC-P1-11)", () => {
  it("detects PDF by magic bytes, not by extension", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.7\n..."))).toBe("pdf");
  });

  it("detects a zip container (docx)", () => {
    expect(sniffContentType(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe("docx");
  });

  it("a .pdf filename with text bytes is TEXT — the name is not evidence", () => {
    expect(sniffContentType(Buffer.from("Jane Doe, engineer"))).toBe("text");
  });

  it("rejects binary that is neither", () => {
    expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("unknown");
  });
});
