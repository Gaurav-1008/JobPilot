/**
 * Follow-up sweep (P6.2) — the only scheduled, unattended thing in this
 * product that touches the outreach path.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS MODULE MUST NEVER REACH DELIVERY.
 *
 * EC-P6-13 is the phase's defining constraint. The sweep creates rows in
 * `generated` state and stops. Follow-ups enter the same review queue and
 * traverse the identical twelve interlocks as anything else, because the moment
 * a scheduled job can send, this stops being a tool that helps someone write an
 * email and becomes an automated cold-email engine — the exact thing
 * problemStatement.md §12.3 exists to prevent.
 *
 * The defence is structural rather than procedural: no import of the interlock
 * chain, no import of the delivery client, no path to /deliver. A test asserts
 * the absence by reading this file, because "we checked" decays and an import
 * graph does not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two corrections from edge-cases/phase-6.md that change what the feature IS:
 *
 * EC-P6-11 — selection keys off `outreach_attempts.status='sent'`, NEVER off
 *   `applications.status='emailed'`. In draft mode "delivery succeeded" means a
 *   draft was created in Gmail, which the user may never have sent. Following
 *   up on an unsent email is the most embarrassing thing this feature could do.
 *
 * EC-P6-12 — nothing in this architecture can detect a reply: no IMAP, no
 *   webhook, no inbox read. So "no reply after N days" is really "no response
 *   RECORDED BY THE USER", and it is named that way here and in the UI. Naming
 *   it honestly costs nothing; naming it dishonestly means every user
 *   eventually discovers the system was never watching.
 */

export {
  DEFAULT_FOLLOWUP_DAYS,
  MAX_FOLLOWUP_DEPTH,
  findSweepCandidates,
  recordFollowUp,
  type SweepCandidate,
  type SweepOptions,
} from "@/lib/db/stores/followups";
