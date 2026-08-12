-- ============================================================================
-- Allow tailoring runs that belong to no application yet (P1.3.3).
--
-- DESIGN GAP found during Phase 1 implementation, not during design.
--
-- architecture.md §7.2 declared tailoring_runs.application_id and .resume_id
-- NOT NULL, which is correct for the Phase 4 flow: harvest -> hydrate -> score
-- -> tailor, where an Application always exists first.
--
-- But Phase 1's entire demo is "paste a resume and a JD, tailor, close the
-- browser, reopen — the run is still there". There is no Job, no Application,
-- and no stored Resume at that point; jobs arrive in P2 and applications in P4.
-- With both columns NOT NULL, the phase cannot persist its own deliverable.
--
-- Both become nullable. The Phase 4 path still sets them, and the tier column
-- already distinguishes how a run was produced. A CHECK requiring them for
-- tier='full' was considered and REJECTED: a Phase 1 paste-driven run is also
-- 'full' (it runs the complete prompt chain), so the constraint would forbid
-- exactly the case this migration exists to allow.
-- ============================================================================

ALTER TABLE tailoring_runs ALTER COLUMN application_id DROP NOT NULL;
ALTER TABLE tailoring_runs ALTER COLUMN resume_id      DROP NOT NULL;
