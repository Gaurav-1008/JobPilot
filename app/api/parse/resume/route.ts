import { NextResponse } from "next/server";
import { z } from "zod";

import { parseResume } from "@/services/resume-parser";
import { readJson, toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ text: z.string().min(1) });

/** POST /api/parse/resume — body { text } → ResumeProfile. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("Resume text is required.");
    }
    const resume = await parseResume(parsed.data.text);
    return NextResponse.json(resume);
  } catch (err) {
    return toErrorResponse(err);
  }
}
