-- P5.5.3 / EC-P5-65 — record WHICH OAuth scopes the user actually granted.
--
-- Without this column, a user who authorized JobPilot for drafts only and then
-- switched send_mode to 'send' would discover the mismatch at the Google API
-- call: a `failed` outreach_attempt row for someone who did everything right,
-- and no way for interlock check 12 to tell them what to fix.
--
-- Nullable because SMTP credentials have no scopes, and because rows written
-- before this migration genuinely do not know what was granted. Check 12 treats
-- NULL as "unknown, do not assume send is allowed" rather than as a grant.
ALTER TABLE sender_credentials
  ADD COLUMN granted_scopes TEXT;
