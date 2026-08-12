/**
 * Prisma client singleton (P0.3.1 — Prisma chosen, architecture.md §22.1).
 *
 * Do NOT import this outside lib/db/. The eslint rule in eslint.config.mjs
 * enforces that by import path (EC-P0-24). Use `scoped(userId)` from
 * ./repository instead, so every query carries its tenant filter.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

// Next.js dev server hot-reloads modules; without this each reload opens a new
// pool until Postgres refuses connections.
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
