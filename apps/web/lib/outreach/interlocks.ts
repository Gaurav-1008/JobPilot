/**
 * The interlock chain (P5.4.3, architecture.md §14.3).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE SAFETY CORE. TWELVE CHECKS, IN ORDER, ALL MUST PASS.
 *
 * Two properties matter more than anything else here:
 *
 * 1. IT FAILS CLOSED (EC-P5-56). Every outcome is either an explicit pass or a
 *    block. An unexpected exception anywhere in the chain is a BLOCK, never a
 *    fall-through to delivery. A chain of twelve checks where a thrown error
 *    reaches the provider is worse than no chain at all, because it is trusted.
 *
 * 2. THE ORDER IS DELIBERATE (EC-P5-58). It is tempting to hoist the cheap
 *    checks to the front. Do not. Dry-run is check 10 specifically so that a
 *    dry run still exercises checks 1-9 — which is what makes testing the
 *    pipeline meaningful rather than testing a different code path.
 *
 * The one thing a caller must never do is skip this and call the provider.
 * There is exactly one delivery route, and it goes through here.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { scoped } from "@/lib/db/repository";
import { findValidReview, reserveCapSlot } from "@/lib/db/stores/review";
import { log } from "@/lib/obs/logger";
import { interlockBlock } from "@/lib/obs/metrics";
import { hashBody } from "@/lib/outreach/body";
import { checkGrounding } from "@/lib/outreach/grounding";
import { loadGroundingContext } from "@/lib/outreach/review-context";
import { normalizeEmail } from "@/lib/outreach/email-address";
import { grantAllowsSend } from "@/lib/outreach/google-oauth";
import { buildPayload } from "@/lib/outreach/personalization";

export type InterlockCheck =
  | "authz"
  | "approval_token"
  | "body_integrity"
  | "contact_valid"
  | "opt_out"
  | "dedup"
  | "volume_cap"
  | "word_limit"
  | "grounding"
  | "credentials"
  | "send_mode"
  | "internal_error";

/** What the delivery step is permitted to do, decided by checks 10 and 12. */
export type DeliveryMode = "dry_run" | "draft" | "send";

export interface InterlockPass {
  ok: true;
  mode: DeliveryMode;
  /** Normalized recipient — the only address delivery may use. */
  recipient: string;
  subject: string;
  body: string;
  /** True when check 7 flipped the row to `drafted` and it must be released on failure. */
  reserved: boolean;
}

export interface InterlockBlock {
  ok: false;
  check: InterlockCheck;
  message: string;
  /** True once the cap slot was reserved, so the caller releases it. */
  reserved: boolean;
}

export type InterlockResult = InterlockPass | InterlockBlock;

export interface InterlockInput {
  userId: string;
  attemptId: string;
  /** The raw approval token the client received at approve time. */
  token: string | null;
}

function block(
  check: InterlockCheck,
  message: string,
  reserved = false,
): InterlockBlock {
  // P5.4.9 / P7.3.3 — `interlock_block_total{check}`. This was a hand-rolled
  // log line carrying the dimensions a counter would carry; it is now an actual
  // counter, and the `class` label EC-P7-21 asks for is derived from the check
  // inside the metric (opt-out and dedup blocks are the system working, and
  // must be dashboarded apart from token and body-hash failures, which are not).
  interlockBlock(check);
  log.warn("interlock.block", { check, message, outcome: "blocked" });
  return { ok: false, check, message, reserved };
}

/**
 * Run the chain.
 *
 * Returns a pass carrying the resolved delivery mode, or a block naming the
 * exact check that refused. The caller writes the audit row either way — a
 * block that leaves no trace is unauditable (EC-P5-57).
 */
export async function runInterlocks(
  input: InterlockInput,
): Promise<InterlockResult> {
  let reserved = false;

  try {
    const db = scoped(input.userId);

    /* ── 1. authn/authz ───────────────────────────────────────────────── */
    // The scoped repository is the enforcement: a row belonging to another
    // tenant simply is not found. EC-P1-26 — not-yours and does-not-exist are
    // the same answer, so this cannot be used to enumerate ids.
    const attempt = await db.outreach.byId(input.attemptId);
    if (!attempt) {
      return block("authz", "This attempt does not exist.");
    }
    if (attempt.status !== "generated") {
      // Already sent, skipped, or failed. Re-delivering would double-send.
      return block("authz", `This attempt is already ${attempt.status}.`);
    }

    /* ── 2. approval token ────────────────────────────────────────────── */
    // EC-P5-42: a hand-crafted curl carries no token and dies here. The token
    // is held by the client, so the existence of an approval row is NOT enough.
    if (!input.token) {
      return block("approval_token", "This email has not been approved.");
    }
    const review = await findValidReview(input.userId, input.token);
    if (!review || review.attemptId !== input.attemptId) {
      // EC-P5-44/46: covers unknown, expired, already-used, and wrong-attempt.
      return block(
        "approval_token",
        "That approval is no longer valid. Approve the email again.",
      );
    }

    /* ── 3. body integrity ────────────────────────────────────────────── */
    // The check that is easy to omit and expensive to omit. Without it a client
    // approves benign copy and delivers something else; the human gate would
    // bind to "the user clicked yes" rather than to specific content.
    const body = attempt.bodySnapshot ?? "";
    if (hashBody(body) !== review.bodyHash) {
      return block(
        "body_integrity",
        "The email changed after it was approved. Approve the new text.",
      );
    }

    /* ── 4. contact valid ─────────────────────────────────────────────── */
    if (!attempt.contactId) {
      return block("contact_valid", "This attempt has no contact.");
    }
    const contact = await db.contacts.byId(attempt.contactId);
    if (!contact) {
      return block("contact_valid", "The contact no longer exists.");
    }
    const recipient = normalizeEmail(contact.recipientEmail);
    if (!recipient) {
      return block("contact_valid", "The recipient address is not deliverable.");
    }

    /* ── 5. opt-out ───────────────────────────────────────────────────── */
    // EC-P5-17: evaluated HERE, at send time — not when the contact was made.
    // A contact created before the opt-out must still be blocked. EC-P5-18: the
    // comparison runs through the citext column, and covers `@domain` entries.
    if (await db.optOut.isSuppressed(recipient)) {
      return block("opt_out", "This person is on your opt-out list.");
    }

    /* ── 6. dedup ─────────────────────────────────────────────────────── */
    // EC-P5-50: keyed on the PERSON, not the contact row. The same recruiter
    // across five applications is five contact rows, and keying on contact_id
    // would let one human receive five emails while every counter reads as
    // compliant. EC-P5-51: only sent/drafted count — a failed or skipped
    // attempt must not lock someone out permanently.
    if (await db.outreach.hasContactedEmail(recipient)) {
      return block("dedup", "You have already emailed this person.");
    }

    /* ── 7. volume cap ────────────────────────────────────────────────── */
    // Rolling 24h window, counted and reserved under an advisory lock so two
    // tabs cannot both pass at N-1 (EC-P5-52/53/54).
    const profile = await db.profile();
    const slot = await reserveCapSlot(
      input.userId,
      input.attemptId,
      profile.maxOutreachPerDay,
    );
    if (!slot.ok) {
      return block(
        "volume_cap",
        `You have reached your limit of ${profile.maxOutreachPerDay} emails in 24 hours.`,
      );
    }
    reserved = true;

    /* ── 8. word limit ────────────────────────────────────────────────── */
    const wordLimit = Number(process.env.EMAIL_WORD_LIMIT ?? 150);
    if (attempt.wordCount > wordLimit) {
      return block(
        "word_limit",
        `This email is ${attempt.wordCount} words; the limit is ${wordLimit}.`,
        reserved,
      );
    }

    /* ── 9. grounding ─────────────────────────────────────────────────── */
    // §13.3 re-evaluated at DELIVERY, not trusted from generation time. The
    // body may have been edited since, and the review screen's copy is not
    // evidence of anything the server checked.
    const ctx = await loadGroundingContext(input.userId, attempt.applicationId!);
    if (ctx.resume) {
      const grounding = checkGrounding({
        body,
        resume: ctx.resume,
        tailoredBullets: ctx.tailoredBullets,
        skillVocabulary: ctx.skillVocabulary,
        recipientName: contact.recipientName,
        senderName: profile.candidateName,
        wordLimit,
        wordCount: attempt.wordCount,
        hasPayload: ctx.run !== null && buildPayload(ctx.run) !== null,
        genericHook: false,
      });
      if (grounding.blocked) {
        const reason = grounding.findings.find((f) => f.severity === "block");
        return block(
          "grounding",
          reason?.message ?? "This email makes a claim your resume does not support.",
          reserved,
        );
      }
    }

    /* ── 10. dry-run ──────────────────────────────────────────────────── */
    // Deliberately LATE (EC-P5-58): a dry run has now exercised checks 1-9, so
    // testing the pipeline tests the real path rather than a shortcut. This is
    // not a block — it resolves the mode, and delivery simulates and logs.
    if (profile.dryRun) {
      return {
        ok: true,
        mode: "dry_run",
        recipient,
        subject: attempt.subject,
        body,
        reserved,
      };
    }

    /* ── 11. credentials ──────────────────────────────────────────────── */
    // EC-P5-63: `preflight_ok_at` is cleared on any auth failure, so a revoked
    // app password blocks at the gate instead of failing at the provider.
    const credential = await db.credentials.get();
    if (!credential) {
      return block(
        "credentials",
        "No sending account is connected. Add one in settings.",
        reserved,
      );
    }
    if (!credential.preflightOkAt) {
      return block(
        "credentials",
        "Your sending account has not passed its connection check.",
        reserved,
      );
    }

    /* ── 12. mode ─────────────────────────────────────────────────────── */
    // 'draft' unless the user explicitly chose 'send'. Anything unrecognized
    // resolves to 'draft' — invariant 3, misconfiguration must not escalate.
    const mode: DeliveryMode = profile.sendMode === "send" ? "send" : "draft";

    // EC-P5-65: a drafts-only OAuth grant cannot satisfy send mode. Discovering
    // this at the provider means a `failed` row for a user who did everything
    // right, so it is caught here instead.
    //
    // A NULL scope string is treated as "unknown", not as a grant: the whole
    // point of check 12 is that sending is the escalation, and an escalation
    // may not rest on an assumption.
    if (mode === "send" && credential.provider === "gmail_api") {
      if (!grantAllowsSend(credential.grantedScopes)) {
        return block(
          "send_mode",
          "Your Google account is authorized for drafts only. Re-authorize to send.",
          reserved,
        );
      }
    }

    return { ok: true, mode, recipient, subject: attempt.subject, body, reserved };
  } catch (err) {
    // EC-P5-56 — FAIL CLOSED. This catch is the whole reason the chain can be
    // trusted: any unexpected error is a block, never a fall-through.
    // Passed as a value so the serializer projects it (name + scrubbed message)
    // rather than us flattening a possibly credential-carrying error to a string.
    log.error("interlock.exception", { name: "InterlockException", message: err });
    return block(
      "internal_error",
      "A safety check could not complete, so nothing was sent.",
      reserved,
    );
  }
}
