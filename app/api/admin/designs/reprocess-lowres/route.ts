// Admin-only: reprocess existing low-resolution designs by upscaling their
// PNG (imageUrl) to ~10 px/inch using nearest-neighbor interpolation.
// The original source file (sourceBmpUrl) is never modified.
//
// POST /api/admin/designs/reprocess-lowres
// Returns: { processed: number; skipped: number; results: [...] }

import { NextResponse } from "next/server";
import sharp from "sharp";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";
import {
  createAdminClient,
  DESIGNS_BUCKET,
  USER_DESIGNS_BUCKET,
  getPublicUrl,
} from "@/lib/supabase";

// ─── Rug dimension parsing ───────────────────────────────────────────────────

const FALLBACK_FEET = { widthFeet: 8, heightFeet: 10 };

function parseRugDimensions(
  name: string
): { widthFeet: number; heightFeet: number } | null {
  const match = name.match(/(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const a = parseFloat(match[1]);
  const b = parseFloat(match[2]);
  if (a >= 30 || b >= 30) return null;
  return { widthFeet: a, heightFeet: b };
}

const TARGET_PPI = 10;
const MIN_PPI = 8;

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST() {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const admin = createAdminClient();

  // Fetch all designs for this tenant
  const designs = await db.design.findMany({
    where: { tenantId: tenant.id },
    select: {
      id: true,
      name: true,
      imageUrl: true,
      sourceBmpUrl: true,
      width: true,
      height: true,
      uploadedById: true,
    },
  });

  const results: {
    id: string;
    name: string;
    action: "upscaled" | "skipped";
    reason?: string;
    oldSize?: string;
    newSize?: string;
    ppi?: number;
  }[] = [];

  let processed = 0;
  let skipped = 0;

  for (const design of designs) {
    const dims = parseRugDimensions(design.name) ?? FALLBACK_FEET;
    const ppiX = design.width / (dims.widthFeet * 12);
    const ppiY = design.height / (dims.heightFeet * 12);
    const ppi = Math.min(ppiX, ppiY);

    if (ppi >= MIN_PPI) {
      skipped++;
      results.push({
        id: design.id,
        name: design.name,
        action: "skipped",
        reason: `Already ${ppi.toFixed(1)} px/inch`,
        ppi: Math.round(ppi * 10) / 10,
      });
      continue;
    }

    // Determine which bucket the image lives in
    const isUserUpload = !!design.uploadedById;
    const bucket = isUserUpload ? USER_DESIGNS_BUCKET : DESIGNS_BUCKET;

    // Download the current PNG
    const imagePath = design.imageUrl;
    // imageUrl could be a full URL or a relative storage path
    let storagePath: string;
    if (imagePath.startsWith("https://")) {
      // Extract storage path from public URL
      // e.g. https://...supabase.co/storage/v1/object/public/designs/slug/slug.png → slug/slug.png
      const bucketPrefix = `/storage/v1/object/public/${bucket}/`;
      const idx = imagePath.indexOf(bucketPrefix);
      if (idx === -1) {
        skipped++;
        results.push({
          id: design.id,
          name: design.name,
          action: "skipped",
          reason: "Could not parse storage path from URL",
        });
        continue;
      }
      storagePath = decodeURIComponent(imagePath.slice(idx + bucketPrefix.length));
    } else {
      storagePath = imagePath;
    }

    const { data: blob, error: downloadErr } = await admin.storage
      .from(bucket)
      .download(storagePath);

    if (downloadErr || !blob) {
      console.error(`[reprocess] Download failed for ${design.name}:`, downloadErr);
      skipped++;
      results.push({
        id: design.id,
        name: design.name,
        action: "skipped",
        reason: `Download failed: ${downloadErr?.message ?? "no data"}`,
      });
      continue;
    }

    const pngBuffer = Buffer.from(await blob.arrayBuffer());
    const scale = TARGET_PPI / ppi;
    const newWidth = Math.round(design.width * scale);
    const newHeight = Math.round(design.height * scale);

    console.log(
      `[reprocess] ${design.name}: ${design.width}×${design.height} @ ${ppi.toFixed(1)} px/inch ` +
      `→ ${newWidth}×${newHeight} (${scale.toFixed(2)}×)`
    );

    // Upscale with nearest-neighbor to preserve indexed-color hard edges
    const upscaledPng = await sharp(pngBuffer)
      .resize(newWidth, newHeight, { kernel: sharp.kernel.nearest })
      .png()
      .toBuffer();

    // Upload the upscaled PNG (overwrite)
    const { error: uploadErr } = await admin.storage
      .from(bucket)
      .upload(storagePath, upscaledPng, { contentType: "image/png", upsert: true });

    if (uploadErr) {
      console.error(`[reprocess] Upload failed for ${design.name}:`, uploadErr);
      skipped++;
      results.push({
        id: design.id,
        name: design.name,
        action: "skipped",
        reason: `Upload failed: ${uploadErr.message}`,
      });
      continue;
    }

    // Update the design's dimensions in the database
    // (imageUrl path stays the same, just the content changed)
    await db.design.update({
      where: { id: design.id },
      data: { width: newWidth, height: newHeight },
    });

    processed++;
    results.push({
      id: design.id,
      name: design.name,
      action: "upscaled",
      oldSize: `${design.width}×${design.height}`,
      newSize: `${newWidth}×${newHeight}`,
      ppi: Math.round(ppi * 10) / 10,
    });
  }

  console.log(`[reprocess] Done. Upscaled: ${processed}, Skipped: ${skipped}`);

  return NextResponse.json({ processed, skipped, results });
}
