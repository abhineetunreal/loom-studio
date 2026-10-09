// Admin-only: crop a region from an existing catalog design's original image,
// extract its palette, and create a new Design database row.
//
// POST /api/admin/designs/crop
// Body: { sourceDesignId: string; cropRect: {x,y,w,h}; name: string; collectionId?: string }
// Returns: { design }

import { NextRequest, NextResponse } from "next/server";
import { Jimp } from "jimp";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET, getPublicUrl } from "@/lib/supabase";
import { extractPalette, applyOneLoomLookup } from "@/lib/design-processing";
import type { PaletteEntry } from "@/types";

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

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
  let body: {
    sourceDesignId?: string;
    cropRect?: { x: number; y: number; w: number; h: number };
    name?: string;
    collectionId?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sourceDesignId, cropRect, name, collectionId } = body;
  if (!sourceDesignId || !cropRect || !name) {
    return NextResponse.json(
      { error: "sourceDesignId, cropRect, and name are required" },
      { status: 400 },
    );
  }

  // Validate crop rect
  const { x, y, w, h } = cropRect;
  if (w < 50 || h < 50) {
    return NextResponse.json(
      { error: "Crop region must be at least 50×50 pixels" },
      { status: 400 },
    );
  }

  // ── Tenant ─────────────────────────────────────────────────────────────────
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  // ── Load source design ─────────────────────────────────────────────────────
  const sourceDesign = await db.design.findFirst({
    where: { id: sourceDesignId, tenantId: tenant.id },
    select: { id: true, name: true, imageUrl: true, width: true, height: true, collectionId: true },
  });
  if (!sourceDesign) {
    return NextResponse.json({ error: "Source design not found" }, { status: 404 });
  }

  // Validate crop bounds against source design
  if (x < 0 || y < 0 || x + w > sourceDesign.width || y + h > sourceDesign.height) {
    return NextResponse.json(
      { error: "Crop region exceeds source design bounds" },
      { status: 400 },
    );
  }

  // ── Download and crop the source image ─────────────────────────────────────
  let croppedPng: Buffer;
  try {
    const img = await Jimp.read(sourceDesign.imageUrl);
    img.crop({ x, y, w, h });
    croppedPng = Buffer.from(await img.getBuffer("image/png"));
  } catch (err) {
    console.error("[CropDesign] Image crop failed:", err);
    return NextResponse.json({ error: "Failed to crop image" }, { status: 500 });
  }

  // ── Extract palette from cropped image ─────────────────────────────────────
  const rawPalette = await extractPalette(croppedPng);

  // ── Apply OneLoom lookup ───────────────────────────────────────────────────
  type LookupMap = Map<string, { code: string; catalogHex: string | null }>;
  let lookup: LookupMap = new Map();
  try {
    const rows = await db.colorLookup.findMany({
      where: { tenantId: tenant.id },
      select: { renderedHex: true, yarnCode: true, catalogHex: true },
    });
    lookup = new Map(
      rows.map((r) => [r.renderedHex.toLowerCase(), { code: r.yarnCode, catalogHex: r.catalogHex ?? null }]),
    );
  } catch (err) {
    console.warn("[CropDesign] colorLookup query failed:", err);
  }

  const enriched = applyOneLoomLookup(rawPalette, lookup);
  const palette: PaletteEntry[] = enriched.map(
    ({ index, hex, pixelCount, coverage, code }) => ({
      index,
      hex,
      pixelCount,
      percentage: coverage,
      ...(code !== null ? { matchedYarnCode: code } : {}),
    }),
  );

  // ── Upload cropped PNG to storage ──────────────────────────────────────────
  const baseSlug = nameToSlug(name);
  const slug = await uniqueSlug(baseSlug);
  const pngStoragePath = `tenants/${tenant.slug}/${slug}/${slug}.png`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(DESIGNS_BUCKET)
    .upload(pngStoragePath, croppedPng, { contentType: "image/png", upsert: true });

  if (uploadError) {
    console.error("[CropDesign] PNG upload error:", uploadError);
    return NextResponse.json({ error: "Failed to upload cropped PNG" }, { status: 500 });
  }

  const imageUrl = getPublicUrl(DESIGNS_BUCKET, pngStoragePath);

  // ── Create Design row ──────────────────────────────────────────────────────
  try {
    const design = await db.design.create({
      data: {
        tenantId: tenant.id,
        name,
        slug,
        imageUrl,
        sourceBmpUrl: "",
        width: w,
        height: h,
        palette,
        isActive: true,
        isDemo: false,
        uploadedById: null,
        ...(collectionId ? { collectionId } : sourceDesign.collectionId ? { collectionId: sourceDesign.collectionId } : {}),
      },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        width: true,
        height: true,
        collectionId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ design }, { status: 201 });
  } catch (err) {
    // Rollback: delete uploaded PNG
    await admin.storage.from(DESIGNS_BUCKET).remove([pngStoragePath]);
    console.error("[CropDesign] Design creation error:", err);
    return NextResponse.json({ error: "Failed to create design" }, { status: 500 });
  }
}
