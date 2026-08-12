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
