/**
 * Tenant-scoped data access (P0.3.3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS THE ONLY WAY ROUTE HANDLERS TOUCH THE DATABASE.
 *
 * Standing invariant 5 (edge-cases/README.md): every tenant-scoped read is
 * filtered by user_id. A miss is a data leak, not a bug. ADR-003 makes this
 * tractable — persistence lives in one language, in one place, so there is
 * exactly one file to audit.
 *
 * The eslint rule in eslint.config.mjs (P0.3.4) bans importing the Prisma
 * client anywhere except this directory. EC-P0-24: it bans by IMPORT PATH, not
 * by identifier name, because `import { prisma as db }` defeats a name-based
 * rule trivially.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EC-P1-26: for tenant-scoped resources, "not yours" and "does not exist" must
 * be the SAME response. Every read here returns null rather than throwing, so
 * handlers naturally produce 404. A 403 would confirm the id exists, which is
 * an enumeration oracle across the whole platform.
 */

import { domainKey } from "@/lib/outreach/email-address";
import { prisma } from "./client";

/**
 * All accessors for one user. Obtain via `scoped(session.userId)` at the top of
 * a handler and never reach around it.
 */
export function scoped(userId: string) {
  return {
    /* ---------------- Resumes (FR3) ---------------- */

    resumes: {
      list: () =>
        prisma.resume.findMany({
          where: { userId },
          orderBy: { version: "desc" },
        }),

      byId: (id: string) =>
        prisma.resume.findFirst({ where: { id, userId } }),

      /** The resume batch scoring runs against. Null is a real state: EC-P4-21. */
      default: () =>
        prisma.resume.findFirst({ where: { userId, isDefault: true } }),

      /**
       * EC-P1-20: unset-then-set in ONE transaction. Two tabs doing this
       * concurrently must not both land on `is_default = true` — the partial
       * unique index turns that into a violation, and the transaction turns
       * the violation into a retry rather than a corrupt state.
       */
      setDefault: (id: string) =>
        prisma.$transaction(async (tx) => {
          const target = await tx.resume.findFirst({ where: { id, userId } });
          if (!target) return null;
          await tx.resume.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
          return tx.resume.update({ where: { id }, data: { isDefault: true } });
        }),
    },

    /* ---------------- Discovery ---------------- */

    harvestRuns: {
      byId: (id: string) =>
        prisma.harvestRun.findFirst({ where: { id, userId } }),

      list: () =>
        prisma.harvestRun.findMany({
          where: { userId },
          orderBy: { startedAt: "desc" },
        }),
    },

    jobs: {
      byId: (id: string) => prisma.job.findFirst({ where: { id, userId } }),

      /** EC-P4-27: unscored jobs sort LAST. Never treat "unscored" as zero — */
      /** that buries a job that simply has not been evaluated yet. */
      ranked: () =>
        prisma.job.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }],
        }),
    },

    /* ---------------- System of record ---------------- */

    applications: {
      byId: (id: string) =>
        prisma.application.findFirst({ where: { id, userId } }),

      byJobId: (jobId: string) =>
        prisma.application.findFirst({ where: { jobId, userId } }),

      list: () =>
        prisma.application.findMany({
          where: { userId },
          orderBy: { updatedAt: "desc" },
        }),
    },

    tailoringRuns: {
      byId: (id: string) =>
        prisma.tailoringRun.findFirst({ where: { id, userId } }),

      /** Latest full run for an application — the payload source for FR7. */
      /** EC-P5-27: only `full` runs carry bulletChanges; cheap runs have none. */
      latestFullForApplication: (applicationId: string) =>
        prisma.tailoringRun.findFirst({
          where: { applicationId, userId, tier: "full" },
          orderBy: { createdAt: "desc" },
        }),
    },

    /* ---------------- Outreach ---------------- */

    contacts: {
      byId: (id: string) => prisma.contact.findFirst({ where: { id, userId } }),

      forApplication: (applicationId: string) =>
        prisma.contact.findMany({ where: { applicationId, userId } }),
    },

    optOut: {
      /**
       * EC-P5-17/18: evaluated at SEND time, not at contact creation. A row
       * created before the opt-out must still be blocked. CITEXT handles case —
       * the comparison goes through the column type, not an application-side
       * `toLowerCase()`, so a differently-cased entry still matches.
       *
       * EC-P5-16: an entry may be a single address or a whole `@domain`. Both
       * forms are tested in one query; checking only the address would let a
       * domain-level opt-out the user believed they had set never fire.
       *
       * Callers must pass an address already through `normalizeEmail()`.
       */
      isSuppressed: async (email: string) => {
        const hit = await prisma.optOutEntry.findFirst({
          where: { userId, email: { in: [email, domainKey(email)] } },
          select: { email: true },
        });
        return hit !== null;
      },
    },

    outreach: {
      byId: (id: string) =>
        prisma.outreachAttempt.findFirst({ where: { id, userId } }),

      /**
       * EC-P5-50 — dedup keys on the PERSON, not the contact row. The same
       * recruiter across five applications is five contact rows; keying on
       * contact_id would let one human receive five emails while every counter
       * still reads as compliant.
       */
      hasContactedEmail: async (email: string) => {
        const hit = await prisma.outreachAttempt.findFirst({
          where: {
            userId,
            status: { in: ["sent", "drafted"] },
            contact: { recipientEmail: email },
          },
          select: { id: true },
        });
        return hit !== null;
      },

      /**
       * EC-P5-52/54 — the volume cap is a rolling-window QUERY, not a counter.
       * A counter would not survive restarts, concurrent tabs, or multiple
       * devices, and "today" in server-local time would let a user send 2N
       * across midnight.
       *
       * NOTE: counting here is NOT sufficient on its own. The count and the
       * insert must happen inside one transaction with an advisory lock on
       * user_id, or two tabs both read N-1 and both pass. That interlock lands
       * in P5.4.6; this accessor is the read half only.
       */
      countInLast24h: () =>
        prisma.outreachAttempt.count({
          where: {
            userId,
            status: { in: ["sent", "drafted"] },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
    },

    credentials: {
      get: () => prisma.senderCredential.findUnique({ where: { userId } }),
    },

    /**
     * The user's own row, including the three outreach safety settings.
     *
     * The interlock chain reads `dryRun`, `sendMode`, and `maxOutreachPerDay`
     * HERE, at delivery time, rather than trusting anything the client sent or
     * anything read earlier in the request. EC-P5-55: a user may flip dry_run
     * between approving and sending, and the value that must win is the one in
     * the database at the moment of delivery.
     */
    profile: () =>
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          candidateName: true,
          candidateBackground: true,
          portfolioUrl: true,
          linkedinUrl: true,
          dryRun: true,
          sendMode: true,
          maxOutreachPerDay: true,
        },
      }),
  };
}

export type ScopedDb = ReturnType<typeof scoped>;
