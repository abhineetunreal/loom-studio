// Prisma client singleton using the pg driver adapter (Prisma 7 requirement).
//
// Two connection URLs are needed for Supabase:
//   DATABASE_URL  — Supabase connection pooler (port 6543, pgBouncer transaction mode)
//                   Used here for all runtime queries — handles concurrent serverless connections.
//   DIRECT_URL    — Direct PostgreSQL connection (port 5432)
//                   Used only by the Prisma CLI for migrations (see prisma.config.ts).
//
// The singleton pattern prevents too many connections in dev when Next.js hot-reloads modules.

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
