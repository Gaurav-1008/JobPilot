/**
 * User provisioning (P1.1.2).
 *
 * Lives in lib/db/ rather than lib/auth/ deliberately. `ensureUser` is the one
 * write that CANNOT be tenant-scoped — it is what establishes the tenant. That
 * makes it a data-layer concern, and keeping it here means the P0.3.4 import
 * ban stays narrow: no exemption for lib/auth/ is needed.
 *
 * Widening that ban is a decision about tenant isolation, not a convenience,
 * so the bar for adding a path to it should stay high.
 */

import { prisma } from "./client";

/**
 * Mirror a GoTrue identity into `public.users`.
 *
 * Idempotent and concurrency-safe: two parallel first requests upsert the same
 * primary key rather than racing to insert.
 *
 * Does NOT update email on every call. An email that changed in GoTrue is a
 * migration concern, not something to silently rewrite on a request path.
 */
export async function ensureUser(userId: string, email: string): Promise<void> {
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email,
      // Safe outreach defaults (dry_run TRUE, send_mode 'draft', cap 5) come
      // from the column defaults in the init migration — set in the schema, not
      // only in .env, so a row created by any path is safe.
    },
  });
}

/** Profile + the read-only outreach settings shown in P1.1.5. */
export async function getProfile(userId: string) {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      email: true,
      candidateName: true,
      candidateBackground: true,
      portfolioUrl: true,
      linkedinUrl: true,
      // Read-only until P5.5.10. Shown so the safety posture is visible from
      // day one rather than appearing later as a surprise.
      dryRun: true,
      sendMode: true,
      maxOutreachPerDay: true,
    },
  });
}

export interface ProfilePatch {
  candidateName?: string | null;
  candidateBackground?: string | null;
  portfolioUrl?: string | null;
  linkedinUrl?: string | null;
}

/**
 * Sender identity only. The outreach safety columns are intentionally absent
 * from this type — see the note on PATCH /api/profile (EC-P1-07).
 */
export async function updateProfile(userId: string, patch: ProfilePatch) {
  return prisma.user.update({
    where: { id: userId },
    data: patch,
    select: {
      email: true,
      candidateName: true,
      candidateBackground: true,
      portfolioUrl: true,
      linkedinUrl: true,
    },
  });
}
