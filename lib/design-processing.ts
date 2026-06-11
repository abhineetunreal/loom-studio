// Shared BMP processing utilities used by both the process-designs CLI script
// and the /api/designs/process route handler.
//
// Server-side only (Node.js / Next.js server) — never import from client code.

import sharp from "sharp";
import { Jimp } from "jimp";

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Intermediate palette entry produced by extractPalette / applyOneLoomLookup.
 * Callers map this to the PaletteEntry DB/manifest type as needed.
 */
export type ProcessedPaletteEntry = {
  index: number;
  hex: string;       // "#rrggbb"
  r: number;
  g: number;
  b: number;
  pixelCount: number;
  coverage: number;  // pixelCount / totalPixels * 100, rounded to 1 decimal
  code: string | null;       // OneLoom yarn code, null if no match
  catalogHex: string | null; // catalog swatch hex from lookup, null if no match
};

// ─── bmpToPng ─────────────────────────────────────────────────────────────────

/**
 * Converts a BMP buffer to PNG.
 *
 * Fast path: sharp handles 24bpp direct-color BMPs efficiently.
 * Fallback: jimp handles palette-indexed (8bpp) BMPs that sharp rejects
 *           with "unsupported image format".
 */
export async function bmpToPng(
  bmpBuffer: Buffer
): Promise<{ png: Buffer; width: number; height: number }> {
  try {
    const { data: png, info } = await sharp(bmpBuffer)
      .png()
      .toBuffer({ resolveWithObject: true });
    return { png, width: info.width, height: info.height };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.toLowerCase().includes("unsupported image format")) throw err;
    // sharp rejected this format — fall through to jimp
  }

  // jimp correctly handles palette-indexed (≤8bpp) BMPs
  const img = await Jimp.read(bmpBuffer);
  const png = await img.getBuffer("image/png");
  return { png, width: img.width, height: img.height };
}

// ─── extractPalette ───────────────────────────────────────────────────────────

/**
 * Scans all pixels in a PNG buffer and returns the palette sorted by coverage
 * (most-used color first).
 *
 * Uses an integer-key accumulator to avoid hex-string allocation in the hot loop.
 */
export async function extractPalette(
  pngBuffer: Buffer
): Promise<ProcessedPaletteEntry[]> {
  const img = await Jimp.read(pngBuffer);
  const { data, width, height } = img.bitmap;
  const totalPixels = width * height;

  // Accumulate per-color pixel counts using packed int key: (R<<16)|(G<<8)|B
  const intCounts = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    intCounts.set(key, (intCounts.get(key) ?? 0) + 1);
  }

  return Array.from(intCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, pixelCount], index) => {
      const r = (key >> 16) & 0xff;
      const g = (key >> 8) & 0xff;
      const b = key & 0xff;
      return {
        index,
        hex: `#${key.toString(16).padStart(6, "0")}`,
        r,
        g,
        b,
        pixelCount,
        coverage: Math.round((pixelCount / totalPixels) * 1000) / 10,
        code: null,
        catalogHex: null,
      };
    });
}

// ─── ctfToPng ─────────────────────────────────────────────────────────────────

/**
 * Parses a CTF (Color Transfer Format) file and returns a PNG buffer.
 *
 * CTF binary layout:
 *   Offset  0–31  : 32-byte ASCII header (starts with "CTF Graphics File")
 *   Offset  32–33 : width  (uint16LE)
 *   Offset  34–35 : height (uint16LE)
 *   Offset  60–61 : numColors (uint16LE)
 *   Offset  62    : palette  — numColors × 4 bytes (R, G, B, 0xFF)
 *   Offset  62 + numColors*4 + 8 : RLE pixel data
 *                   pairs of (colorIndex uint8, runLength uint8)
 *
 * Row order: CTF row 0 = visual bottom → flip vertically for PNG.
 */
export async function ctfToPng(ctfBuffer: Buffer): Promise<{
  png: Buffer;
  width: number;
  height: number;
  palette: [number, number, number][];
}> {
  // Validate header
  if (ctfBuffer.length < 64) throw new Error("CTF buffer too small");
  const header = ctfBuffer.subarray(0, 32).toString("ascii");
  if (!header.startsWith("CTF Graphics File")) {
    throw new Error("Not a valid CTF file (missing header)");
  }

  const width = ctfBuffer.readUInt16LE(32);
  const height = ctfBuffer.readUInt16LE(34);
  const numColors = ctfBuffer.readUInt16LE(60);

  // Parse palette (R, G, B, 0xFF per entry)
  const paletteOffset = 62;
  const palette: [number, number, number][] = [];
  for (let i = 0; i < numColors; i++) {
    const o = paletteOffset + i * 4;
    palette.push([ctfBuffer[o], ctfBuffer[o + 1], ctfBuffer[o + 2]]);
  }

  // RLE pixel data
  const rleOffset = paletteOffset + numColors * 4 + 8;
  const totalPixels = width * height;

  // rows[0] = bottom row of the image (CTF order)
  // Each row is width*4 bytes of RGBA
  const rows: Buffer[] = Array.from({ length: height }, () =>
    Buffer.alloc(width * 4)
  );

  let pixelPos = 0;
  let rleIdx = rleOffset;

  while (pixelPos < totalPixels && rleIdx + 1 < ctfBuffer.length) {
    const colorIndex = ctfBuffer[rleIdx];
    const runLength = ctfBuffer[rleIdx + 1];
    rleIdx += 2;

    const [r, g, b] = palette[colorIndex] ?? [0, 0, 0];

    for (let n = 0; n < runLength && pixelPos < totalPixels; n++) {
      const row = Math.floor(pixelPos / width);
      const col = pixelPos % width;
      const o = col * 4;
      rows[row][o] = r;
      rows[row][o + 1] = g;
      rows[row][o + 2] = b;
      rows[row][o + 3] = 255;
      pixelPos++;
    }
  }

  // Build raw RGBA buffer, flipping vertically:
  // PNG row y = CTF row (height - 1 - y)
  const rawBuffer = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    rows[height - 1 - y].copy(rawBuffer, y * width * 4);
  }

  const png = await sharp(rawBuffer, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();

  return { png, width, height, palette };
}

// ─── applyOneLoomLookup ───────────────────────────────────────────────────────

export type LookupEntry = { code: string; catalogHex: string | null };

/**
 * Loads all ColorLookup rows for the given tenant into a Map keyed by
 * lowercase renderedHex. Call this once per request/batch, then pass the
 * result to applyOneLoomLookup — never query per-color.
 */
export async function loadOneLoomLookup(
  tenantId: string
): Promise<Map<string, LookupEntry>> {
  const { db } = await import("@/lib/db");
  const rows = await db.colorLookup.findMany({
    where: { tenantId },
    select: { renderedHex: true, yarnCode: true, catalogHex: true },
  });
  return new Map(
    rows.map((r) => [
      r.renderedHex.toLowerCase(),
      { code: r.yarnCode, catalogHex: r.catalogHex ?? null },
    ])
  );
}

/**
 * Matches each palette entry's hex against the pre-loaded OneLoom lookup Map.
 *
 * Returns a new palette array with code and catalogHex populated for matched
 * entries. Entries with no match keep code: null, catalogHex: null.
 */
export function applyOneLoomLookup(
  palette: ProcessedPaletteEntry[],
  lookup: Map<string, LookupEntry>
): ProcessedPaletteEntry[] {
  return palette.map((entry) => {
    const match = lookup.get(entry.hex.toLowerCase());
    if (!match) return entry;
    return { ...entry, code: match.code, catalogHex: match.catalogHex };
  });
}
