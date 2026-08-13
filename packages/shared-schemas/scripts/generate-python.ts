/**
 * Zod -> JSON Schema -> Pydantic v2 codegen (P0.2.4).
 *
 *   npm run generate --workspace=packages/shared-schemas    # write models.py
 *   npm run check    --workspace=packages/shared-schemas    # fail on drift
 *
 * The `--check` mode is what CI runs (P0.2.6). It regenerates in memory and
 * exits non-zero if the committed file differs, so a Zod edit that is not
 * regenerated fails the build instead of silently desynchronising ④.
 *
 * EC-P0-15: determinism matters more than convenience here. A codegen that
 * emits differently-ordered output on different machines produces spurious
 * diffs, and people learn to ignore the check — which is worse than not having
 * it. Hence: pinned generator versions, sorted keys, and a stable model order.
 *
 * EC-P0-14 is enforced rather than documented: this script REFUSES to emit if a
 * wire schema carries a .refine()/.superRefine()/.transform(), because those
 * vanish in JSON Schema and Pydantic would silently accept what Zod rejects.
 * See assertNoUnrepresentableSchemas() — the detection is version-specific to
 * zod 4 and must be re-verified after any zod upgrade.
 *
 * EC-P0-17 is enforced too: every wire property must be snake_case.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { WIRE_SCHEMAS } from "../src/wire";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "generated", "models.py");

/** Pinned so regeneration is reproducible (EC-P0-15). */
const CODEGEN_PIN = "datamodel-code-generator==0.26.3";

/**
 * The interpreter that actually has the generator.
 *
 * This was a bare "python3", which meant the drift gate could not run on a
 * correctly-configured machine. The repo installs its Python tooling into
 * `.venv` — the error message below says exactly that — while `python3`
 * resolves to whatever is first on PATH, here Homebrew's 3.14. So the script
 * told you to install into a location it then refused to look in, and
 * `npm run schemas:check` failed with "No module named
 * datamodel_code_generator" against a tree that was perfectly in sync.
 *
 * That is the worst failure mode a drift gate can have. It cries wolf, people
 * stop believing it, and then a REAL desync between Zod and ④ sails through —
 * which is the entire thing EC-P0-15 is worried about.
 *
 * Prefer the repo venv; fall back to PATH so CI, which installs into the job's
 * own interpreter, keeps working unchanged.
 */
function codegenPython(): string {
  const venv = join(HERE, "..", "..", "..", ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

const HEADER = `# ============================================================================
# GENERATED FILE — DO NOT EDIT BY HAND.
#
# Source:    packages/shared-schemas/src/wire.ts   (Zod, the source of truth)
# Regenerate: npm run generate --workspace=packages/shared-schemas
# CI check:   npm run check    --workspace=packages/shared-schemas
#
# Editing this file directly will be reverted by the next regeneration, and the
# CI drift check (P0.2.6) will fail the build in the meantime.
# ============================================================================
`;

/* -------------------------------------------------------------------- */
/* Guards — fail loudly BEFORE emitting anything                         */
/* -------------------------------------------------------------------- */

/**
 * EC-P0-14 — reject anything JSON Schema cannot carry.
 *
 * This guard is written against zod 4's internals, which are NOT the same as
 * zod 3's. The first version of this file tested
 * `_def.typeName === "ZodEffects"`, which was correct for zod 3 and silently
 * passes on zod 4 — a broken guard that reports success. It was caught only by
 * re-running the deliberate-break test after the version change. Re-run that
 * test after any zod upgrade; do not assume this still works.
 *
 * How zod 4 actually represents these (verified, not assumed):
 *
 *   .refine(fn)     -> def.checks contains a check whose `check` is "custom"
 *   .transform(fn)  -> def.type becomes "pipe"
 *   .min(1)         -> check "min_length"      <- representable, must NOT flag
 *   .max(50)        -> check "less_than"       <- representable, must NOT flag
 *   .email()        -> check "string_format"   <- representable, must NOT flag
 *
 * Only "custom" is unrepresentable. Confirmed empirically that
 * `z.toJSONSchema()` SILENTLY SUCCEEDS on a refined schema and drops the
 * constraint — it does not throw — so nothing downstream would catch this.
 */
function assertNoUnrepresentableSchemas(): void {
  const offenders: string[] = [];

  const walk = (node: unknown, path: string, seen: Set<unknown>): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const def = (node as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
    if (def) {
      if (def.type === "pipe") {
        offenders.push(`${path} (.transform()/.pipe() — becomes a "pipe" node)`);
      }
      const checks = (def.checks ?? []) as Array<{ _zod?: { def?: { check?: string } } }>;
      for (const c of checks) {
        if (c?._zod?.def?.check === "custom") {
          offenders.push(`${path} (.refine()/.superRefine() — a "custom" check)`);
        }
      }
    }

    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "parent") continue;
      walk(v, `${path}.${k}`, seen);
    }
  };

  for (const [name, schema] of Object.entries(WIRE_SCHEMAS)) {
    walk(schema, name, new Set());
  }

  if (offenders.length > 0) {
    throw new Error(
      `EC-P0-14 violation: wire schema(s) carry constraints JSON Schema cannot express:\n` +
        offenders.map((o) => `  - ${o}`).join("\n") +
        `\n\nThese vanish in conversion, so the generated Pydantic model would\n` +
        `silently ACCEPT what Zod rejects — and z.toJSONSchema() does not throw.\n` +
        `Implement the rule by hand in BOTH languages and add a contract test\n` +
        `asserting they reject the same payload.`,
    );
  }
}

const SNAKE = /^[a-z][a-z0-9_]*$/;

function assertSnakeCaseProperties(schemas: Record<string, unknown>): void {
  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      for (const key of Object.keys(obj.properties as Record<string, unknown>)) {
        if (!SNAKE.test(key)) offenders.push(`${path}.${key}`);
      }
    }
    for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
  };
  for (const [name, s] of Object.entries(schemas)) walk(s, name);
  if (offenders.length > 0) {
    throw new Error(
      `EC-P0-17 violation: non-snake_case wire propert(ies): ${offenders.join(", ")}.\n` +
        `The wire format is snake_case (architecture.md §22.1). Rename in wire.ts.`,
    );
  }
}

/* -------------------------------------------------------------------- */
/* Build                                                                 */
/* -------------------------------------------------------------------- */

/** Recursively sort object keys so output is byte-stable (EC-P0-15). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = sortKeysDeep(src[key]);
  return out;
}

function buildJsonSchema(): Record<string, unknown> {
  // Stable model order regardless of object-key iteration (EC-P0-15).
  const names = Object.keys(WIRE_SCHEMAS).sort();
  const definitions: Record<string, unknown> = {};
  for (const name of names) {
    // zod 4 ships JSON Schema conversion natively, so there is no third-party
    // converter to keep in step with the zod version. `io: "input"` describes
    // what a caller may SEND, which is what ④ validates on the way in.
    definitions[name] = z.toJSONSchema(
      WIRE_SCHEMAS[name as keyof typeof WIRE_SCHEMAS],
      { target: "draft-7", io: "input" },
    ) as unknown as Record<string, unknown>;
  }
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "JobPilotWireContract",
    type: "object",
    properties: Object.fromEntries(names.map((n) => [n, { $ref: `#/definitions/${n}` }])),
    definitions,
  };
}

function generate(): string {
  assertNoUnrepresentableSchemas();
  const schema = buildJsonSchema();
  assertSnakeCaseProperties(schema.definitions as Record<string, unknown>);

  const tmp = mkdtempSync(join(tmpdir(), "jobpilot-schemas-"));
  const schemaPath = join(tmp, "wire.json");
  const outPath = join(tmp, "models.py");
  // Sorted keys => byte-identical output across machines (EC-P0-15).
  // NB: this must be a recursive sort, NOT JSON.stringify's replacer argument.
  // An array replacer is an allow-list applied at EVERY nesting level, so
  // passing top-level key names there silently strips every nested property
  // and emits an empty contract. (Learned the hard way.)
  writeFileSync(schemaPath, JSON.stringify(sortKeysDeep(schema), null, 2));

  try {
    execFileSync(
      codegenPython(),
      [
        "-m", "datamodel_code_generator",
        "--input", schemaPath,
        "--input-file-type", "jsonschema",
        "--output", outPath,
        "--output-model-type", "pydantic_v2.BaseModel",  // EC-P0-19: v2
        "--target-python-version", "3.10",               // EC-P0-06
        "--use-standard-collections",
        "--use-schema-description",
        "--disable-timestamp",                           // EC-P0-15: no clock
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    return HEADER + readFileSync(outPath, "utf8");
  } catch (err) {
    throw new Error(
      `datamodel-code-generator failed.\n` +
        // Name the interpreter that was actually tried. Without it, the advice
        // below is unfalsifiable: the previous version of this message told
        // people to install into .venv while silently running a different
        // python, so following the instructions exactly did not fix anything.
        `  interpreter: ${codegenPython()}\n` +
        `  install it there with:\n` +
        `    ${codegenPython()} -m pip install ${CODEGEN_PIN}\n\n` +
        String((err as { stderr?: Buffer }).stderr ?? err),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------- */

const check = process.argv.includes("--check");
const generated = generate();

if (check) {
  const committed = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (committed !== generated) {
    console.error(
      "SCHEMA DRIFT: generated/models.py is out of date with src/wire.ts.\n" +
        "Run:  npm run generate --workspace=packages/shared-schemas\n" +
        "...then commit the result in the SAME commit as the Zod change.",
    );
    process.exit(1);
  }
  console.log("schemas in sync");
} else {
  writeFileSync(OUT, generated);
  console.log(`wrote ${OUT}`);
}
