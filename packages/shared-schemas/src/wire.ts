/**
 * WIRE TYPES — the ① ⇄ ④ contract (architecture.md §8).
 *
 * These are the ONLY shapes that cross the TypeScript/Python boundary. The rich
 * domain types (TailoringRun, MatchScore, Application) deliberately never enter
 * Python: ④ receives only the flattened PersonalizationPayload, which keeps the
 * generated Pydantic surface small and means most schema evolution touches
 * TypeScript alone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RULES FOR THIS FILE. They exist because JSON Schema — the intermediate
 * representation the Pydantic codegen reads — cannot express everything Zod
 * can. A rule broken here produces a Pydantic model that silently accepts what
 * Zod rejects, and the failure surfaces at runtime in the other language.
 *
 *   EC-P0-17  snake_case keys. Decided: matches The Closer's existing Contact
 *             fields. A boundary test fails on any camelCase key.
 *   EC-P0-12  .nullable(), NEVER .optional(). JSON has no `undefined`; an
 *             absent key and a null key must mean the same thing.
 *   EC-P0-13  No .default(). Zod applies defaults on parse, Pydantic on
 *             construction — a field defaulted on one side arrives absent on
 *             the other. Both sides send every field explicitly.
 *   EC-P0-11  Timestamps are ISO strings, never z.date(). Parse to datetime
 *             inside each service, never across the boundary.
 *   EC-P0-14  NO .refine() / .superRefine(). They vanish in JSON Schema, so
 *             Pydantic loses the constraint with no error. Cross-field rules
 *             are implemented by hand in BOTH languages, with a contract test
 *             asserting both reject the same payload.
 *   EC-P0-09  No z.union() / z.discriminatedUnion(). Flat objects with an enum
 *             discriminator instead.
 *   EC-P0-10  No z.record(). Explicit objects with known keys.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* 1. Board search   ③ -> ④                                            */
/* ------------------------------------------------------------------ */

export const BoardSearchRequestSchema = z.object({
  role: z.string().min(1).max(200),
  location: z.string().max(200).nullable(),
  // EC-P2-14: clamped at ① before it ever reaches a scraper.
  limit: z.number().int().min(1).max(50),
});
export type BoardSearchRequest = z.infer<typeof BoardSearchRequestSchema>;

/** Exactly the six jobs.csv columns — the adapters return this unchanged. */
export const RawJobSchema = z.object({
  source: z.string(),
  title: z.string(),
  company: z.string(),
  location: z.string().nullable(),
  link: z.string(),
  posted_at: z.string().nullable(),
});
export type RawJob = z.infer<typeof RawJobSchema>;

/**
 * EC-P2-01 / EC-P2-06: `partial` and `error` describe HOW the board behaved.
 * `response_bytes` lets ③ distinguish a legitimately empty search (small page,
 * zero rows) from a broken selector (large page, zero rows) — the silent
 * failure mode of every scraper.
 *
 * P2.2.10: a board failure is DATA, not an exception. ④ returns 200 with
 * `error` set rather than raising.
 */
export const BoardSearchResponseSchema = z.object({
  jobs: z.array(RawJobSchema),
  partial: z.boolean(),
  error: z.string().nullable(),
  response_bytes: z.number().int().nonnegative().nullable(),
});
export type BoardSearchResponse = z.infer<typeof BoardSearchResponseSchema>;

/* ------------------------------------------------------------------ */
/* 2. Hydrate   ③ -> ④                                                 */
/* ------------------------------------------------------------------ */

export const HydrateRequestSchema = z.object({
  url: z.string().url(),
});
export type HydrateRequest = z.infer<typeof HydrateRequestSchema>;

/**
 * EC-P3-22 / EC-P3-23: `blocked` covers bot-walls, login pages, and expired
 * postings that answer 200 with non-JD content. ④ classifies; it never returns
 * a login page as successfully hydrated.
 *
 * EC-P3-46: `method` is what actually PRODUCED the text, not what was tried
 * first — a Firecrawl attempt that fell through to Playwright reports
 * "playwright".
 */
export const HydrateResponseSchema = z.object({
  raw_text: z.string(),
  method: z.enum(["firecrawl", "playwright"]),
  blocked: z.boolean(),
  reason: z.string().nullable(),
});
export type HydrateResponse = z.infer<typeof HydrateResponseSchema>;

/* ------------------------------------------------------------------ */
/* 3. Email generate   ① -> ④                                          */
/* ------------------------------------------------------------------ */

/** The sender's own identity, hoisted from per-contact rows to the user. */
export const SenderIdentitySchema = z.object({
  candidate_name: z.string(),
  candidate_background: z.string(),
  portfolio_url: z.string().nullable(),
  linkedin_url: z.string().nullable(),
});
export type SenderIdentity = z.infer<typeof SenderIdentitySchema>;

/** Company, role, and job_url are auto-filled from the Job (FR6). */
export const WireContactSchema = z.object({
  recipient_email: z.string(),
  recipient_name: z.string().nullable(),
  company: z.string(),
  role: z.string(),
  job_url: z.string().nullable(),
  personalization_note: z.string().nullable(),
});
export type WireContact = z.infer<typeof WireContactSchema>;

/** FR7. snake_case mirror of PersonalizationPayload in domain.ts. */
export const WirePersonalizationSchema = z.object({
  top_matched_skills: z.array(z.string()),
  strongest_bullet: z.string().nullable(),
  jd_hooks: z.array(z.string()),
  match_score: z.number().int(),
  honest_gaps: z.array(z.string()),
});
export type WirePersonalization = z.infer<typeof WirePersonalizationSchema>;

export const EmailGenerateRequestSchema = z.object({
  contact: WireContactSchema,
  sender: SenderIdentitySchema,
  // EC-P5-20: null => plain six-part template + generic-hook warning.
  personalization: WirePersonalizationSchema.nullable(),
  use_llm: z.boolean(),
  word_limit: z.number().int().min(1),
});
export type EmailGenerateRequest = z.infer<typeof EmailGenerateRequestSchema>;

/**
 * `source` reports which path produced the body. Any LLM failure — missing key,
 * missing dependency, API error, truncated completion, failed validation —
 * comes back as "template". The pipeline never requires the LLM to work.
 */
export const EmailGenerateResponseSchema = z.object({
  subject_options: z.array(z.string()),
  body: z.string(),
  word_count: z.number().int().nonnegative(),
  source: z.enum(["template", "llm"]),
  warnings: z.array(z.string()),   // generic_hook, word_limit_exceeded
});
export type EmailGenerateResponse = z.infer<typeof EmailGenerateResponseSchema>;

/* ------------------------------------------------------------------ */
/* 4. Email deliver   ① -> ④                                           */
/* ------------------------------------------------------------------ */

/**
 * EC-P5-61 / EC-P5-62: decrypted by ①, passed per-request, used and DISCARDED.
 * ④ must never log, cache, or persist these — and its exception handler must
 * redact the request body, since the default of echoing request context into
 * logs is exactly wrong here.
 */
export const WireCredentialsSchema = z.object({
  provider: z.enum(["smtp", "gmail_api"]),
  smtp_host: z.string().nullable(),
  smtp_port: z.number().int().nullable(),
  smtp_user: z.string().nullable(),
  smtp_password: z.string().nullable(),
  sender_name: z.string().nullable(),
  gmail_access_token: z.string().nullable(),
});
export type WireCredentials = z.infer<typeof WireCredentialsSchema>;

export const EmailDeliverRequestSchema = z.object({
  credentials: WireCredentialsSchema,
  to: z.string(),
  subject: z.string(),
  body: z.string(),
  // EC-P5-60: "dry_run" must open NO socket. Asserted at the socket layer.
  mode: z.enum(["draft", "send", "dry_run"]),
});
export type EmailDeliverRequest = z.infer<typeof EmailDeliverRequestSchema>;

export const EmailDeliverResponseSchema = z.object({
  status: z.enum(["drafted", "sent", "failed"]),
  provider_message_id: z.string().nullable(),
  error: z.string().nullable(),
});
export type EmailDeliverResponse = z.infer<typeof EmailDeliverResponseSchema>;

/* ------------------------------------------------------------------ */
/* 5. Preflight   ① -> ④                                               */
/* ------------------------------------------------------------------ */

export const PreflightRequestSchema = z.object({
  credentials: WireCredentialsSchema,
});
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;

export const PreflightResponseSchema = z.object({
  ok: z.boolean(),
  reason: z.string().nullable(),
});
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>;

/* ------------------------------------------------------------------ */
/* Registry — what the codegen emits, and what the contract test walks. */
/* ------------------------------------------------------------------ */

export const WIRE_SCHEMAS = {
  BoardSearchRequest: BoardSearchRequestSchema,
  BoardSearchResponse: BoardSearchResponseSchema,
  RawJob: RawJobSchema,
  HydrateRequest: HydrateRequestSchema,
  HydrateResponse: HydrateResponseSchema,
  SenderIdentity: SenderIdentitySchema,
  WireContact: WireContactSchema,
  WirePersonalization: WirePersonalizationSchema,
  EmailGenerateRequest: EmailGenerateRequestSchema,
  EmailGenerateResponse: EmailGenerateResponseSchema,
  WireCredentials: WireCredentialsSchema,
  EmailDeliverRequest: EmailDeliverRequestSchema,
  EmailDeliverResponse: EmailDeliverResponseSchema,
  PreflightRequest: PreflightRequestSchema,
  PreflightResponse: PreflightResponseSchema,
} as const;
