/**
 * Prompt versioning (P1.3.4).
 *
 * EC-P1-31/32 — every tailoring run records which prompts produced it. Without
 * this, "why did it say that?" about a two-week-old run is unanswerable once a
 * prompt is edited.
 *
 * The version is a CONTENT HASH, not a hand-maintained string. A human-managed
 * version number gets forgotten on exactly the edit that mattered; a hash
 * cannot. Editing any prompt file changes the stamp automatically.
 *
 * The hash covers the prompt sources as a set, so a run is reproducible against
 * the exact prompt text that generated it — provided prompt files are only ever
 * ADDED to, never edited in place, once runs exist that reference them.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

let cached: string | undefined;

export function promptVersion(): string {
  if (cached) return cached;

  const dir = join(process.cwd(), "prompts");
  const hash = createHash("sha256");

  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (f === "versions.ts") continue;   // this file is not a prompt
      hash.update(f);
      hash.update(readFileSync(join(dir, f)));
    }
  }

  cached = `p1-${hash.digest("hex").slice(0, 12)}`;
  return cached;
}

/** Test seam — lets a test pin a version without touching the filesystem. */
export function __setPromptVersion(v: string | undefined): void {
  cached = v;
}
