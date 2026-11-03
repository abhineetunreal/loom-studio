#!/usr/bin/env npx tsx
/**
 * Extract dominant hex color from each Wool_Colors swatch image
 * and update the `hex` field in the database.
 *
 * Usage:
 *   npx tsx scripts/update-yarn-hex.ts                    # dry run (preview only)
 *   npx tsx scripts/update-yarn-hex.ts --apply             # actually update the DB
 *   npx tsx scripts/update-yarn-hex.ts --library OneLoom   # target a different library
 *   npx tsx scripts/update-yarn-hex.ts --only-placeholder  # only update yarns with #888888
 */

import "dotenv/config";
import { db } from "@/lib/db";
import sharp from "sharp";

// ─── CLI Args ────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    apply: false,
    library: "Wool_Colors",
    onlyPlaceholder: false,
    tenantSlug: "",
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") result.apply = true;
    else if (args[i] === "--library" || args[i] === "-l") result.library = args[++i];
    else if (args[i] === "--only-placeholder") result.onlyPlaceholder = true;
    else if (args[i] === "--tenant") result.tenantSlug = args[++i];
  }
  return result;
}

// ─── Color extraction ────────────────────────────────────────────────────────

/**
 * Download swatch image and extract dominant color from the center region.
 * We sample the center 50% of the image to avoid edges/borders.
 */
async function extractDominantHex(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) return null;

    // Crop to center 50% to avoid borders/edges
    const cropW = Math.max(1, Math.floor(metadata.width * 0.5));
    const cropH = Math.max(1, Math.floor(metadata.height * 0.5));
    const left = Math.floor((metadata.width - cropW) / 2);
    const top = Math.floor((metadata.height - cropH) / 2);

    // Resize the cropped center to 1x1 pixel to get the average color
    const { data, info } = await image
      .extract({ left, top, width: cropW, height: cropH })
      .resize(1, 1, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels < 3) return null;

    const r = data[0];
    const g = data[1];
    const b = data[2];

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  } catch (err) {
    console.error(`  ⚠️  Failed to extract: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Resolve tenant
  let tenant: { id: string; name: string; slug: string } | null;
  if (opts.tenantSlug) {
    tenant = await db.tenant.findFirst({
      where: { slug: opts.tenantSlug },
      select: { id: true, name: true, slug: true },
    });
  } else {
    tenant = await db.tenant.findFirst({
      select: { id: true, name: true, slug: true },
    });
  }
  if (!tenant) {
    console.error("No tenant found.");
    process.exit(1);
  }

  // Query yarns
  const where: Record<string, unknown> = {
    tenantId: tenant.id,
    isActive: true,
    material: { equals: opts.library, mode: "insensitive" },
    swatchImageUrl: { not: null },
  };
  if (opts.onlyPlaceholder) {
    where.hex = "#888888";
  }

  const yarns = await db.yarnColor.findMany({
    where,
    select: { id: true, code: true, name: true, hex: true, swatchImageUrl: true },
    orderBy: { code: "asc" },
  });

  console.log(`\n🏭 Tenant: ${tenant.name} (${tenant.slug})`);
  console.log(`🧶 Library: ${opts.library}`);
  console.log(`📦 Yarns to process: ${yarns.length}`);
  console.log(`🔧 Mode: ${opts.apply ? "APPLY (will update DB)" : "DRY RUN (preview only)"}\n`);

  if (yarns.length === 0) {
    console.log("No yarns found matching criteria.");
    await db.$disconnect();
    return;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < yarns.length; i++) {
    const yarn = yarns[i];
    const num = `[${i + 1}/${yarns.length}]`;

    if (!yarn.swatchImageUrl) {
      console.log(`${num} ${yarn.code.padEnd(12)} — no swatch URL, skipping`);
      skipped++;
      continue;
    }

    const newHex = await extractDominantHex(yarn.swatchImageUrl);

    if (!newHex) {
      console.log(`${num} ${yarn.code.padEnd(12)} — extraction failed`);
      failed++;
      continue;
    }

    const changed = newHex.toLowerCase() !== yarn.hex.toLowerCase();
    const marker = changed ? "🎨" : "✓";

    console.log(
      `${num} ${yarn.code.padEnd(12)} ${yarn.hex} → ${newHex} ${marker}${changed ? "" : " (unchanged)"}`,
    );

    if (opts.apply && changed) {
      await db.yarnColor.update({
        where: { id: yarn.id },
        data: { hex: newHex },
      });
      updated++;
    } else if (!changed) {
      skipped++;
    }
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  SUMMARY`);
  console.log(`${"═".repeat(50)}`);
  if (opts.apply) {
    console.log(`  Updated: ${updated}`);
  } else {
    console.log(`  Would update: ${yarns.length - skipped - failed}`);
    console.log(`  Run with --apply to write changes to DB`);
  }
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);
  console.log(`${"═".repeat(50)}\n`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
