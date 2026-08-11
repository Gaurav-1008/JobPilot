import type { TailoringRun } from "@/lib/schemas";
import {
  renderComparisonHtml,
  renderTailoredResumeHtml,
} from "@/lib/pdf/build-context";
import { htmlToPdf } from "@/lib/pdf/renderer";

export type PdfType = "tailored" | "comparison";

export interface GeneratedPdf {
  type: PdfType;
  filename: string;
  buffer: Buffer;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "resume"
  );
}

/** Clean, single-column tailored resume PDF. */
export async function generateTailoredPdf(
  run: TailoringRun,
): Promise<GeneratedPdf> {
  const buffer = await htmlToPdf(renderTailoredResumeHtml(run));
  return {
    type: "tailored",
    filename: `${slug(run.resume.contact.name)}-tailored.pdf`,
    buffer,
  };
}

/** Side-by-side comparison PDF — the portfolio proof artifact. */
export async function generateComparisonPdf(
  run: TailoringRun,
): Promise<GeneratedPdf> {
  const buffer = await htmlToPdf(renderComparisonHtml(run));
  return {
    type: "comparison",
    filename: `${slug(run.jobDescription.jobTitle)}-comparison.pdf`,
    buffer,
  };
}

/** Generate the requested PDF types for a run. */
export async function generatePdfs(
  run: TailoringRun,
  types: PdfType[],
): Promise<GeneratedPdf[]> {
  const out: GeneratedPdf[] = [];
  // Sequential: one Chromium instance at a time keeps memory predictable.
  for (const type of types) {
    out.push(
      type === "tailored"
        ? await generateTailoredPdf(run)
        : await generateComparisonPdf(run),
    );
  }
  return out;
}
