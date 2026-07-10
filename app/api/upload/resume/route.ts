import { NextResponse } from "next/server";

import {
  extractResumeText,
  MAX_UPLOAD_BYTES,
} from "@/lib/document-extract";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/upload/resume — multipart form with a `file` field (PDF/DOCX/TXT).
 * Returns extracted { text, warnings } to drop into the analyze flow.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => {
      throw new BadRequestError("Expected a multipart form upload.");
    });

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new BadRequestError("No file provided.");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestError("File exceeds the upload size limit.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await extractResumeText({
      buffer,
      name: file.name,
      type: file.type,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
