import { NextResponse } from "next/server";

import { extractResumeText, MAX_UPLOAD_BYTES } from "@/lib/document-extract";
import { sanitiseResumeText, sniffContentType, UnreadableDocumentError } from "@/lib/resume-text";
import { parseResume } from "@/services/resume-parser";
import { createResume, listResumes } from "@/lib/db/stores/resume";
import { requireSession } from "@/lib/auth/session";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/resumes — the user's versions, newest first. */
export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json({ resumes: await listResumes(userId) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/resumes — upload or paste, parse, persist as the next version.
 *
 * Accepts multipart (field `file`) or JSON ({ text }). Paste is not a fallback
 * for uploads here; it is a first-class path, because every extraction failure
 * below routes the user to it.
 */
export async function POST(request: Request) {
  try {
    // EC-P1-02: auth before any work. Also before the LLM call — an
    // unauthenticated caller must never be able to spend tokens.
    const { userId } = await requireSession();

    const contentType = request.headers.get("content-type") ?? "";
    let rawText: string;
    let originalFilename: string | null = null;
    let file: { buffer: Buffer; contentType: string; ext: string } | null = null;
    let warnings: string[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => {
        throw new BadRequestError("Expected a multipart form upload.");
      });
      const uploaded = form.get("file");
      if (!(uploaded instanceof File)) throw new BadRequestError("No file provided.");

      // EC-P1-15 — this check can only fire if the request got here at all.
      // The hosting platform's own body limit (Vercel: 4.5MB) rejects larger
      // bodies first with an opaque 413, which is why MAX_UPLOAD_MB is set
      // BELOW that limit in .env.example.
      if (uploaded.size > MAX_UPLOAD_BYTES) {
        throw new BadRequestError("File exceeds the upload size limit.");
      }

      const buffer = Buffer.from(await uploaded.arrayBuffer());

      // EC-P1-11 — sniff the BYTES. The filename and the client-supplied MIME
      // type are both attacker-controlled.
      const sniffed = sniffContentType(buffer);
      if (sniffed === "unknown") {
        throw new BadRequestError("Unsupported file type. Upload a PDF, DOCX, or TXT.");
      }

      const extracted = await extractResumeText({
        buffer,
        name: uploaded.name,
        type: uploaded.type,
      });
      rawText = extracted.text;
      warnings = extracted.warnings ?? [];
      // EC-P1-18 — display only. NEVER a storage path segment.
      originalFilename = uploaded.name.slice(0, 255);
      file = { buffer, contentType: uploaded.type || "application/octet-stream", ext: sniffed };
    } else {
      const body = await request.json().catch(() => ({}));
      if (typeof body?.text !== "string") {
        throw new BadRequestError("Provide a `text` field or upload a file.");
      }
      rawText = body.text;
    }

    // EC-P1-08/09/13/14 — strips control characters that Postgres would reject,
    // rejects scanned images and empty files, caps runaway length.
    const sanitised = sanitiseResumeText(rawText);
    warnings = [...warnings, ...sanitised.warnings];

    const profile = await parseResume(sanitised.text);

    const resume = await createResume({
      userId,
      profile,
      rawText: sanitised.text,   // P1.2.3 — the original is kept, always
      originalFilename,
      file,
    });

    return NextResponse.json({
      id: resume.id,
      version: resume.version,
      isDefault: resume.isDefault,
      warnings,
    });
  } catch (err) {
    if (err instanceof UnreadableDocumentError) {
      return NextResponse.json(
        { error: "UNREADABLE_DOCUMENT", message: err.message },
        { status: 400 },
      );
    }
    return toErrorResponse(err);
  }
}
