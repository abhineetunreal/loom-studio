#!/usr/bin/env tsx
/**
 * seed-color-lookup.ts
 *
 * Upserts all entries from data/oneloom-rendered-lookup.json into the
 * ColorLookup table for the default tenant.
 *
 * This is intentionally separate from prisma/seed.ts so that re-running
 * `prisma db seed` (which seeds designs) never touches ColorLookup entries
 * that admins may have manually curated.
 *
 * Usage:
 *   npx tsx scripts/seed-color-lookup.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import fs from "fs";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar";
  const tenant = await db.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, name: true },
  });
  if (!tenant) {
    console.error(`Tenant "${tenantSlug}" not found. Run prisma db seed first.`);
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const lookupPath = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");
  if (!fs.existsSync(lookupPath)) {
    console.error("data/oneloom-rendered-lookup.json not found.");
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(lookupPath, "utf-8")) as Record<
    string,
    { code: string; catalogHex?: string }
  >;

  const entries = Object.entries(raw).filter(([k]) => /^#[0-9a-f]{6}$/i.test(k));
  console.log(`Seeding ${entries.length} ColorLookup entries...`);

  let upserted = 0;
  for (const [hex, { code, catalogHex }] of entries) {
    await db.colorLookup.upsert({
      where: {
        tenantId_renderedHex: { tenantId: tenant.id, renderedHex: hex.toLowerCase() },
      },
      update: { yarnCode: code, catalogHex: catalogHex ?? null },
      create: {
        tenantId: tenant.id,
        renderedHex: hex.toLowerCase(),
        yarnCode: code,
        catalogHex: catalogHex ?? null,
        library: "OneLoom",
      },
    });
    upserted++;
  }

  console.log(`✓ ColorLookup seeded (${upserted} entries).`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
