/**
 * Next.js startup hook (P7.4.4).
 *
 * `register()` runs once per server process, before the first request is
 * served. It is the only place in ① that corresponds to "boot", which makes it
 * the right place for EC-P7-28's requirement: validate all required config at
 * startup and refuse to boot rather than failing at first use.
 *
 * THE RUNTIME GUARD MATTERS. This file is also loaded for the Edge runtime,
 * where `node:crypto`, `node:async_hooks`, and `process.env` behave differently
 * or are absent. Importing the validator unconditionally would break the Edge
 * bundle to check configuration that only the Node runtime uses. The import is
 * therefore dynamic and guarded — a static import would be hoisted and evaluated
 * regardless of the branch.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertConfig } = await import("@/lib/config/require-env");

  // Deliberately NOT caught. A throw here fails the boot, which is the whole
  // point: a container that refuses to start never takes traffic, and under a
  // rolling deploy the previous version keeps serving while this one refuses to
  // come up. Swallowing it would restore exactly the behaviour EC-P7-28
  // describes — a service that starts and then fails at first use.
  assertConfig();
}
