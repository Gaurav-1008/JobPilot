/**
 * Display-only heuristic sectioning for pasted resume text (Phase 1).
 *
 * This is a best-effort split used purely to give the input step a little
 * feedback ("we detected these sections"). It is NOT the real parser — Phase 2
 * replaces resume parsing with the Groq-backed `services/resume-parser`.
 */

const SECTION_HEADINGS: Record<string, RegExp> = {
  Summary: /^(summary|profile|objective|about)\b/i,
  Experience: /^(experience|work experience|employment|professional experience)\b/i,
  Skills: /^(skills|technical skills|core competencies)\b/i,
  Education: /^(education|academic)\b/i,
  Projects: /^(projects|selected projects)\b/i,
  Certifications: /^(certifications|licenses)\b/i,
};

export interface DetectedSection {
  name: string;
  lineCount: number;
}

/** Return a rough list of detected resume sections for display. */
export function detectSections(resumeText: string): DetectedSection[] {
  const lines = resumeText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const sections: DetectedSection[] = [];
  let current: DetectedSection | null = null;

  for (const line of lines) {
    const matched = Object.entries(SECTION_HEADINGS).find(([, re]) =>
      re.test(line),
    );
    if (matched) {
      current = { name: matched[0], lineCount: 0 };
      sections.push(current);
    } else if (current) {
      current.lineCount += 1;
    }
  }

  return sections;
}

/** True when the pasted text looks substantial enough to analyze. */
export function looksLikeResume(resumeText: string): boolean {
  return resumeText.trim().length >= 40;
}
