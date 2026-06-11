// Admin-only: process a BMP that was uploaded to the public designs bucket,
// convert it to PNG, extract its palette, match OneLoom codes, and create
// a Design database row (isActive: true, uploadedById: null).
//
// POST /api/admin/designs/process
// Body: { storagePath: string; filename: string; collectionId?: string }
// Returns: { design }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET, getPublicUrl } from "@/lib/supabase";
import { bmpToPng, ctfToPng, extractPalette, applyOneLoomLookup } from "@/lib/design-processing";
import type { PaletteEntry } from "@/types";

// Derive a slug from a filename: strip extension, lowercase, spaces → hyphens.
function filenameToSlug(filename: string): string {
  return filename
    .replace(/\.(bmp|ctf)$/i, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

// Derive a display name from a filename: strip extension, collapse separators.
function filenameToName(filename: string): string {
  return (
    filename
      .replace(/\.(bmp|ctf)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Untitled"
  );
}

// Find a slug that isn't already taken. If {base} is free use it; otherwise
// try {base}-2, {base}-3, … until a free one is found.
async function uniqueSlug(base: string): Promise<string> {
  const existing = await db.design.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const taken = new Set(existing.map((d) => d.slug));

  if (!taken.has(base)) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function POST(request: NextRequest) {
  // ── Admin guard ────────────────────────────────────────────────────────────
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: { storagePath?: string; filename?: string; collectionId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { storagePath, filename, collectionId } = body;
  if (!storagePath || !filename) {
    return NextResponse.json(
      { error: "storagePath and filename are required" },
      { status: 400 }
    );
  }

  // ── Tenant ─────────────────────────────────────────────────────────────────
  const tenant = await db.tenant.findUnique({
    where: { slug: process.env.DEFAULT_TENANT_SLUG ?? "carpetsbazaar" },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  // ── Dedup: return existing design if same filename already processed ─────────
  const designName = filenameToName(filename);
  const existingDesign = await db.design.findFirst({
    where: { tenantId: tenant.id, name: designName },
    select: {
      id: true,
      name: true,
      slug: true,
      imageUrl: true,
      sourceBmpUrl: true,
      width: true,
      height: true,
      isActive: true,
      isDemo: true,
      collectionId: true,
      createdAt: true,
    },
  });
  if (existingDesign) {
    console.log(`[process] dedup: design "${designName}" already exists (id=${existingDesign.id}), skipping create`);
    return NextResponse.json({ design: existingDesign }, { status: 200 });
  }

  const admin = createAdminClient();

  // ── (a) Download BMP from the public designs bucket ────────────────────────
  const { data: blob, error: downloadError } = await admin.storage
    .from(DESIGNS_BUCKET)
    .download(storagePath);

  if (downloadError || !blob) {
    console.error("Storage download error:", downloadError);
    return NextResponse.json(
      { error: "Could not retrieve uploaded BMP" },
      { status: 500 }
    );
  }

  const fileBuffer = Buffer.from(await blob.arrayBuffer());
  const isCtf = filename.toLowerCase().endsWith(".ctf");

  // Delete the uploaded object on validation/conversion failure so stale
  // placeholders don't linger in storage.
  const deleteSource = () => admin.storage.from(DESIGNS_BUCKET).remove([storagePath]);

  // ── (b) Validate + convert to PNG ─────────────────────────────────────────
  let pngBuffer: Buffer;
  let width: number;
  let height: number;

  if (isCtf) {
    try {
      ({ png: pngBuffer, width, height } = await ctfToPng(fileBuffer));
    } catch (err) {
      await deleteSource();
      console.error("CTF conversion error:", err);
      return NextResponse.json({ error: "Failed to parse CTF file" }, { status: 422 });
    }
  } else {
    // BMP validation
    if (fileBuffer.length < 54) {
      await deleteSource();
      return NextResponse.json({ error: "File too small to be a valid BMP" }, { status: 422 });
    }
    if (fileBuffer[0] !== 0x42 || fileBuffer[1] !== 0x4d) {
      await deleteSource();
      return NextResponse.json(
        { error: "Not a valid BMP file (missing BM signature)" },
        { status: 422 }
      );
    }
    try {
      ({ png: pngBuffer, width, height } = await bmpToPng(fileBuffer));
    } catch (err) {
      await deleteSource();
      console.error("BMP conversion error:", err);
      return NextResponse.json({ error: "Failed to convert BMP to PNG" }, { status: 422 });
    }
  }

  // ── (c) Extract palette, (d) Apply OneLoom lookup ─────────────────────────
  const rawPalette = await extractPalette(pngBuffer);

  // ── Build OneLoom lookup from DB ──────────────────────────────────────────
  // Use the db client that is statically imported at the top of this module
  // (proven to work for tenant/design queries) instead of the dynamic import
  // inside loadOneLoomLookup, which can silently return an empty Map when the
  // Prisma singleton was created before `prisma generate` added the new model.
  type LookupMap = Map<string, { code: string; catalogHex: string | null }>;
  let lookup: LookupMap = new Map();
  try {
    const rows = await db.colorLookup.findMany({
      where: { tenantId: tenant.id },
      select: { renderedHex: true, yarnCode: true, catalogHex: true },
    });
    lookup = new Map(
      rows.map((r) => [r.renderedHex.toLowerCase(), { code: r.yarnCode, catalogHex: r.catalogHex ?? null }])
    );
    // [DEBUG] (1) lookup size
    console.log(`[process] lookup loaded: ${lookup.size} entries`);
  } catch (err) {
    console.warn("[process] colorLookup query failed — proceeding without yarn codes:", err);
  }

  // [DEBUG] (2) first 3 palette hex values + spot-check against lookup
  const top3 = rawPalette.slice(0, 3).map(e => e.hex);
  console.log(`[process] palette top-3 hex: ${top3.join(", ")}`);
  top3.forEach(h => {
    const asIs = lookup.get(h);
    const lower = lookup.get(h.toLowerCase());
    console.log(`[process]   ${h} → as-is: ${asIs?.code ?? "–"}, lowercase: ${lower?.code ?? "–"}`);
  });

  const enriched = applyOneLoomLookup(rawPalette, lookup);

  // [DEBUG] (3) match count
  const matchCount = enriched.filter(e => e.code !== null).length;
  console.log(`[process] matched ${matchCount} / ${enriched.length} palette colors`);

  const palette: PaletteEntry[] = enriched.map(
    ({ index, hex, pixelCount, coverage, code }) => ({
      index,
      hex,
      pixelCount,
      percentage: coverage,
      ...(code !== null ? { matchedYarnCode: code } : {}),
    })
  );

  // ── Resolve slug and PNG storage path ──────────────────────────────────────
  const baseSlug = filenameToSlug(filename);
  const slug = await uniqueSlug(baseSlug);

  // PNG sits alongside the BMP in the same folder: designs/{slug}/{slug}.png
  const pngStoragePath = `${slug}/${slug}.png`;

  // ── (e) Upload PNG to public designs bucket ────────────────────────────────
  const { error: pngUploadError } = await admin.storage
    .from(DESIGNS_BUCKET)
    .upload(pngStoragePath, pngBuffer, { contentType: "image/png", upsert: true });

  if (pngUploadError) {
    console.error("PNG upload error:", pngUploadError);
    return NextResponse.json({ error: "Failed to store converted PNG" }, { status: 500 });
  }

  const imageUrl = getPublicUrl(DESIGNS_BUCKET, pngStoragePath);
  const sourceBmpUrl = getPublicUrl(DESIGNS_BUCKET, storagePath);

  // ── (f) Create Design row ──────────────────────────────────────────────────
  let design: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    sourceBmpUrl: string;
    width: number;
    height: number;
    isActive: boolean;
    isDemo: boolean;
    collectionId: string | null;
    createdAt: Date;
  };

  try {
    design = await db.design.create({
      data: {
        tenantId: tenant.id,
        name: designName,
        slug,
        imageUrl,
        sourceBmpUrl,
        width,
        height,
        palette,
        isActive: true,
        isDemo: false,
        uploadedById: null,
        ...(collectionId ? { collectionId } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        sourceBmpUrl: true,
        width: true,
        height: true,
        isActive: true,
        isDemo: true,
        collectionId: true,
        createdAt: true,
      },
    });
  } catch (err) {
    // ── (g) Rollback: delete both storage objects ──────────────────────────
    await admin.storage
      .from(DESIGNS_BUCKET)
      .remove([storagePath, pngStoragePath]);
    console.error("Design creation error:", err);
    return NextResponse.json({ error: "Failed to save design" }, { status: 500 });
  }

  // ── (h) Return created design ──────────────────────────────────────────────
  return NextResponse.json({ design }, { status: 201 });
}
