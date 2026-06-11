#!/usr/bin/env tsx
/**
 * process-designs.ts
 *
 * Converts BMP design files → web-ready PNGs and uploads both to Supabase Storage.
 *
 * Pipeline per file:
 *   1. Convert BMP → PNG using lib/design-processing.bmpToPng
 *      (sharp fast path for 24bpp; jimp fallback for 8bpp indexed)
 *   2. Verify: scan BMP + PNG pixels, assert same set of unique RGB values
 *   3. Extract palette with coverage stats and OneLoom yarn-code lookup
 *   4. Upload PNG + original BMP to Supabase Storage
 *   5. Write data/designs/manifest.json for the seed script
 *
 * Usage:
 *   npm run process-designs
 */

import { config } from "dotenv";
config({ path: ".env" });
config({ path: ".env.local", override: true });

import fs from "fs";
import path from "path";
import { Jimp } from "jimp";
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { bmpToPng, extractPalette, applyOneLoomLookup, loadOneLoomLookup } from "../lib/design-processing";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require("ws");

function createDbClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const DESIGNS_BUCKET = process.env.SUPABASE_DESIGNS_BUCKET ?? "designs";

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  // ws required for Node.js < 22
  return createClient(url, serviceKey, { realtime: { transport: ws } });
}

const DESIGNS_DIR = path.join(process.cwd(), "data", "designs");
const OUTPUT_DIR = path.join(DESIGNS_DIR, "converted");

// ─── Local helper: scan a file's pixels for palette verification ──────────────

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function extractUsedColors(filePath: string): Promise<Set<string>> {
  const img = await Jimp.read(filePath);
  const usedColors = new Set<string>();
  img.scan(0, 0, img.width, img.height, (x, y, idx) => {
    usedColors.add(rgbToHex(img.bitmap.data[idx], img.bitmap.data[idx + 1], img.bitmap.data[idx + 2]));
  });
  return usedColors;
}

// ─── Palette verification ─────────────────────────────────────────────────────

function assertPalettesMatch(
  bmpColors: Set<string>,
  pngColors: Set<string>,
  fileName: string
): void {
  const onlyInBmp = [...bmpColors].filter((h) => !pngColors.has(h));
  const onlyInPng = [...pngColors].filter((h) => !bmpColors.has(h));

  if (onlyInBmp.length > 0 || onlyInPng.length > 0) {
    throw new Error(
      [
        `PALETTE MISMATCH — ${fileName}`,
        onlyInBmp.length > 0
          ? `  In BMP but not PNG: ${onlyInBmp.join(", ")}`
          : null,
        onlyInPng.length > 0
          ? `  In PNG but not BMP: ${onlyInPng.join(", ")}`
          : null,
        `  The conversion introduced or lost colors — aborting.`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

// ─── Bucket setup ─────────────────────────────────────────────────────────────

async function ensureBucketExists(bucketName: string): Promise<void> {
  const admin = createAdminClient();
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === bucketName);
  if (!exists) {
    const { error } = await admin.storage.createBucket(bucketName, { public: true });
    if (error) throw new Error(`Failed to create bucket "${bucketName}": ${error.message}`);
    console.log(`  Created Supabase Storage bucket: ${bucketName}`);
  }
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function uploadFile(
  filePath: string,
  storagePath: string,
  contentType: string
): Promise<string> {
  const admin = createAdminClient();
  const fileBuffer = fs.readFileSync(filePath);

  const { error } = await admin.storage
    .from(DESIGNS_BUCKET)
    .upload(storagePath, fileBuffer, { contentType, upsert: true });

  if (error) throw new Error(`Upload failed (${storagePath}): ${error.message}`);

  const { data } = admin.storage.from(DESIGNS_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function processDesigns(): Promise<void> {
  if (!fs.existsSync(DESIGNS_DIR)) {
    console.error(`data/designs/ not found at ${DESIGNS_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  await ensureBucketExists(DESIGNS_BUCKET);

  // Load OneLoom lookup from DB once for the whole batch
  const dbClient = createDbClient();
  const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar";
  const tenant = await dbClient.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true },
  });
  const lookup = tenant
    ? await loadOneLoomLookup(tenant.id)
    : new Map<string, { code: string; catalogHex: string | null }>();
  await dbClient.$disconnect();

  console.log(`Loaded ${lookup.size} OneLoom lookup entries from DB.`);

  const bmpFiles = fs
    .readdirSync(DESIGNS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".bmp"));

  if (bmpFiles.length === 0) {
    console.log("No BMP files found in data/designs/ — nothing to do.");
    return;
  }

  console.log(`Found ${bmpFiles.length} BMP file(s). Processing...\n`);

  const results = [];

  for (const bmpFile of bmpFiles) {
    const slug = path
      .basename(bmpFile, ".bmp")
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
    const pngFile = slug + ".png";
    const bmpPath = path.join(DESIGNS_DIR, bmpFile);
    const pngPath = path.join(OUTPUT_DIR, pngFile);

    console.log(`Processing: ${bmpFile}`);

    // 1. Convert BMP → PNG (sharp fast path; jimp fallback for indexed BMPs)
    const bmpBuffer = fs.readFileSync(bmpPath);
    const { png: pngBuffer, width, height } = await bmpToPng(bmpBuffer);
    fs.writeFileSync(pngPath, pngBuffer);
    console.log(`  Converted → ${pngFile} (${width}×${height})`);

    // 2. Verify palette consistency: BMP scan vs PNG scan
    console.log(`  Scanning pixels for palette verification...`);
    const [bmpColors, pngColors] = await Promise.all([
      extractUsedColors(bmpPath),
      extractUsedColors(pngPath),
    ]);
    console.log(`  BMP used colors: ${bmpColors.size}`);
    console.log(`  PNG used colors: ${pngColors.size}`);
    assertPalettesMatch(bmpColors, pngColors, bmpFile);
    console.log(`  ✓ Palette verified: ${bmpColors.size} colors match exactly`);

    // 3. Extract palette with coverage stats and apply OneLoom yarn-code lookup
    const rawPalette = await extractPalette(pngBuffer);
    const palette = applyOneLoomLookup(rawPalette, lookup).map(
      ({ index, hex, pixelCount, coverage, code }) => ({
        index,
        hex,
        pixelCount,
        percentage: coverage,
        ...(code !== null ? { matchedYarnCode: code } : {}),
      })
    );

    const matchCount = palette.filter((e) => e.matchedYarnCode).length;
    console.log(`  Palette (top 5 by coverage):`);
    palette.slice(0, 5).forEach((e) =>
      console.log(
        `    ${e.percentage.toFixed(1).padStart(5)}%  ${e.hex}` +
        (e.matchedYarnCode ? `  → ${e.matchedYarnCode}` : "")
      )
    );
    if (matchCount > 0) {
      console.log(`  Lookup: ${matchCount} of ${palette.length} palette color${palette.length !== 1 ? "s" : ""} matched`);
    }

    // 4. Upload to Supabase Storage
    console.log(`  Uploading to Supabase...`);
    const [imageUrl, sourceBmpUrl] = await Promise.all([
      uploadFile(pngPath, `${slug}/${pngFile}`, "image/png"),
      uploadFile(bmpPath, `${slug}/${bmpFile}`, "image/bmp"),
    ]);
    console.log(`  ✓ PNG: ${imageUrl}`);
    console.log(`  ✓ BMP: ${sourceBmpUrl}`);

    results.push({
      slug,
      name: slug
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      width,
      height,
      imageUrl,
      sourceBmpUrl,
      palette,
    });
    console.log();
  }

  // 5. Write manifest for seed script
  const manifestPath = path.join(DESIGNS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));
  console.log(`Wrote manifest → ${manifestPath}`);
  console.log(`\nRun \`npm run db:seed\` to insert designs into the database.`);
}

processDesigns().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
