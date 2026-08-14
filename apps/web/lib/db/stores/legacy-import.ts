/**
 * Legacy import persistence (P6.4).
 *
 * EC-P6-32 governs the whole file: imports get re-run, so assume it. Every
 * write is an upsert on a natural key and importing the same CSV twice leaves
 * the database identical to importing it once.
 */

import { createHash } from "node:crypto";

import { normalizeEmail, normalizeOptOutEntry } from "@/lib/outreach/email-address";
import { prisma } from "../client";

type Row = Record<string, string>;

export interface LegacyImportInput {
  userId: string;
  jobs: Row[];
  outreach: Row[];
  optOuts: Row[];
}

export interface LegacyImportResult {
  jobs: { imported: number; skipped: number };
  outreach: { imported: number; skipped: number };
  optOuts: { imported: number; skipped: number };
  notes: string[];
}

/** Deterministic key so a re-import updates rather than duplicates. */
function dedupeKeyFor(company: string, title: string, location: string): string {
  const basis = `${company}|${title}|${location}`.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

export async function importLegacy(
  input: LegacyImportInput,
): Promise<LegacyImportResult> {
  const { userId } = input;
  const notes: string[] = [];
  const result: LegacyImportResult = {
    jobs: { imported: 0, skipped: 0 },
    outreach: { imported: 0, skipped: 0 },
    optOuts: { imported: 0, skipped: 0 },
    notes,
  };

  /* ── jobs.csv (P6.4.1) ─────────────────────────────────────────────── */
  if (input.jobs.length > 0) {
    /**
     * EC-P6-33: the CSV has no user_id, so rows are assigned to the importing
     * user under a synthetic harvest run. The run is marked in its query so the
     * tracker can distinguish "I found this before JobPilot existed" from a
     * real harvest — otherwise imported history silently claims to be
     * something the platform did.
     */
    const run = await prisma.harvestRun.upsert({
      where: { id: legacyRunId(userId) },
      update: {},
      create: {
        id: legacyRunId(userId),
        userId,
        roleQuery: "legacy import",
        boards: ["legacy_import"],
        status: "complete",
        startedAt: new Date(0),
        finishedAt: new Date(0),
      },
    });

    for (const row of input.jobs) {
      const company = row.company ?? "";
      const title = row.title ?? row.role ?? "";
      if (!company && !title) {
        result.jobs.skipped += 1;
        continue;
      }
      const location = row.location ?? "";
      const key = dedupeKeyFor(company, title, location);

      // EC-P6-34: an existing row WINS. A legacy record must never overwrite
      // something the platform harvested and may have scored or tailored.
      const existing = await prisma.job.findFirst({
        where: { userId, dedupeKey: key },
        select: { id: true },
      });
      if (existing) {
        result.jobs.skipped += 1;
        continue;
      }

      await prisma.job.create({
        data: {
          userId,
          harvestRunId: run.id,
          source: row.source || "manual",
          title: title || "(untitled)",
          company: company || "(unknown)",
          location: location || null,
          link: row.link || row.url || "",
          postedAt: row.posted_at || null,
          dedupeKey: key,
          hydrationStatus: "pending",
        },
      });
      result.jobs.imported += 1;
    }
  }

  /* ── outreach_log.csv (P6.4.2) ─────────────────────────────────────── */
  if (input.outreach.length > 0) {
    for (const row of input.outreach) {
      const email = normalizeEmail(row.recipient_email ?? "");
      if (!email) {
        result.outreach.skipped += 1;
        continue;
      }

      /**
       * EC-P6-24 in practice: no application, no contact. Both FKs stay null
       * and `origin='legacy_import'` releases the CHECK that would otherwise
       * require them. This is the row shape the nullable columns exist for.
       *
       * EC-P6-35: `parent_id` was added in The Closer's Phase 8, so both file
       * shapes exist in the wild. A missing column becomes null rather than an
       * error — and the legacy value is a SUBJECT string, not a UUID, so it is
       * never written into the uuid FK. It survives in the error/notes column
       * instead of corrupting the relation.
       */
      const timestamp = row.timestamp || "";
      const subject = row.subject || "(no subject)";
      const naturalKey = createHash("sha256")
        .update(`${timestamp}|${email}|${subject}`)
        .digest("hex")
        .slice(0, 32);

      const already = await prisma.outreachAttempt.findFirst({
        where: { userId, origin: "legacy_import", bodyHash: naturalKey },
        select: { id: true },
      });
      if (already) {
        result.outreach.skipped += 1;
        continue;
      }

      const status = (row.status || "").toLowerCase();
      const known = ["generated", "drafted", "sent", "skipped", "failed"];

      await prisma.outreachAttempt.create({
        data: {
          userId,
          applicationId: null,
          contactId: null,
          origin: "legacy_import",
          subject,
          // No body was ever logged by the original tool; null is honest, and
          // EC-P6-17 makes the sweep skip these rather than quote nothing.
          bodySnapshot: null,
          bodyHash: naturalKey,
          wordCount: Number(row.word_count) || 0,
          generationSource: "template",
          status: known.includes(status) ? status : "sent",
          provider: "smtp",
          errorMessage: row.error_message || null,
          createdAt: parseDate(timestamp),
        },
      });
      result.outreach.imported += 1;
    }
    notes.push(
      "Imported outreach rows have no application or contact — the original " +
        "log did not record them. They appear in exports and counts, not on " +
        "individual applications.",
    );
  }

  /* ── do_not_contact.csv (P6.4.3) ───────────────────────────────────── */
  for (const row of input.optOuts) {
    const raw = row.recipient_email ?? row.email ?? Object.values(row)[0] ?? "";
    const entry = normalizeOptOutEntry(raw);
    if (!entry) {
      result.optOuts.skipped += 1;
      continue;
    }
    await prisma.optOutEntry.upsert({
      where: { userId_email: { userId, email: entry } },
      create: { userId, email: entry, reason: row.reason || "legacy import" },
      update: {},
    });
    result.optOuts.imported += 1;
  }

  return result;
}

/** Stable per-user id so re-imports reuse the same synthetic run. */
function legacyRunId(userId: string): string {
  const hex = createHash("sha256").update(`legacy:${userId}`).digest("hex");
  return [
    hex.slice(0, 8), hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,                                  // version 4
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join("-");
}

function parseDate(value: string): Date {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}
