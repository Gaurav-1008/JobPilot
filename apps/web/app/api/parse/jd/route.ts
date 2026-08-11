import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJobDescription } from "@/services/jd-parser";
import { readJson, toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ text: z.string().min(1) });

/** POST /api/parse/jd — body { text } → JobDescriptionProfile. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("Job description text is required.");
    }
    const jd = await parseJobDescription(parsed.data.text);
    return NextResponse.json(jd);
  } catch (err) {
    return toErrorResponse(err);
  }
}
