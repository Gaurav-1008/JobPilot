/**
 * Legacy CSV import (P6.4) — the pre-JobPilot history.
 *
 * The original projects wrote three files: `jobs.csv` from the harvester,
 * `outreach_log.csv` from The Closer, and `do_not_contact.csv` alongside it.
 * Importing them is what makes the tracker a complete record rather than a
 * record that starts the day the platform did.
 *
 * EC-P6-24 was the blocker, and Phase 0 had already solved it:
 * `outreach_attempts.application_id` and `contact_id` are nullable, with the
 * `platform_rows_are_complete` CHECK requiring both only when
 * `origin='platform'`. Legacy rows carry neither, which is exactly why the
 * column exists. No migration was needed — worth stating, because the edge
 * case predicted one.
 *
 * EC-P6-32: imports get re-run. Every write here is an upsert on a natural
 * key, so importing the same file twice produces the same database as once.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { CsvError, parseCsv } from "@/lib/outreach/csv";
import { importLegacy } from "@/lib/db/stores/legacy-import";

export const runtime = "nodejs";
export const maxDuration = 120;

const Schema = z.object({
  /** Any subset — users rarely have all three files. */
  jobsCsv: z.string().max(4_000_000).optional(),
  outreachLogCsv: z.string().max(4_000_000).optional(),
  doNotContactCsv: z.string().max(1_000_000).optional(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = Schema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid import.", parsed.error.flatten());
    }
    const { jobsCsv, outreachLogCsv, doNotContactCsv } = parsed.data;
    if (!jobsCsv && !outreachLogCsv && !doNotContactCsv) {
      throw new BadRequestError("Provide at least one CSV to import.");
    }

    try {
      const result = await importLegacy({
        userId,
        jobs: jobsCsv ? parseCsv(jobsCsv).rows : [],
        outreach: outreachLogCsv ? parseCsv(outreachLogCsv).rows : [],
        optOuts: doNotContactCsv ? parseCsv(doNotContactCsv).rows : [],
      });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof CsvError) throw new BadRequestError(err.message);
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
