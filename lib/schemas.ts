import { z } from "zod";

/**
 * Domain model for Resume Shapeshifter.
 *
 * Single source of truth (Zod schema + inferred TS type) shared between client
 * and server, mirroring `docs/architecture.md` §4. Every LLM/service boundary
 * validates against these schemas.
 */

/* ------------------------------------------------------------------ */
/* Shared enums                                                        */
/* ------------------------------------------------------------------ */

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ImportanceSchema = z.enum(["high", "medium", "low"]);
export type Importance = z.infer<typeof ImportanceSchema>;

export const RunStatusSchema = z.enum([
  "draft",
  "analyzed",
  "tailored",
  "exported",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/* ------------------------------------------------------------------ */
/* 4.1 ResumeProfile                                                   */
/* ------------------------------------------------------------------ */

export const ContactInfoSchema = z.object({
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  links: z.array(z.string()).default([]),
});
export type ContactInfo = z.infer<typeof ContactInfoSchema>;

export const ExperienceEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});
export type ExperienceEntry = z.infer<typeof ExperienceEntrySchema>;

export const ProjectEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  bullets: z.array(z.string()).default([]),
});
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;

export const EducationEntrySchema = z.object({
  institution: z.string(),
  degree: z.string().optional(),
  field: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type EducationEntry = z.infer<typeof EducationEntrySchema>;

export const CertificationEntrySchema = z.object({
  name: z.string(),
  issuer: z.string().optional(),
  date: z.string().optional(),
});
export type CertificationEntry = z.infer<typeof CertificationEntrySchema>;

export const ResumeProfileSchema = z.object({
  contact: ContactInfoSchema,
  summary: z.string().default(""),
  skills: z.array(z.string()).default([]),
  experience: z.array(ExperienceEntrySchema).default([]),
  projects: z.array(ProjectEntrySchema).default([]),
  education: z.array(EducationEntrySchema).default([]),
  certifications: z.array(CertificationEntrySchema).default([]),
});
export type ResumeProfile = z.infer<typeof ResumeProfileSchema>;

/* ------------------------------------------------------------------ */
/* 4.2 JobDescriptionProfile                                           */
/* ------------------------------------------------------------------ */

export const JobDescriptionProfileSchema = z.object({
  jobTitle: z.string(),
  company: z.string().optional(),
  requiredSkills: z.array(z.string()).default([]),
  preferredSkills: z.array(z.string()).default([]),
  responsibilities: z.array(z.string()).default([]),
  qualifications: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  seniorityLevel: z.string().default(""),
  domainSignals: z.array(z.string()).default([]),
});
export type JobDescriptionProfile = z.infer<typeof JobDescriptionProfileSchema>;

/* ------------------------------------------------------------------ */
/* 4.3 MatchScore                                                      */
/* ------------------------------------------------------------------ */

const scoreValue = z.number().min(0).max(100);

export const MatchScoreSchema = z.object({
  overallScore: scoreValue,
  skillCoverageScore: scoreValue,
  responsibilityAlignmentScore: scoreValue,
  keywordScore: scoreValue,
  seniorityScore: scoreValue,
  criticalMissingRequirements: z.array(z.string()).default([]),
  explanation: z.string(),
});
export type MatchScore = z.infer<typeof MatchScoreSchema>;

/* ------------------------------------------------------------------ */
/* 4.4 TailoredResume & BulletMetadata                                 */
/* ------------------------------------------------------------------ */

export const TailoredBulletSchema = z.object({
  original: z.string(),
  tailored: z.string().min(1),
  changeReason: z.string().min(1),
  keywordsAddressed: z.array(z.string()).default([]),
  confidence: ConfidenceSchema,
  riskFlag: z.string().optional(),
});
export type TailoredBullet = z.infer<typeof TailoredBulletSchema>;

export const TailoredExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  bullets: z.array(TailoredBulletSchema).default([]),
});
export type TailoredExperience = z.infer<typeof TailoredExperienceSchema>;

export const TailoredResumeSchema = z.object({
  tailoredSummary: z.string().default(""),
  tailoredSkills: z.array(z.string()).default([]),
  tailoredExperience: z.array(TailoredExperienceSchema).default([]),
});
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

/* ------------------------------------------------------------------ */
/* 4.5 GapAnalysis                                                     */
/* ------------------------------------------------------------------ */

export const ResumeGapSchema = z.object({
  name: z.string(),
  importance: ImportanceSchema,
  jdEvidence: z.string(),
  resumeEvidence: z.string(),
  suggestedAction: z.string(),
  canSafelyAdd: z.boolean(),
});
export type ResumeGap = z.infer<typeof ResumeGapSchema>;

export const GapAnalysisSchema = z.object({
  gaps: z.array(ResumeGapSchema).default([]),
});
export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

/* ------------------------------------------------------------------ */
/* 4.6 TailoringRun (aggregate)                                        */
/* ------------------------------------------------------------------ */

export const TailoringRunSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  status: RunStatusSchema,
  /** Raw pasted/extracted resume text, retained for audit (§5.1). */
  rawResumeText: z.string().optional(),
  resume: ResumeProfileSchema,
  jobDescription: JobDescriptionProfileSchema,
  originalMatch: MatchScoreSchema,
  tailoredResume: TailoredResumeSchema.nullable().default(null),
  tailoredMatch: MatchScoreSchema.nullable().default(null),
  gapAnalysis: GapAnalysisSchema,
  warnings: z.array(z.string()).default([]),
});
export type TailoringRun = z.infer<typeof TailoringRunSchema>;

/* ------------------------------------------------------------------ */
/* API payload schemas                                                 */
/* ------------------------------------------------------------------ */

export const AnalyzeRequestSchema = z.object({
  resumeText: z.string().min(1),
  jdText: z.string().min(1),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const AnalyzeResponseSchema = z.object({
  runId: z.string(),
  resume: ResumeProfileSchema,
  jobDescription: JobDescriptionProfileSchema,
  originalMatch: MatchScoreSchema,
  gapAnalysis: GapAnalysisSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const TailorRequestSchema = z.object({
  runId: z.string().min(1),
});
export type TailorRequest = z.infer<typeof TailorRequestSchema>;

export const TailorResponseSchema = z.object({
  runId: z.string(),
  tailoredResume: TailoredResumeSchema,
  tailoredMatch: MatchScoreSchema,
  warnings: z.array(z.string()).default([]),
});
export type TailorResponse = z.infer<typeof TailorResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
