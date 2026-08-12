/**
 * Re-export shim (P0.2.1).
 *
 * The domain moved to packages/shared-schemas so the Python service ④ can be
 * generated from the same source. This file stays so that every existing
 * `@/lib/schemas` import site keeps working unchanged — the anti-corruption
 * layer pattern, same as lib/db/stores in P1.3.1.
 *
 * Add new types to packages/shared-schemas/src/domain.ts, not here.
 */
export * from "@jobpilot/shared-schemas";
