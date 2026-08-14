/**
 * Account deletion (P7.4.5).
 *
 * DELETE /api/account — removes every row and every stored object for the
 * signed-in user. There is no soft delete and no grace period: the user asked
 * to be forgotten, and a "deleted" flag that keeps the rows is the thing people
 * mean when they say a deletion request was ignored.
 *
 * GET /api/account/deletion-preview lives here too, as the GET, because the
 * confirmation screen must be able to state what will be destroyed BEFORE the
 * button is pressed (EC-P7-26).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse, BadRequestError, readJson } from "@/lib/api-errors";
import {
  DELETION_CONSEQUENCES,
  deleteAccount,
} from "@/lib/db/stores/account-deletion";
import { log } from "@/lib/obs/logger";

export const runtime = "nodejs";

/** What the user is agreeing to. Shown before the control is enabled. */
export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ consequences: DELETION_CONSEQUENCES });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Typing the phrase is the confirmation.
 *
 * A destructive, irreversible action needs friction proportional to the
 * consequence, and a modal with a red button supplies none — it is dismissed by
 * the same reflex that dismisses every other modal. Requiring the exact word
 * means the user has read at least one sentence.
 */
const Body = z.object({
  confirm: z.literal("DELETE"),
});

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireSession();

    const parsed = Body.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError(
        'Type DELETE to confirm. This cannot be undone.',
      );
    }

    const result = await deleteAccount(userId);

    // Objects left on the worklist are NOT an error the user should see. Their
    // rows are gone, which is what they asked for; the reaper finishes the
    // storage side. Surfacing "partially deleted" would invite them to retry an
    // operation against an account that no longer exists.
    if (result.objectsPending > 0) {
      log.warn("account.objects_pending", {
        outcome: "degraded",
        count: result.objectsPending,
      });
    }

    return NextResponse.json({
      deleted: true,
      objectsRemoved: result.objectsDeleted,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
