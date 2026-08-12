/**
 * Executes the P0.3.2 migration against real Postgres (PGlite = Postgres
 * compiled to WASM) and asserts the constraints actually FIRE.
 *
 * Why this exists: docker-compose (P0.4.1) gives the real local stack, but
 * requires Docker. This runs anywhere Node runs, so the migration is verified
 * on every machine and in CI without a daemon. A constraint that exists but
 * does not reject is worth nothing, so every check below tries to violate it.
 *
 *   node scripts/verify-migration.mjs
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const db = await PGlite.create({ extensions: { citext, pgcrypto } });
await db.exec(readFileSync("apps/web/prisma/migrations/00000000000000_init/migration.sql", "utf8"));

let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok    ${m}`); pass++; };
const bad = (m) => { console.log(`  FAIL  ${m}`); fail++; };

/** Assert a statement is REJECTED by the database. */
async function rejects(label, sql) {
  try { await db.exec(sql); bad(`${label} — was ACCEPTED, constraint not enforced`); }
  catch { ok(label); }
}
/** Assert a statement is accepted. */
async function accepts(label, sql) {
  try { await db.exec(sql); ok(label); }
  catch (e) { bad(`${label} — rejected: ${e.message.slice(0, 70)}`); }
}

const u = (await db.query(
  `INSERT INTO users (email) VALUES ('a@example.com') RETURNING id`)).rows[0].id;

console.log("\nSafe defaults (invariant 3 — missing config must not enable sending)");
const row = (await db.query(`SELECT dry_run, send_mode, max_outreach_per_day FROM users WHERE id=$1`, [u])).rows[0];
row.dry_run === true ? ok("dry_run defaults TRUE") : bad(`dry_run defaulted ${row.dry_run}`);
row.send_mode === "draft" ? ok("send_mode defaults 'draft'") : bad(`send_mode ${row.send_mode}`);
row.max_outreach_per_day === 5 ? ok("max_outreach_per_day defaults 5") : bad("cap default wrong");

console.log("\nCHECK constraints (EC-P0-23)");
await rejects("send_mode rejects 'blast'",
  `INSERT INTO users (email, send_mode) VALUES ('b@example.com','blast')`);
await rejects("max_outreach_per_day rejects 9999",
  `INSERT INTO users (email, max_outreach_per_day) VALUES ('c@example.com',9999)`);

console.log("\nEC-P0-22 — partial unique index on default resume");
await accepts("first default resume",
  `INSERT INTO resumes (user_id,version,kind,profile,raw_text,is_default)
   VALUES ('${u}',1,'master','{}','x',true)`);
await rejects("SECOND default resume for same user",
  `INSERT INTO resumes (user_id,version,kind,profile,raw_text,is_default)
   VALUES ('${u}',2,'master','{}','x',true)`);
await accepts("non-default second resume",
  `INSERT INTO resumes (user_id,version,kind,profile,raw_text,is_default)
   VALUES ('${u}',2,'master','{}','x',false)`);
await rejects("duplicate (user_id, version)",
  `INSERT INTO resumes (user_id,version,kind,profile,raw_text)
   VALUES ('${u}',1,'master','{}','x')`);

console.log("\nEC-P5-07 / ADR-008 — contact provenance is mandatory");
const run = (await db.query(
  `INSERT INTO harvest_runs (user_id,role_query,boards) VALUES ($1,'r','{naukri}') RETURNING id`, [u])).rows[0].id;
const job = (await db.query(
  `INSERT INTO jobs (user_id,harvest_run_id,source,title,company,link,dedupe_key)
   VALUES ($1,$2,'naukri','T','C','http://e.com','k') RETURNING id`, [u, run])).rows[0].id;
const app = (await db.query(
  `INSERT INTO applications (user_id,job_id) VALUES ($1,$2) RETURNING id`, [u, job])).rows[0].id;
await rejects("contact with NULL source",
  `INSERT INTO contacts (user_id,application_id,recipient_email,source)
   VALUES ('${u}','${app}','x@example.com',NULL)`);
await rejects("contact with source='public_profile' (dropped by ADR-008)",
  `INSERT INTO contacts (user_id,application_id,recipient_email,source)
   VALUES ('${u}','${app}','x@example.com','public_profile')`);
await accepts("contact with source='user_entered'",
  `INSERT INTO contacts (user_id,application_id,recipient_email,source)
   VALUES ('${u}','${app}','x@example.com','user_entered')`);

console.log("\nEC-P6-24 — platform_rows_are_complete");
await rejects("platform outreach row missing application_id/body",
  `INSERT INTO outreach_attempts (user_id,subject,generation_source,status,provider)
   VALUES ('${u}','s','template','generated','dry_run')`);
await accepts("legacy_import row MAY omit them (this is why the FKs are nullable)",
  `INSERT INTO outreach_attempts (user_id,origin,subject,generation_source,status,provider)
   VALUES ('${u}','legacy_import','s','template','sent','smtp')`);

console.log("\nCITEXT — case-insensitive email matching (EC-P5-18, EC-P1-04)");
await rejects("duplicate user email differing only in case",
  `INSERT INTO users (email) VALUES ('A@EXAMPLE.COM')`);
const ci = (await db.query(
  `INSERT INTO opt_out_entries (user_id,email) VALUES ($1,'Opt@Example.com') RETURNING email`, [u])).rows[0];
const hit = (await db.query(
  `SELECT 1 FROM opt_out_entries WHERE user_id=$1 AND email='opt@example.com'`, [u])).rows.length;
hit === 1 ? ok("opt-out matches regardless of case") : bad("opt-out case-sensitive — suppression would silently miss");

console.log("\nEC-P1-23 — deleting a resume must not erase the audit trail");
// The application must actually REFERENCE the resume, or RESTRICT has nothing
// to protect and the delete trivially succeeds. (First version of this test got
// that wrong and reported a false failure.)
const resumeId = (await db.query(
  `SELECT id FROM resumes WHERE user_id=$1 AND version=1`, [u])).rows[0].id;
await db.query(`UPDATE applications SET resume_id=$1 WHERE id=$2`, [resumeId, app]);
await rejects("DELETE a resume an application points at (ON DELETE RESTRICT)",
  `DELETE FROM resumes WHERE id='${resumeId}'`);
await accepts("DELETE an unreferenced resume",
  `DELETE FROM resumes WHERE user_id='${u}' AND version=2`);

console.log("\nCascade — account deletion reaches every table (EC-P7-25)");
const before = (await db.query(`SELECT count(*)::int n FROM outreach_attempts`)).rows[0].n;
await db.query(`DELETE FROM users WHERE id=$1`, [u]);
const after = (await db.query(`SELECT count(*)::int n FROM outreach_attempts`)).rows[0].n;
const orphans = (await db.query(
  `SELECT (SELECT count(*) FROM jobs) + (SELECT count(*) FROM applications)
        + (SELECT count(*) FROM contacts) + (SELECT count(*) FROM harvest_runs) AS n`)).rows[0].n;
(before > 0 && after === 0 && Number(orphans) === 0)
  ? ok(`deleting the user removed all dependent rows (${before} outreach rows, 0 orphans)`)
  : bad(`orphans remain after user delete: outreach=${after} others=${orphans}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
