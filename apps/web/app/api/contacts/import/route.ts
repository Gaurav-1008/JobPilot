/**
 * CSV contact import (P5.1.3).
 *
 * Reuses the column names The Closer's `input_loader.py` already reads, so an
 * existing targets file imports without editing.
 *
 * EC-P5-14 is the governing behavior: a bad row skips with its row number and
 * a reason; it never aborts the batch. Failing the whole import on one bad
 * address is how users learn to stop importing and start pasting addresses by
 * hand, which loses the provenance record entirely.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { importContacts } from "@/lib/db/stores/contacts";
import { CsvError, MAX_IMPORT_ROWS, parseCsv } from "@/lib/outreach/csv";

export const runtime = "nodejs";

const ImportSchema = z.object({
  applicationId: z.string().uuid(),
  /** Raw file text. The client reads the file; the server owns the parsing. */
  csv: z.string().min(1).max(2_000_000),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = ImportSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid import request.", parsed.error.flatten());
    }

    let file;
    try {
      file = parseCsv(parsed.data.csv, ["recipient_email"]);
    } catch (err) {
      // EC-P5-12: the error names the missing column rather than saying "bad CSV".
      if (err instanceof CsvError) throw new BadRequestError(err.message);
      throw err;
    }

    const outcome = await importContacts(
      userId,
      parsed.data.applicationId,
      file.rows.map((row) => ({
        recipientEmail: row.recipient_email ?? "",
        recipientName: row.recipient_name || null,
        personalizationNote: row.personalization_note || null,
        linkedinUrl: row.linkedin_url || null,
      })),
    );

    return NextResponse.json({
      imported: outcome.imported,
      skipped: outcome.skipped,
      // EC-P5-13: say so plainly rather than silently dropping the tail.
      truncated: file.truncated,
      ...(file.truncated
        ? {
            message:
              `Only the first ${MAX_IMPORT_ROWS} rows were imported. ` +
              "Split the file and import the rest separately.",
          }
        : {}),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
