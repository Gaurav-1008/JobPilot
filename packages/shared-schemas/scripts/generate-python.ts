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
 * wire schema carries a Zod effect (.refine/.transform/.superRefine), because
 * those vanish in JSON Schema and Pydantic would silently accept what Zod
 * rejects.
 *
 * EC-P0-17 is enforced too: every wire property must be snake_case.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

import { WIRE_SCHEMAS } from "../src/wire";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "generated", "models.py");

/** Pinned so regeneration is reproducible (EC-P0-15). */
const CODEGEN_PIN = "datamodel-code-generator==0.26.3";

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

function assertNoZodEffects(): void {
  const offenders: string[] = [];
  for (const [name, schema] of Object.entries(WIRE_SCHEMAS)) {
    // ZodEffects is what .refine/.transform/.superRefine produce.
    if ((schema as { _def?: { typeName?: string } })._def?.typeName === "ZodEffects") {
      offenders.push(name);
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `EC-P0-14 violation: wire schema(s) carry a Zod effect: ${offenders.join(", ")}.\n` +
        `.refine()/.transform()/.superRefine() are invisible to JSON Schema, so the\n` +
        `generated Pydantic model would silently accept what Zod rejects.\n` +
        `Implement the rule by hand in BOTH languages and add a contract test.`,
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
    const jsonSchema = zodToJsonSchema(
      WIRE_SCHEMAS[name as keyof typeof WIRE_SCHEMAS],
      { name, target: "jsonSchema7", $refStrategy: "none" },
    ) as Record<string, unknown>;
    const defs = (jsonSchema.definitions ?? {}) as Record<string, unknown>;
    definitions[name] = defs[name] ?? jsonSchema;
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
  assertNoZodEffects();
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
      "python3",
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
      `datamodel-code-generator failed. Install it with the pinned version:\n` +
        `  .venv/bin/python -m pip install ${CODEGEN_PIN}\n\n` +
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
