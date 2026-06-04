/**
 * prisma/seed.ts
 *
 * Seeds the database with:
 *   1. Default Carpets Bazaar tenant
 *   2. Designs from data/designs/manifest.json (run process-designs.ts first)
 *
 * Yarns are managed separately via `npm run import-yarns`
 * (scripts/import-yarn-libraries.ts) and are never touched here.
 *
 * Usage:
 *   npx prisma db seed
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

// ─── Default tenant ────────────────────────────────────────────────────────────

async function seedDefaultTenant(): Promise<string> {
  const adminEmail =
    process.env.ADMIN_EMAIL ?? "abhineet.rcc@gmail.com";

  const tenant = await db.tenant.upsert({
    where: { slug: "carpetsbazaar" },
    update: { adminEmail },
    create: {
      slug: "carpetsbazaar",
      name: "Carpets Bazaar",
      adminEmail,
      primaryColor: "#1a1612",
      active: true,
    },
  });

  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})`);
  return tenant.id;
}

// ─── Associate orphaned rows with the default tenant ──────────────────────────

async function associateOrphanedData(tenantId: string): Promise<void> {
  const [designs, yarns, submissions] = await Promise.all([
    db.design.updateMany({
      where: { tenantId: null },
      data: { tenantId },
    }),
    db.yarnColor.updateMany({
      where: { tenantId: null },
      data: { tenantId },
    }),
    db.colorwaySubmission.updateMany({
      where: { tenantId: null },
      data: { tenantId },
    }),
  ]);

  if (designs.count > 0)
    console.log(`✓ Associated ${designs.count} orphaned design(s)`);
  if (yarns.count > 0)
    console.log(`✓ Associated ${yarns.count} orphaned yarn(s)`);
  if (submissions.count > 0)
    console.log(`✓ Associated ${submissions.count} orphaned submission(s)`);
}

// ─── Design seeding ────────────────────────────────────────────────────────────

type DesignManifestEntry = {
  slug: string;
  name: string;
  width: number;
  height: number;
  imageUrl: string;
  sourceBmpUrl: string;
  palette: Array<{
    index: number;
    hex: string;
    pixelCount: number;
    percentage: number;
    matchedYarnCode?: string;
  }>;
};

async function seedDesigns(tenantId: string): Promise<void> {
  const manifestPath = path.join(
    process.cwd(),
    "data",
    "designs",
    "manifest.json"
  );

  if (!fs.existsSync(manifestPath)) {
    console.warn(
      "data/designs/manifest.json not found.\n" +
        "Run `npx tsx scripts/process-designs.ts` first to generate it."
    );
    return;
  }

  const designs: DesignManifestEntry[] = JSON.parse(
    fs.readFileSync(manifestPath, "utf-8")
  );

  console.log(`Seeding ${designs.length} designs...`);

  for (const design of designs) {
    await db.design.upsert({
      where: { slug: design.slug },
      update: {
        name: design.name,
        imageUrl: design.imageUrl,
        sourceBmpUrl: design.sourceBmpUrl,
        width: design.width,
        height: design.height,
        palette: design.palette,
        tenantId,
      },
      create: {
        name: design.name,
        slug: design.slug,
        imageUrl: design.imageUrl,
        sourceBmpUrl: design.sourceBmpUrl,
        width: design.width,
        height: design.height,
        palette: design.palette,
        tenantId,
      },
    });
    console.log(`  ✓ ${design.name}`);
  }

  console.log(`✓ Designs seeded.`);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const tenantId = await seedDefaultTenant();
  await associateOrphanedData(tenantId);
  await seedDesigns(tenantId);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
