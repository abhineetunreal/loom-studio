// Generates indexed-color BMP, PDF spec sheet, and yarn-sheet files from a saved colorway.
// Server-side only — never import from client code.

import { Jimp } from "jimp";
import PDFDocument from "pdfkit";
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
  yarnSheetUrl: string;
  pdfUrl: string;
};

// ─── Public API ──────────────────────────────────────────────────────────────

const SAVED_COLORWAYS_BUCKET =
  process.env.SUPABASE_SAVED_COLORWAYS_BUCKET ?? "saved-colorways";

/**
 * Generates BMP, PDF spec sheet, and yarn-sheet files for a saved colorway,
 * uploads them to Supabase Storage, and updates the SavedColorway record with URLs.
 *
 * Designed to be called fire-and-forget after the save response returns.
 */
export async function generateColorwayExport(params: {
  colorwayId: string;
  colorwayName: string;
  designId: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  folderId?: string | null;
  operations: ColorwayOperations;
}): Promise<ExportResult> {
  const {
    colorwayId,
    colorwayName,
    designId,
    tenantId,
    userId,
    userEmail,
    folderId,
    operations,
  } = params;

  // 1. Load the design, tenant, and snapshot data
  const [design, tenant, colorwayRecord, folder] = await Promise.all([
    db.design.findUnique({
      where: { id: designId },
      select: {
        name: true,
        imageUrl: true,
        sourceBmpUrl: true,
        uploadedById: true,
        width: true,
        height: true,
        palette: true,
      },
    }),
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, displayName: true, logoUrl: true },
    }),
    db.savedColorway.findUnique({
      where: { id: colorwayId },
      select: { snapshotUrl: true, createdAt: true },
    }),
    folderId
      ? db.colorwayFolder.findUnique({
          where: { id: folderId },
          select: { name: true },
        })
      : null,
  ]);

  if (!design) throw new Error(`Design ${designId} not found`);
  if (!tenant) throw new Error(`Tenant ${tenantId} not found`);

  const palette = design.palette as PaletteEntry[];
  const { width, height } = design;

  // Fetch the PNG image to get RGBA pixel data
  console.log(`[ColorwayExport] Fetching design image for colorwayId=${colorwayId} url=${design.imageUrl.substring(0, 80)}`);
  const imgResponse = await fetch(design.imageUrl);
  if (!imgResponse.ok)
    throw new Error(`Failed to fetch design image: ${imgResponse.status} ${imgResponse.statusText}`);
  const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
  console.log(`[ColorwayExport] Image fetched, ${imgBuffer.length} bytes`);

  const img = await Jimp.read(imgBuffer);
  const { data: pixels } = img.bitmap;

  // 2. Build the recolored palette mapping
  const globalMap = operations.globalMap ?? {};

  type RecoloredPaletteEntry = {
    index: number;
    originalHex: string;
    r: number;
    g: number;
    b: number;
    yarnCode: string;
    percentage: number;
  };

  const recoloredPalette: RecoloredPaletteEntry[] = [];
  const originalHexToNewEntry = new Map<string, RecoloredPaletteEntry>();

  for (const entry of palette) {
    const hexLower = entry.hex.toLowerCase();
    const mapping = globalMap[entry.hex] ?? globalMap[hexLower];

    let r: number, g: number, b: number;
    let yarnCode: string;

    if (mapping) {
      const parsed = parseHex(mapping.hex);
      r = parsed.r;
      g = parsed.g;
      b = parsed.b;
      yarnCode = mapping.yarnCode;
    } else {
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
      percentage: entry.percentage,
    };
    recoloredPalette.push(recolored);
    originalHexToNewEntry.set(hexLower, recolored);
  }

  // 3. Deduplicate palette & build indexed pixel data
  const uniqueColors = new Map<
    number,
    {
      index: number;
      r: number;
      g: number;
      b: number;
      yarnCode: string;
      percentage: number;
    }
  >();
  const entryToUniqueIndex = new Map<RecoloredPaletteEntry, number>();

  for (const entry of recoloredPalette) {
    const key = (entry.r << 16) | (entry.g << 8) | entry.b;
    if (!uniqueColors.has(key)) {
      const idx = uniqueColors.size;
      uniqueColors.set(key, {
        index: idx,
        r: entry.r,
        g: entry.g,
        b: entry.b,
        yarnCode: entry.yarnCode,
        percentage: entry.percentage,
      });
    } else {
      // Merge percentage for duplicate colors
      const existing = uniqueColors.get(key)!;
      existing.percentage += entry.percentage;
    }
    entryToUniqueIndex.set(entry, uniqueColors.get(key)!.index);
  }

  const finalPalette = Array.from(uniqueColors.values()).sort(
    (a, b) => a.index - b.index
  );
  if (finalPalette.length > 256) {
    throw new Error(
      `Recolored palette has ${finalPalette.length} colors (max 256 for indexed BMP)`
    );
  }

  // Build pixel-to-index lookup
  const rgbToFinalIndex = new Map<number, number>();
  for (const entry of recoloredPalette) {
    const origRgb = parseHex(entry.originalHex);
    const origKey = (origRgb.r << 16) | (origRgb.g << 8) | origRgb.b;
    rgbToFinalIndex.set(origKey, entryToUniqueIndex.get(entry)!);
  }

  const indexedPixels = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const key = (pixels[off] << 16) | (pixels[off + 1] << 8) | pixels[off + 2];
    indexedPixels[i] = rgbToFinalIndex.get(key) ?? 0;
  }

  // 4. Generate and upload files independently — each in its own try/catch
  //    so one failing doesn't block the others.
  const safeName = sanitizeFilename(colorwayName);
  const basePath = `${tenantId}/${userId}/${colorwayId}`;
  const admin = createAdminClient();
  const updateData: { bmpUrl?: string; yarnSheetUrl?: string; pdfUrl?: string } = {};

  // ── BMP ──
  try {
    console.log(`[ColorwayExport] Generating BMP for colorwayId=${colorwayId}`);
    const bmpBuffer = buildIndexedBmp(width, height, finalPalette, indexedPixels);
    const bmpUrl = await uploadFile(admin, basePath, `${safeName}.bmp`, bmpBuffer, "image/bmp");
    updateData.bmpUrl = bmpUrl;
    console.log(`[ColorwayExport] BMP uploaded colorwayId=${colorwayId}`);
  } catch (err) {
    console.error(`[ColorwayExport] BMP FAILED colorwayId=${colorwayId}`, err instanceof Error ? err.stack : err);
  }

  // ── Yarn sheet ──
  try {
    console.log(`[ColorwayExport] Generating yarn sheet for colorwayId=${colorwayId}`);
    const yarnSheet = buildYarnSheet(colorwayName, finalPalette);
    const yarnSheetUrl = await uploadFile(admin, basePath, `${safeName}_yarns.txt`, Buffer.from(yarnSheet, "utf-8"), "text/plain");
    updateData.yarnSheetUrl = yarnSheetUrl;
    console.log(`[ColorwayExport] Yarn sheet uploaded colorwayId=${colorwayId}`);
  } catch (err) {
    console.error(`[ColorwayExport] Yarn sheet FAILED colorwayId=${colorwayId}`, err instanceof Error ? err.stack : err);
  }

  // ── PDF spec sheet ──
  try {
    console.log(`[ColorwayExport] Generating PDF for colorwayId=${colorwayId}`);

    // Fetch snapshot for preview
    let snapshotBuffer: Buffer | null = null;
    if (colorwayRecord?.snapshotUrl) {
      try {
        const snapRes = await fetch(colorwayRecord.snapshotUrl);
        if (snapRes.ok) snapshotBuffer = Buffer.from(await snapRes.arrayBuffer());
      } catch (snapErr) {
        console.error(`[ColorwayExport] Snapshot fetch failed for PDF colorwayId=${colorwayId}`, snapErr);
      }
    }

    // Look up yarn names
    const yarnCodes = finalPalette.map((p) => p.yarnCode).filter((c) => c !== "original");
    const yarnRows = yarnCodes.length > 0
      ? await db.yarnColor.findMany({
          where: { code: { in: yarnCodes }, tenantId },
          select: { code: true, name: true },
        })
      : [];
    const yarnNameByCode = new Map(yarnRows.map((y) => [y.code, y.name]));

    const pdfBuffer = await buildPdfSpecSheet({
      tenantName: tenant.displayName ?? tenant.name,
      logoUrl: tenant.logoUrl,
      designName: design.name,
      designWidth: width,
      designHeight: height,
      colorwayName,
      folderName: folder?.name ?? null,
      userEmail,
      createdAt: colorwayRecord?.createdAt ?? new Date(),
      previewImage: snapshotBuffer ?? imgBuffer,
      palette: finalPalette,
      yarnNameByCode,
    });
    const pdfUrl = await uploadFile(admin, basePath, `${safeName}_spec.pdf`, pdfBuffer, "application/pdf");
    updateData.pdfUrl = pdfUrl;
    console.log(`[ColorwayExport] PDF uploaded colorwayId=${colorwayId}`);
  } catch (err) {
    console.error(`[ColorwayExport] PDF FAILED colorwayId=${colorwayId}`, err instanceof Error ? err.stack : err);
  }

  // 5. Update the SavedColorway record with whatever succeeded
  if (Object.keys(updateData).length > 0) {
    try {
      await db.savedColorway.update({
        where: { id: colorwayId },
        data: updateData,
      });
      console.log(`[ColorwayExport] DB updated colorwayId=${colorwayId} fields=${Object.keys(updateData).join(",")}`);
    } catch (err) {
      console.error(`[ColorwayExport] DB update FAILED colorwayId=${colorwayId}`, err instanceof Error ? err.stack : err);
    }
  }

  return {
    bmpUrl: updateData.bmpUrl ?? "",
    yarnSheetUrl: updateData.yarnSheetUrl ?? "",
    pdfUrl: updateData.pdfUrl ?? "",
  };
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
  const paletteSize = 256;
  const rowStride = Math.ceil(width / 4) * 4;
  const pixelDataSize = rowStride * height;
  const headerSize = 14;
  const dibSize = 40;
  const paletteBytes = paletteSize * 4;
  const dataOffset = headerSize + dibSize + paletteBytes;
  const fileSize = dataOffset + pixelDataSize;

  const buf = Buffer.alloc(fileSize);

  // BITMAPFILEHEADER
  buf.write("BM", 0, "ascii");
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(0, 6);
  buf.writeUInt32LE(dataOffset, 10);

  // BITMAPINFOHEADER
  buf.writeUInt32LE(dibSize, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(8, 28);
  buf.writeUInt32LE(0, 30);
  buf.writeUInt32LE(pixelDataSize, 34);
  buf.writeInt32LE(2835, 38);
  buf.writeInt32LE(2835, 42);
  buf.writeUInt32LE(palette.length, 46);
  buf.writeUInt32LE(palette.length, 50);

  // Color table (B, G, R, 0x00)
  for (let i = 0; i < paletteSize; i++) {
    const off = headerSize + dibSize + i * 4;
    if (i < palette.length) {
      buf[off] = palette[i].b;
      buf[off + 1] = palette[i].g;
      buf[off + 2] = palette[i].r;
      buf[off + 3] = 0;
    }
  }

  // Pixel data (bottom-up row order)
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width;
    const dstRow = dataOffset + y * rowStride;
    for (let x = 0; x < width; x++) {
      buf[dstRow + x] = indexedPixels[srcRow + x];
    }
  }

  return buf;
}

// ─── PDF Spec Sheet ──────────────────────────────────────────────────────────

async function buildPdfSpecSheet(params: {
  tenantName: string;
  logoUrl: string | null;
  designName: string;
  designWidth: number;
  designHeight: number;
  colorwayName: string;
  folderName: string | null;
  userEmail: string;
  createdAt: Date;
  previewImage: Buffer;
  palette: Array<{
    index: number;
    r: number;
    g: number;
    b: number;
    yarnCode: string;
    percentage: number;
  }>;
  yarnNameByCode: Map<string, string>;
}): Promise<Buffer> {
  const {
    tenantName,
    logoUrl,
    designName,
    designWidth,
    designHeight,
    colorwayName,
    folderName,
    userEmail,
    createdAt,
    previewImage,
    palette,
    yarnNameByCode,
  } = params;

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks)))
  );

  const pageWidth = doc.page.width - 80; // 40px margins on each side

  // ── Header: brand name + optional logo ──
  let headerY = 40;

  if (logoUrl) {
    try {
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const logoBuf = Buffer.from(await logoRes.arrayBuffer());
        doc.image(logoBuf, 40, headerY, { height: 30 });
        headerY += 35;
      }
    } catch {
      // Logo fetch failed — fall through to text header
    }
  }

  doc
    .fontSize(18)
    .font("Helvetica-Bold")
    .fillColor("#1a1612")
    .text(tenantName, 40, headerY, { width: pageWidth });
  headerY = doc.y + 4;

  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#888888")
    .text("Production Spec Sheet", 40, headerY, { width: pageWidth });
  headerY = doc.y + 12;

  // ── Divider ──
  doc
    .moveTo(40, headerY)
    .lineTo(40 + pageWidth, headerY)
    .strokeColor("#e0e0e0")
    .lineWidth(0.5)
    .stroke();
  headerY += 12;

  // ── Preview image ──
  const maxImgWidth = pageWidth;
  const maxImgHeight = 220;
  const imgAspect = designWidth / designHeight;
  let imgW = maxImgWidth;
  let imgH = imgW / imgAspect;
  if (imgH > maxImgHeight) {
    imgH = maxImgHeight;
    imgW = imgH * imgAspect;
  }
  const imgX = 40 + (pageWidth - imgW) / 2;

  try {
    doc.image(previewImage, imgX, headerY, { width: imgW, height: imgH });
  } catch {
    // Image rendering failed — skip
  }
  headerY += imgH + 14;

  // ── Metadata block ──
  const dateStr = createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const metaLines: [string, string][] = [
    ["Design", designName],
    [
      "Size",
      `${designWidth} x ${designHeight} px`,
    ],
    ["Colorway", colorwayName],
  ];
  if (folderName) metaLines.push(["Folder", folderName]);
  metaLines.push(["Created by", userEmail]);
  metaLines.push(["Date", dateStr]);

  const labelCol = 80;
  for (const [label, value] of metaLines) {
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#555555")
      .text(label, 40, headerY, { width: labelCol, continued: false });
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#1a1612")
      .text(value, 40 + labelCol, headerY, { width: pageWidth - labelCol });
    headerY = Math.max(doc.y, headerY + 13);
  }

  headerY += 6;

  // ── Divider ──
  doc
    .moveTo(40, headerY)
    .lineTo(40 + pageWidth, headerY)
    .strokeColor("#e0e0e0")
    .lineWidth(0.5)
    .stroke();
  headerY += 10;

  // ── Yarn Color Table ──
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor("#1a1612")
    .text("Yarn Colors", 40, headerY);
  headerY = doc.y + 8;

  // Table header
  const colSwatch = 40;
  const colCode = 75;
  const colName = 170;
  const colPct = 40 + pageWidth - 50;
  const rowHeight = 20;

  doc
    .fontSize(8)
    .font("Helvetica-Bold")
    .fillColor("#888888");
  doc.text("Swatch", colSwatch, headerY, { width: 35 });
  doc.text("Code", colCode, headerY, { width: 90 });
  doc.text("Yarn Name", colName, headerY, { width: 200 });
  doc.text("%", colPct, headerY, { width: 45, align: "right" });
  headerY += 14;

  // Sort palette by percentage descending
  const sortedPalette = [...palette].sort(
    (a, b) => b.percentage - a.percentage
  );

  for (const entry of sortedPalette) {
    // Check if we need a new page
    if (headerY + rowHeight > doc.page.height - 40) {
      doc.addPage();
      headerY = 40;
    }

    const hex = `#${((entry.r << 16) | (entry.g << 8) | entry.b).toString(16).padStart(6, "0")}`;
    const yarnName = yarnNameByCode.get(entry.yarnCode) ?? "";

    // Color swatch rectangle
    doc.rect(colSwatch, headerY + 2, 14, 14).fill(hex);
    doc
      .rect(colSwatch, headerY + 2, 14, 14)
      .strokeColor("#cccccc")
      .lineWidth(0.5)
      .stroke();

    // Yarn code
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#1a1612")
      .text(entry.yarnCode, colCode, headerY + 4, { width: 90 });

    // Yarn name
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555555")
      .text(yarnName, colName, headerY + 4, { width: colPct - colName - 10 });

    // Percentage
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#888888")
      .text(`${entry.percentage.toFixed(1)}%`, colPct, headerY + 4, {
        width: 45,
        align: "right",
      });

    headerY += rowHeight;
  }

  // ── Footer ──
  const footerY = doc.page.height - 30;
  doc
    .fontSize(7)
    .font("Helvetica")
    .fillColor("#aaaaaa")
    .text(
      `Generated by Loom Studio on ${new Date().toISOString().split("T")[0]}`,
      40,
      footerY,
      { width: pageWidth, align: "center" }
    );

  doc.end();
  return finished;
}

// ─── Yarn Sheet ──────────────────────────────────────────────────────────────

function buildYarnSheet(
  colorwayName: string,
  palette: Array<{
    index: number;
    r: number;
    g: number;
    b: number;
    yarnCode: string;
  }>
): string {
  const lines: string[] = [];
  lines.push(`Colorway: ${colorwayName}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Index\tYarn Code\tHex");
  lines.push("-----\t---------\t-------");
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
  return (
    name
      .replace(/[^a-zA-Z0-9_\-. ]/g, "")
      .replace(/\s+/g, "_")
      .substring(0, 80) || "colorway"
  );
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

  if (error)
    throw new Error(`Upload failed for ${storagePath}: ${error.message}`);

  const { data: urlData } = admin.storage
    .from(SAVED_COLORWAYS_BUCKET)
    .getPublicUrl(storagePath);
  return urlData.publicUrl;
}
