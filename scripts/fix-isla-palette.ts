#!/usr/bin/env tsx
/**
 * fix-isla-palette.ts
 *
 * One-time script: for every Isla Design design, match unresolved palette
 * entries to the closest yarn by Euclidean RGB distance and store the
 * matchedYarnCode directly in the palette JSON.
 *
 * Usage:
 *   npx tsx scripts/fix-isla-palette.ts
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require("ws");

function createDbClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

type PaletteEntry = {
  index: number;
  hex: string;
  pixelCount: number;
  percentage: number;
  matchedYarnCode?: string;
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

async function main() {
  const db = createDbClient();

  // Find the Isla Design tenant
  const tenant = await db.tenant.findFirst({
    where: { name: { contains: "Isla", mode: "insensitive" } },
  });
  if (!tenant) {
    console.error("Isla Design tenant not found");
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  // Load all active yarns for this tenant
  const yarns = await db.yarnColor.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { code: true, hex: true },
  });
  console.log(`Loaded ${yarns.length} yarns`);

  const yarnEntries = yarns.map((y) => ({
    code: y.code,
    rgb: hexToRgb(y.hex),
  }));

  // Load all designs for this tenant
  const designs = await db.design.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true, palette: true },
  });
  console.log(`Found ${designs.length} designs\n`);

  let totalUpdated = 0;

  for (const design of designs) {
    const palette = design.palette as PaletteEntry[];
    let changed = false;

    for (const entry of palette) {
      if (entry.matchedYarnCode) continue;

      const entryRgb = hexToRgb(entry.hex);
      let bestDist = Infinity;
      let bestCode = "";

      for (const yarn of yarnEntries) {
        const dist = rgbDistance(entryRgb, yarn.rgb);
        if (dist < bestDist) {
          bestDist = dist;
          bestCode = yarn.code;
        }
      }

      if (bestCode) {
        entry.matchedYarnCode = bestCode;
        changed = true;
        console.log(
          `Design "${design.name}": ${entry.hex} → ${bestCode} (distance: ${bestDist.toFixed(1)})`
        );
      }
    }

    if (changed) {
      await db.design.update({
        where: { id: design.id },
        data: { palette },
      });
      totalUpdated++;
    }
  }

  console.log(`\nDone. Updated ${totalUpdated} / ${designs.length} designs.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
