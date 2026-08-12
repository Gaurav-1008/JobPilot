import { z } from "zod";

/**
 * JobPilot domain model — the single source of truth.
 *
 * Zod schema + inferred TS type, shared between client, server, and (via
 * codegen, see ../scripts/generate-python.ts) the Python service ④.
 *
 * The tailoring half of this file moved here verbatim from
 * apps/web/lib/schemas.ts. Per architecture.md §8.7 those shapes are proven and
 * MUST NOT be redesigned — the merge work happens around them, not inside them.
 * apps/web/lib/schemas.ts is now a re-export shim so every existing import site
 * keeps working unchanged.
 *
 * The platform half (Job, JobDescription, HarvestRun, Application, Contact,
 * OutreachAttempt) is new for the merge and appears at the bottom.
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

/* ================================================================== */
/* PLATFORM ENTITIES — new for the merge (P0.2.2)                      */
/*                                                                     */
/* Mirrors architecture.md §7.2. Where a column has a CHECK constraint */
/* in the DDL, the enum here must match it exactly — the database is   */
/* the last line of defence, not the only one.                         */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

export const JobSourceSchema = z.enum(["naukri", "remoteok", "wellfound", "manual"]);
export type JobSource = z.infer<typeof JobSourceSchema>;

export const HydrationStatusSchema = z.enum(["pending", "hydrated", "failed", "blocked"]);
export type HydrationStatus = z.infer<typeof HydrationStatusSchema>;

export const BoardStatusSchema = z.enum(["ok", "partial", "failed"]);
export type BoardStatus = z.infer<typeof BoardStatusSchema>;

export const HarvestRunStatusSchema = z.enum([
  "queued",
  "running",
  "complete",
  "partial",
  "failed",
]);
export type HarvestRunStatus = z.infer<typeof HarvestRunStatusSchema>;

/**
 * Per-board outcome inside a harvest run.
 *
 * EC-P2-01 vs EC-P2-06: `ok` with `count: 0` means the search legitimately
 * matched nothing. A broken selector must NOT land here — it is `failed` with a
 * reason. `responseBytes` exists so the two can be told apart in logs: a large
 * response yielding zero rows is a selector break, not an empty result.
 */
export const BoardResultSchema = z.object({
  status: BoardStatusSchema,
  count: z.number().int().nonnegative(),
  reason: z.string().nullable(),
  responseBytes: z.number().int().nonnegative().nullable(),
});
export type BoardResult = z.infer<typeof BoardResultSchema>;

/**
 * EC-P0-10: an explicit object with three known keys, not `z.record()` —
 * index signatures lose their key typing through JSON Schema.
 */
export const BoardResultsSchema = z.object({
  naukri: BoardResultSchema.nullable(),
  remoteok: BoardResultSchema.nullable(),
  wellfound: BoardResultSchema.nullable(),
});
export type BoardResults = z.infer<typeof BoardResultsSchema>;

export const HarvestRunSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  roleQuery: z.string().min(1),
  location: z.string().nullable(),
  boards: z.array(JobSourceSchema),
  status: HarvestRunStatusSchema,
  boardResults: BoardResultsSchema,
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type HarvestRun = z.infer<typeof HarvestRunSchema>;

/**
 * The first six fields are EXACTLY the columns of the harvester's jobs.csv, so
 * the board adapters need no rewrite (architecture.md §7.2).
 *
 * EC-P2-19: `harvestRunId` is the run that FIRST saw this job; `lastSeenRunId`
 * is the most recent. A single FK could not answer "what did run 3 find?" once
 * the upsert keeps the original row.
 */
export const JobSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  source: JobSourceSchema,
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().nullable(),
  link: z.string().url(),
  postedAt: z.string().nullable(),          // verbatim: "2 days ago", "Today"
  postedAtParsed: z.string().datetime().nullable(), // EC-P2-51: best-effort
  harvestRunId: z.string().uuid(),
  lastSeenRunId: z.string().uuid().nullable(),
  dedupeKey: z.string().min(1),
  hydrationStatus: HydrationStatusSchema,
  createdAt: z.string().datetime(),
});
export type Job = z.infer<typeof JobSchema>;

export const ExtractionMethodSchema = z.enum(["firecrawl", "playwright", "manual_paste"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethodSchema>;

/**
 * Closes Breakage 1. The structured half reuses JobDescriptionProfile above —
 * unchanged, per §8.7.
 */
export const JobDescriptionSchema = z.object({
  jobId: z.string().uuid(),
  rawText: z.string().min(1),
  extractionMethod: ExtractionMethodSchema,
  profile: JobDescriptionProfileSchema,
  extractedAt: z.string().datetime(),
});
export type JobDescription = z.infer<typeof JobDescriptionSchema>;

/* ------------------------------------------------------------------ */
/* System of record                                                    */
/* ------------------------------------------------------------------ */

export const ApplicationStatusSchema = z.enum([
  "saved",
  "scored",
  "tailored",
  "contact_added",
  "emailed",
  "replied",
  "interviewing",
  "rejected",
  "closed",
]);
export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;

/**
 * EC-P6-01: `replied`, `interviewing`, `rejected`, and `closed` are set by a
 * human and are STICKY — an automatic transition must never overwrite them.
 * Enforced in the status-transition helper, not by this schema.
 */
export const TERMINAL_MANUAL_STATUSES = [
  "replied",
  "interviewing",
  "rejected",
  "closed",
] as const satisfies readonly ApplicationStatus[];

export const ApplicationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: ApplicationStatusSchema,
  activeTailoringRunId: z.string().uuid().nullable(),
  resumeId: z.string().uuid().nullable(),
  originalScore: z.number().int().min(0).max(100).nullable(),
  tailoredScore: z.number().int().min(0).max(100).nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Application = z.infer<typeof ApplicationSchema>;

/* ------------------------------------------------------------------ */
/* Outreach                                                            */
/* ------------------------------------------------------------------ */

/**
 * ADR-008 — three accountable sources only. `public_profile` from the problem
 * statement's draft enum is deliberately ABSENT: at review time it cannot be
 * told apart from scraped-individual sourcing, which defeats the purpose of
 * recording provenance at all.
 *
 * EC-P5-07: there is no default. A contact must declare where it came from.
 */
export const ContactSourceSchema = z.enum([
  "user_entered",
  "company_careers_page",
  "imported_csv",
]);
export type ContactSource = z.infer<typeof ContactSourceSchema>;

export const SuppressionReasonSchema = z.enum(["opt_out", "already_contacted", "invalid"]);
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;

export const ContactSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  applicationId: z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientName: z.string().nullable(),
  source: ContactSourceSchema,
  personalizationNote: z.string().nullable(),
  linkedinUrl: z.string().url().nullable(),
  suppressed: z.boolean(),
  suppressionReason: SuppressionReasonSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const OutreachStatusSchema = z.enum([
  "generated",
  "drafted",
  "sent",
  "skipped",
  "failed",
]);
export type OutreachStatus = z.infer<typeof OutreachStatusSchema>;

export const OutreachProviderSchema = z.enum(["dry_run", "smtp", "gmail_api"]);
export type OutreachProvider = z.infer<typeof OutreachProviderSchema>;

export const GenerationSourceSchema = z.enum(["template", "llm"]);
export type GenerationSource = z.infer<typeof GenerationSourceSchema>;

/**
 * Replaces The Closer's outreach_log.csv. Append-only by convention: no UPDATE
 * except the terminal status transition, written in the same transaction as the
 * provider call.
 *
 * EC-P6-24: `applicationId`, `contactId`, `bodySnapshot`, and `bodyHash` are
 * nullable ONLY so legacy CSV rows can be imported — that file carried none of
 * them. The `platform_rows_are_complete` CHECK in the DDL requires all four on
 * any row where `origin = 'platform'`.
 */
export const OutreachAttemptSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  applicationId: z.string().uuid().nullable(),
  contactId: z.string().uuid().nullable(),
  origin: z.enum(["platform", "legacy_import"]),
  parentId: z.string().uuid().nullable(),
  subject: z.string(),
  bodySnapshot: z.string().nullable(),
  bodyHash: z.string().nullable(),
  wordCount: z.number().int().nonnegative(),
  generationSource: GenerationSourceSchema,
  status: OutreachStatusSchema,
  provider: OutreachProviderSchema,
  providerMessageId: z.string().nullable(),
  // EC-P5-59: stamped BEFORE the provider call, so a lost response leaves
  // evidence that a draft may exist despite a 'failed' status.
  providerAttemptedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type OutreachAttempt = z.infer<typeof OutreachAttemptSchema>;

/**
 * FR7 — built by lib/personalization.ts as a PURE function over a persisted
 * TailoringRun. Every field must trace to a stored artifact; nothing is
 * generated here.
 *
 * EC-P5-24: `honestGaps` is a SUPPRESSION list — what the email must not claim
 * competence in. It is never content.
 */
export const PersonalizationPayloadSchema = z.object({
  topMatchedSkills: z.array(z.string()),
  strongestBullet: z.string().nullable(),
  jdHooks: z.array(z.string()),
  matchScore: z.number().int().min(0).max(100),
  honestGaps: z.array(z.string()),
});
export type PersonalizationPayload = z.infer<typeof PersonalizationPayloadSchema>;
