import type OpenAI from "openai";

import { runPrompt } from "@/lib/llm/run-prompt";
import { resumeParserPrompt } from "@/prompts/resume-parser";
import type { ResumeProfile } from "@/lib/schemas";

/**
 * Raw resume text → structured ResumeProfile via LLM cleanup.
 *
 * Phase 2 accepts pasted text only; PDF/DOCX upload arrives in Phase 5 and will
 * feed extracted text into this same function.
 */
export async function parseResume(
  resumeText: string,
  client?: OpenAI,
): Promise<ResumeProfile> {
  return runPrompt({ ...resumeParserPrompt(resumeText), client });
}
