/**
 * Prisma access for the proof bundle (P6.3).
 *
 * A one-line re-export, and it earns its place: the P0.3.4 lint rule confines
 * the Prisma client to lib/db so invariant 5 — every tenant-scoped read is
 * filtered by user_id — has exactly one directory to audit. lib/export/bundle.ts
 * builds the artifact and does its own user_id filtering; this keeps the client
 * import inside the audited boundary rather than smuggling it out to a
 * formatting module.
 */
export { prisma } from "../client";
