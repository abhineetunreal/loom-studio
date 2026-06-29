// Generates indexed-color BMP, CTF, and yarn-sheet files from a saved colorway.
// Server-side only — never import from client code.

import { Jimp } from "jimp";
import { createAdminClient } from "@/lib/supabase";
import { db } from "@/lib/db";

// ─── Types ───────────────────────────────────────────────────────────────────

type ColorwayOperations = {
  globalMap: Record<string, { hex: string; yarnCode: string; yarnId: string }>;
  regionFills?: Array<{
    seedX: number;
    seedY: number;
    originalColor: string;
    newHex: string;
    newYarnCode: string;
    newYarnId: string;
  }>;
};

type PaletteEntry = {
  index: number;
  hex: string;
  pixelCount: number;
  percentage: number;
  matchedYarnCode?: string;
};

type ExportResult = {
  bmpUrl: string;
  ctfUrl: string;
  yarnSheetUrl: string;
};

// ─── Public API ──────────────────────────────────────────────────────────────

const SAVED_COLORWAYS_BUCKET =
  process.env.SUPABASE_SAVED_COLORWAYS_BUCKET ?? "saved-colorways";

/**
 * Generates BMP, CTF, and yarn-sheet files for a saved colorway, uploads
 * them to Supabase Storage, and updates the SavedColorway record with URLs.
 *
 * Designed to be called fire-and-forget after the save response returns.
 */
export async function generateColorwayExport(params: {
  colorwayId: string;
  colorwayName: string;
  designId: string;
  tenantId: string;
  userId: string;
  operations: ColorwayOperations;
}): Promise<ExportResult> {
  const { colorwayId, colorwayName, designId, tenantId, userId, operations } =
    params;

  // 1. Load the design's source image and palette
  const design = await db.design.findUnique({
    where: { id: designId },
    select: {
      imageUrl: true,
      sourceBmpUrl: true,
      uploadedById: true,
      width: true,
      height: true,
      palette: true,
    },
  });
  if (!design) throw new Error(`Design ${designId} not found`);

  const palette = design.palette as PaletteEntry[];
  const { width, height } = design;

  // Fetch the PNG image (imageUrl) to get RGBA pixel data
  const imageUrl = design.imageUrl;
  const imgResponse = await fetch(imageUrl);
  if (!imgResponse.ok) throw new Error(`Failed to fetch design image: ${imgResponse.status}`);
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());

  const img = await Jimp.read(imgBuffer);
  const { data: pixels } = img.bitmap;

  // 2. Build the recolored palette mapping
  //    originalHex → { newR, newG, newB, yarnCode, yarnName }
  const globalMap = operations.globalMap ?? {};

  // Build a map from original palette hex → palette index
  const hexToOriginalIndex = new Map<string, number>();
  for (const entry of palette) {
    hexToOriginalIndex.set(entry.hex.toLowerCase(), entry.index);
  }

  // Build the recolored palette: for each original color, determine the new color
  type RecoloredPaletteEntry = {
    index: number;
    originalHex: string;
    r: number;
    g: number;
    b: number;
    yarnCode: string;
  };

  const recoloredPalette: RecoloredPaletteEntry[] = [];
  const originalHexToNewEntry = new Map<string, RecoloredPaletteEntry>();

  for (const entry of palette) {
    const hexLower = entry.hex.toLowerCase();
    const mapping = globalMap[entry.hex] ?? globalMap[hexLower];

    let r: number, g: number, b: number;
    let yarnCode: string;

    if (mapping) {
      // This palette color was remapped to a yarn
      const parsed = parseHex(mapping.hex);
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
      yarnCode = mapping.yarnCode;
    } else {
      // Keep the original color
      const parsed = parseHex(entry.hex);
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
      yarnCode = entry.matchedYarnCode ?? "original";
    }

    const recolored: RecoloredPaletteEntry = {
      index: entry.index,
      originalHex: entry.hex,
      r,
      g,
      b,
      yarnCode,
    };
    recoloredPalette.push(recolored);
    originalHexToNewEntry.set(hexLower, recolored);
  }

  // 3. Build indexed pixel data by mapping each pixel's original color to a palette index
  //    Build a lookup from packed RGB → recolored palette index
  const rgbToOriginalEntry = new Map<number, RecoloredPaletteEntry>();
  for (const entry of palette) {
    const { r, g, b } = parseHex(entry.hex);
    const key = (r << 16) | (g << 8) | b;
    const recolored = originalHexToNewEntry.get(entry.hex.toLowerCase());
    if (recolored) rgbToOriginalEntry.set(key, recolored);
  }

  // Deduplicate the recolored palette (multiple original colors may map to the same yarn color)
  // For BMP/CTF we need unique colors in the palette table
  const uniqueColors = new Map<number, { index: number; r: number; g: number; b: number; yarnCode: string }>();
  const entryToUniqueIndex = new Map<RecoloredPaletteEntry, number>();

  for (const entry of recoloredPalette) {
    const key = (entry.r << 16) | (entry.g << 8) | entry.b;
    if (!uniqueColors.has(key)) {
      const idx = uniqueColors.size;
      uniqueColors.set(key, { index: idx, r: entry.r, g: entry.g, b: entry.b, yarnCode: entry.yarnCode });
    }
    entryToUniqueIndex.set(entry, uniqueColors.get(key)!.index);
  }

  const finalPalette = Array.from(uniqueColors.values()).sort((a, b) => a.index - b.index);
  if (finalPalette.length > 256) {
    throw new Error(`Recolored palette has ${finalPalette.length} colors (max 256 for indexed BMP)`);
  }

  // Build the pixel-to-unique-index fast lookup
  const rgbToFinalIndex = new Map<number, number>();
  for (const entry of recoloredPalette) {
    const origRgb = parseHex(entry.originalHex);
    const origKey = (origRgb.r << 16) | (origRgb.g << 8) | origRgb.b;
    rgbToFinalIndex.set(origKey, entryToUniqueIndex.get(entry)!);
  }

  // Map every pixel to its palette index
  const indexedPixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const r = pixels[off];
    const g = pixels[off + 1];
    const b = pixels[off + 2];
    const key = (r << 16) | (g << 8) | b;
    indexedPixels[i] = rgbToFinalIndex.get(key) ?? 0;
  }

  // 4. Generate files
  const safeName = sanitizeFilename(colorwayName);

  const bmpBuffer = buildIndexedBmp(width, height, finalPalette, indexedPixels);
  const ctfBuffer = buildCtf(width, height, finalPalette, indexedPixels);
  const yarnSheet = buildYarnSheet(colorwayName, finalPalette);

  // 5. Upload to Supabase Storage
  const basePath = `${tenantId}/${userId}/${colorwayId}`;
  const admin = createAdminClient();

  const uploads = await Promise.all([
    uploadFile(admin, basePath, `${safeName}.bmp`, bmpBuffer, "image/bmp"),
    uploadFile(admin, basePath, `${safeName}.ctf`, ctfBuffer, "application/octet-stream"),
    uploadFile(admin, basePath, `${safeName}_yarns.txt`, Buffer.from(yarnSheet, "utf-8"), "text/plain"),
  ]);

  const [bmpUrl, ctfUrl, yarnSheetUrl] = uploads;

  // 6. Update the SavedColorway record
  await db.savedColorway.update({
    where: { id: colorwayId },
    data: { bmpUrl, ctfUrl, yarnSheetUrl },
  });

  console.log(`[ColorwayExport] SUCCESS colorwayId=${colorwayId} files=${basePath}`);
  return { bmpUrl, ctfUrl, yarnSheetUrl };
}

// ─── BMP Generation ──────────────────────────────────────────────────────────

/**
 * Builds an 8-bit indexed BMP (BITMAPINFOHEADER).
 *
 * BMP layout:
 *   14 bytes: BITMAPFILEHEADER
 *   40 bytes: BITMAPINFOHEADER
 *   paletteSize * 4 bytes: color table (B, G, R, 0x00 per entry)
 *   pixel data: rows bottom-to-top, each row padded to 4-byte boundary
 */
function buildIndexedBmp(
  width: number,
  height: number,
  palette: Array<{ r: number; g: number; b: number }>,
  indexedPixels: Uint8Array
): Buffer {
  const paletteSize = 256; // Always write 256 entries for compatibility
  const rowStride = Math.ceil(width / 4) * 4; // Row padded to 4-byte boundary
  const pixelDataSize = rowStride * height;
  const headerSize = 14;
  const dibSize = 40;
  const paletteBytes = paletteSize * 4;
  const dataOffset = headerSize + dibSize + paletteBytes;
  const fileSize = dataOffset + pixelDataSize;

  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER (14 bytes)
  buf.write("BM", 0, "ascii"); // Signature
  buf.writeUInt32LE(fileSize, 2); // File size
  buf.writeUInt32LE(0, 6); // Reserved
  buf.writeUInt32LE(dataOffset, 10); // Pixel data offset

  // BITMAPINFOHEADER (40 bytes)
  buf.writeUInt32LE(dibSize, 14); // DIB header size
  buf.writeInt32LE(width, 18); // Width
  buf.writeInt32LE(height, 22); // Height (positive = bottom-up)
  buf.writeUInt16LE(1, 26); // Color planes
  buf.writeUInt16LE(8, 28); // Bits per pixel
  buf.writeUInt32LE(0, 30); // Compression (BI_RGB = none)
  buf.writeUInt32LE(pixelDataSize, 34); // Image size
  buf.writeInt32LE(2835, 38); // Horizontal resolution (72 DPI)
  buf.writeInt32LE(2835, 42); // Vertical resolution (72 DPI)
  buf.writeUInt32LE(palette.length, 46); // Colors used
  buf.writeUInt32LE(palette.length, 50); // Important colors

  // Color table (B, G, R, 0x00 per entry)
  for (let i = 0; i < paletteSize; i++) {
    const off = headerSize + dibSize + i * 4;
    if (i < palette.length) {
      buf[off] = palette[i].b;
      buf[off + 1] = palette[i].g;
      buf[off + 2] = palette[i].r;
      buf[off + 3] = 0;
    }
    // Remaining entries stay zero-filled
  }

  // Pixel data (bottom-up row order)
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width; // BMP is bottom-up
    const dstRow = dataOffset + y * rowStride;
    for (let x = 0; x < width; x++) {
      buf[dstRow + x] = indexedPixels[srcRow + x];
    }
    // Padding bytes remain zero-filled
  }

  return buf;
}

// ─── CTF Generation ──────────────────────────────────────────────────────────

/**
 * Builds a CTF file matching the format decoded by ctfToPng:
 *
 *   Offset  0–31  : 32-byte ASCII header "CTF Graphics File Version 01.001"
 *   Offset  32–33 : width  (uint16LE)
 *   Offset  34–35 : height (uint16LE)
 *   Offset  36–59 : reserved (zeroes)
 *   Offset  60–61 : numColors (uint16LE)
 *   Offset  62    : palette — numColors × 4 bytes (R, G, B, 0xFF)
 *   +8 bytes padding after palette
 *   RLE pixel data: pairs of (colorIndex, runLength)
 *
 * Row order: CTF row 0 = visual bottom (same as BMP).
 */
function buildCtf(
  width: number,
  height: number,
  palette: Array<{ r: number; g: number; b: number }>,
  indexedPixels: Uint8Array
): Buffer {
  const numColors = palette.length;
  const headerSize = 62; // Fixed header up to palette start
  const paletteBytes = numColors * 4;
  const paddingAfterPalette = 8;
  const rleOffset = headerSize + paletteBytes + paddingAfterPalette;

  // First pass: generate RLE data
  // Pixel order: row 0 = bottom of image (flip from top-down indexedPixels)
  const rleChunks: number[] = [];
  for (let ctfRow = 0; ctfRow < height; ctfRow++) {
    const pngRow = height - 1 - ctfRow; // Flip: CTF row 0 = bottom = PNG row (height-1)
    const rowStart = pngRow * width;

    let x = 0;
    while (x < width) {
      const colorIndex = indexedPixels[rowStart + x];
      let runLength = 1;
      while (
        runLength < 255 &&
        x + runLength < width &&
        indexedPixels[rowStart + x + runLength] === colorIndex
      ) {
        runLength++;
      }
      rleChunks.push(colorIndex, runLength);
      x += runLength;
    }
  }

  const totalSize = rleOffset + rleChunks.length;
  const buf = Buffer.alloc(totalSize);

  // Header
  const headerStr = "CTF Graphics File Version 01.001";
  buf.write(headerStr, 0, 32, "ascii");
  buf.writeUInt16LE(width, 32);
  buf.writeUInt16LE(height, 34);
  // Bytes 36–59 are reserved/zeroes
  buf.writeUInt16LE(numColors, 60);

  // Palette (R, G, B, 0xFF per entry)
  for (let i = 0; i < numColors; i++) {
    const off = 62 + i * 4;
    buf[off] = palette[i].r;
    buf[off + 1] = palette[i].g;
    buf[off + 2] = palette[i].b;
    buf[off + 3] = 0xff;
  }

  // 8-byte padding after palette (zeroes, already alloc'd)

  // RLE pixel data
  for (let i = 0; i < rleChunks.length; i++) {
    buf[rleOffset + i] = rleChunks[i];
  }

  return buf;
}

// ─── Yarn Sheet ──────────────────────────────────────────────────────────────

function buildYarnSheet(
  colorwayName: string,
  palette: Array<{ index: number; r: number; g: number; b: number; yarnCode: string }>
): string {
  const lines: string[] = [];
  lines.push(`Colorway: ${colorwayName}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Index\tYarn Code\tHex");
  lines.push("─────\t─────────\t───────");
  for (const entry of palette) {
    const hex = `#${((entry.r << 16) | (entry.g << 8) | entry.b).toString(16).padStart(6, "0")}`;
    lines.push(`${entry.index}\t${entry.yarnCode}\t${hex}`);
  }
  return lines.join("\n") + "\n";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_\-. ]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 80)
    || "colorway";
}

async function uploadFile(
  admin: ReturnType<typeof createAdminClient>,
  basePath: string,
  filename: string,
  data: Buffer,
  contentType: string
): Promise<string> {
  const storagePath = `${basePath}/${filename}`;
  const { error } = await admin.storage
    .from(SAVED_COLORWAYS_BUCKET)
    .upload(storagePath, data, { contentType, upsert: true });

  if (error) throw new Error(`Upload failed for ${storagePath}: ${error.message}`);

  const { data: urlData } = admin.storage
    .from(SAVED_COLORWAYS_BUCKET)
    .getPublicUrl(storagePath);
  return urlData.publicUrl;
}
