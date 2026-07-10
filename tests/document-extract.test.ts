import { describe, it, expect } from "vitest";

import { extractResumeText, MAX_UPLOAD_BYTES } from "@/lib/document-extract";
import { BadRequestError } from "@/lib/api-errors";

function file(text: string, name: string, type: string) {
  return { buffer: Buffer.from(text), name, type };
}

describe("extractResumeText", () => {
  it("returns text for a .txt upload", async () => {
    const result = await extractResumeText(
      file("Jane Doe\nEngineer", "resume.txt", "text/plain"),
    );
    expect(result.text).toContain("Jane Doe");
    expect(result.warnings).toEqual([]);
  });

  it("treats an unknown MIME with .txt extension as text", async () => {
    const result = await extractResumeText(
      file("hello world", "resume.txt", "application/octet-stream"),
    );
    expect(result.text).toBe("hello world");
  });

  it("rejects an empty file", async () => {
    await expect(
      extractResumeText(file("", "resume.txt", "text/plain")),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("rejects a file over the size limit", async () => {
    const big = {
      buffer: Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61),
      name: "resume.txt",
      type: "text/plain",
    };
    await expect(extractResumeText(big)).rejects.toThrow(/larger than/);
  });

  it("rejects an unsupported type", async () => {
    await expect(
      extractResumeText(file("PNGDATA", "photo.png", "image/png")),
    ).rejects.toThrow(/Unsupported file type/);
  });

  it("gives a helpful message for legacy .doc", async () => {
    await expect(
      extractResumeText(file("x", "resume.doc", "application/msword")),
    ).rejects.toThrow(/\.docx/);
  });
});
