// Prisma client singleton using the pg driver adapter (Prisma 7 requirement).
//
// Two connection URLs are needed for Supabase:
//   DATABASE_URL  — Supabase connection pooler (port 6543, pgBouncer transaction mode)
//                   Used here for all runtime queries — handles concurrent serverless connections.
//   DIRECT_URL    — Direct PostgreSQL connection (port 5432)
//                   Used only by the Prisma CLI for migrations (see prisma.config.ts).
//
// The singleton pattern prevents too many connections in dev when Next.js hot-reloads modules.
//
// The client is built lazily on first use, NOT at module load. Constructing it
// at import time would read DATABASE_URL and throw whenever it is absent — which
// breaks `next build` page-data collection for every route in the app (e.g.
// Preview deployments where the var isn't scoped, or local builds), even routes
// that never touch the database. Deferring to first access means DATABASE_URL is
// only required when a query actually runs (request time), where a missing var
// still throws the same clear error. Mirrors the lazy Anthropic client in
// lib/ai/client.ts.

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  // Cache the singleton everywhere. In dev this also survives Next.js module
  // hot-reloads; in production it just avoids rebuilding the client per call.
  globalForPrisma.prisma = client;
  return client;
}

// A Proxy so existing call sites keep using `db.tenant.findMany(...)`,
// `db.$transaction(...)`, etc. unchanged; the real client is built (and
// DATABASE_URL checked) on first property access, not when this module is
// imported.
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
