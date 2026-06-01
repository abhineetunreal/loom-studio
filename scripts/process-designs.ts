#!/usr/bin/env tsx
/**
 * process-designs.ts
 *
 * Converts BMP design files → web-ready PNGs and uploads both to Supabase Storage.
 *
 * Pipeline per file:
 *   1. Parse the BMP color table directly from file bytes → authoritative palette
 *   2. Convert BMP → PNG using jimp (handles 8bpp indexed BMPs from CAD software)
 *   3. Verify: scan all pixels in both files, assert same set of unique RGB values
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ws = require("ws");

const DESIGNS_BUCKET = process.env.SUPABASE_DESIGNS_BUCKET ?? "designs";
const LOOKUP_PATH = path.join(process.cwd(), "data", "oneloom-rendered-lookup.json");

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  // ws required for Node.js < 22
  return createClient(url, serviceKey, { realtime: { transport: ws } });
}

const DESIGNS_DIR = path.join(process.cwd(), "data", "designs");
const OUTPUT_DIR = path.join(DESIGNS_DIR, "converted");

// ─── BMP header helpers ───────────────────────────────────────────────────────

type RgbColor = { r: number; g: number; b: number };

function readBmpBitDepth(buf: Buffer): number {
  // BMP file header: 14 bytes; DIB header starts at 14.
  // Bit depth is at DIB offset 14 (abs 28), 2 bytes LE.
  return buf.readUInt16LE(28);
}

// Reads the indexed color table from an 8bpp BMP header.
// Only valid for indexed (≤8bpp) BMPs — 24/32bpp have no color table.
function parseBmpColorTable(buf: Buffer): RgbColor[] {
  // Color table size: stored at DIB offset 32 (abs 46); 0 means use 2^bitDepth
  const colorTableSize = buf.readUInt32LE(46) || 256;

  // Color table starts at byte 54 (14-byte file header + 40-byte DIB header)
  // Each entry is 4 bytes: Blue, Green, Red, Reserved
  const colorTable: RgbColor[] = [];
  for (let i = 0; i < colorTableSize; i++) {
    const offset = 54 + i * 4;
    if (offset + 3 >= buf.length) break;
    colorTable.push({
      b: buf[offset],
      g: buf[offset + 1],
      r: buf[offset + 2],
    });
  }
  return colorTable;
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return (
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

// ─── Pixel palette extraction ─────────────────────────────────────────────────
// Scans every pixel of a jimp image and returns the set of unique hex colors.
// Used for both the source BMP and output PNG to verify they match.

async function extractUsedColors(filePath: string): Promise<Set<string>> {
  const img = await Jimp.read(filePath);
  const usedColors = new Set<string>();

  img.scan(0, 0, img.width, img.height, (x, y, idx) => {
    const r = img.bitmap.data[idx];
    const g = img.bitmap.data[idx + 1];
    const b = img.bitmap.data[idx + 2];
    usedColors.add(rgbToHex({ r, g, b }));
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

// ─── Conversion ───────────────────────────────────────────────────────────────

async function convertBmpToPng(
  bmpPath: string,
  pngPath: string
): Promise<{ width: number; height: number }> {
  const img = await Jimp.read(bmpPath);
  await img.write(pngPath as `${string}.png`);
  return { width: img.width, height: img.height };
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

// Load the rendered-color → OneLoom code lookup table.
// Only keys starting with "#" are treated as color entries; others are metadata.
function loadRenderedLookup(): Map<string, string> {
  if (!fs.existsSync(LOOKUP_PATH)) return new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(LOOKUP_PATH, "utf-8")) as Record<string, string>;
    const entries = Object.entries(raw)
      .filter(([k]) => /^#[0-9a-f]{6}$/i.test(k))
      .map(([k, v]): [string, string] => [k.toLowerCase(), v]);
    return new Map(entries);
  } catch {
    console.warn(`  ⚠ Could not parse ${LOOKUP_PATH} — skipping lookup.`);
    return new Map();
  }
}

async function processDesigns(): Promise<void> {
  if (!fs.existsSync(DESIGNS_DIR)) {
    console.error(`data/designs/ not found at ${DESIGNS_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Ensure the Supabase bucket exists before we start uploading
  await ensureBucketExists(DESIGNS_BUCKET);

  const bmpFiles = fs
    .readdirSync(DESIGNS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".bmp"));

  if (bmpFiles.length === 0) {
    console.log("No BMP files found in data/designs/ — nothing to do.");
    return;
  }

  console.log(`Found ${bmpFiles.length} BMP file(s). Processing...\n`);

  const renderedLookup = loadRenderedLookup();
  console.log(`Rendered-color lookup: ${renderedLookup.size} entr${renderedLookup.size === 1 ? "y" : "ies"} loaded.\n`);

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

    // 1. Read bit depth; parse indexed color table only for 8bpp BMPs
    const bmpBuffer = fs.readFileSync(bmpPath);
    const bitDepth = readBmpBitDepth(bmpBuffer);
    console.log(`  Bit depth: ${bitDepth}bpp`);

    if (bitDepth === 8) {
      const colorTable = parseBmpColorTable(bmpBuffer);
      console.log(`  BMP color table: ${colorTable.length} entries (includes unused slots)`);
    } else if (bitDepth === 24 || bitDepth === 32) {
      console.log(`  Direct-color BMP — palette derived from pixel scan`);
    } else {
      throw new Error(`Unsupported bit depth ${bitDepth}bpp in ${bmpFile}`);
    }

    // 2. Convert BMP → PNG
    const { width, height } = await convertBmpToPng(bmpPath, pngPath);
    console.log(`  Converted → ${pngFile} (${width}×${height})`);

    // 3. Extract actually-used pixel colors from both files
    console.log(`  Scanning pixels for palette verification...`);
    const [bmpColors, pngColors] = await Promise.all([
      extractUsedColors(bmpPath),
      extractUsedColors(pngPath),
    ]);
    console.log(`  BMP used colors: ${bmpColors.size}`);
    console.log(`  PNG used colors: ${pngColors.size}`);

    // 4. Hard fail if palettes don't match
    assertPalettesMatch(bmpColors, pngColors, bmpFile);
    console.log(`  ✓ Palette verified: ${bmpColors.size} colors match exactly`);

    // 5. Build PaletteEntry array (sorted by pixel coverage, descending)
    const totalPixels = width * height;
    // Count each color's pixel coverage from the BMP scan
    const img = await Jimp.read(bmpPath);
    const pixelCounts = new Map<string, number>();
    img.scan(0, 0, img.width, img.height, (x, y, idx) => {
      const hex = rgbToHex({
        r: img.bitmap.data[idx],
        g: img.bitmap.data[idx + 1],
        b: img.bitmap.data[idx + 2],
      });
      pixelCounts.set(hex, (pixelCounts.get(hex) ?? 0) + 1);
    });

    const palette = Array.from(pixelCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([hex, pixelCount], index) => {
        const matchedYarnCode = renderedLookup.get(hex);
        return {
          index,
          hex,
          pixelCount,
          percentage: Math.round((pixelCount / totalPixels) * 1000) / 10,
          ...(matchedYarnCode ? { matchedYarnCode } : {}),
        };
      });

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

    // 6. Upload to Supabase Storage
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

  // 7. Write manifest for seed script
  const manifestPath = path.join(DESIGNS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));
  console.log(`Wrote manifest → ${manifestPath}`);
  console.log(`\nRun \`npm run db:seed\` to insert designs into the database.`);
}

processDesigns().catch((err) => {
  console.error("\nFatal error:", err.message);
  process.exit(1);
});
