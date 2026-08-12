import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Allow underscore-prefixed args/vars reserved for a later phase.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      /**
       * P0.3.4 — the Prisma client is reachable only from lib/db/.
       *
       * EC-P0-24: banned by IMPORT PATH, not by identifier name. A name-based
       * rule is defeated by `import { prisma as db }` in one keystroke; a path
       * ban is not.
       *
       * Why this matters more than it looks: standing invariant 5 says every
       * tenant-scoped read is filtered by user_id, and a miss is a data leak
       * rather than a bug. Funnelling all access through `scoped(userId)`
       * leaves exactly one file to audit for that.
       */
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@prisma/client",
              message:
                "Do not import the Prisma client directly. Use `scoped(userId)` " +
                "from @/lib/db so every query carries its tenant filter (P0.3.3).",
            },
          ],
          patterns: [
            {
              group: ["**/lib/db/client", "@/lib/db/client"],
              message:
                "lib/db/client is internal. Use `scoped(userId)` from @/lib/db (P0.3.3).",
            },
          ],
        },
      ],
    },
  },
  {
    // The repository itself is the one place allowed to hold the client.
    files: ["lib/db/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
