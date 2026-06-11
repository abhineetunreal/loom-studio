// Processing route — called after the browser has PUT the BMP directly to
// Supabase Storage.  Downloads the BMP, validates it server-side, converts
// it to a web-ready PNG, extracts the pixel palette, uploads the PNG back
// to the private bucket, and creates the Design row.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getUser } from "@/lib/auth";
import { createAdminClient, getSignedUrl, USER_DESIGNS_BUCKET } from "@/lib/supabase";
import { bmpToPng, extractPalette } from "@/lib/design-processing";
import type { PaletteEntry } from "@/types";

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────
  const authUser = await getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // ── Permission ──────────────────────────────────────────────────────────
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true, canUpload: true },
  });
  if (!tenantUser?.canUpload) {
    return NextResponse.json({ error: "Upload permission denied" }, { status: 403 });
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: { storagePath?: string; filename?: string };
  try {
    body = (await request.json()) as { storagePath?: string; filename?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { storagePath, filename } = body;
  if (!storagePath || !filename) {
    return NextResponse.json({ error: "storagePath and filename are required" }, { status: 400 });
  }

  // Verify path belongs to this auth user — prevents one user from triggering
  // processing on another user's upload.
  if (!storagePath.startsWith(`${authUser.id}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // ── Download BMP from storage ────────────────────────────────────────────
  const { data: blob, error: downloadError } = await admin.storage
    .from(USER_DESIGNS_BUCKET)
    .download(storagePath);

  if (downloadError || !blob) {
    console.error("Storage download error:", downloadError);
    return NextResponse.json({ error: "Could not retrieve uploaded file" }, { status: 500 });
  }

  const bmpBuffer = Buffer.from(await blob.arrayBuffer());

  // ── Server-side BMP validation ───────────────────────────────────────────
  if (bmpBuffer.length < 54) {
    return NextResponse.json({ error: "File too small to be a valid BMP" }, { status: 422 });
  }
  if (bmpBuffer[0] !== 0x42 || bmpBuffer[1] !== 0x4d) {
    return NextResponse.json({ error: "Not a valid BMP file (missing BM signature)" }, { status: 422 });
  }

  // biBitCount is at DIB offset 14 → absolute offset 28, 2 bytes LE.
  const bitDepth = bmpBuffer.readUInt16LE(28);
  if (bitDepth > 8) {
    return NextResponse.json(
      {
        error: `This BMP is not palette-indexed (${bitDepth}bpp). Please export as an indexed BMP from your CAD software.`,
      },
      { status: 422 }
    );
  }

  // ── Convert BMP → PNG and extract palette ───────────────────────────────
  // For 8bpp indexed BMPs (the only format accepted here), bmpToPng falls
  // through to the jimp path — sharp does not support palette-indexed BMPs.
  let pngBuffer: Buffer;
  let width: number;
  let height: number;
  try {
    ({ png: pngBuffer, width, height } = await bmpToPng(bmpBuffer));
  } catch (err) {
    console.error("BMP conversion error:", err);
    return NextResponse.json({ error: "Failed to convert BMP to PNG" }, { status: 422 });
  }

  const palette: PaletteEntry[] = (await extractPalette(pngBuffer)).map(
    ({ index, hex, pixelCount, coverage }) => ({
      index,
      hex,
      pixelCount,
      percentage: coverage,
    })
  );

  // ── Upload converted PNG ─────────────────────────────────────────────────
  // Replace the .bmp suffix with .png so the two objects share a UUID stem.
  const pngPath = storagePath.replace(/\.bmp$/i, ".png");

  const { error: pngUploadError } = await admin.storage
    .from(USER_DESIGNS_BUCKET)
    .upload(pngPath, pngBuffer, { contentType: "image/png", upsert: true });

  if (pngUploadError) {
    console.error("PNG upload error:", pngUploadError);
    return NextResponse.json({ error: "Failed to store converted PNG" }, { status: 500 });
  }

  // ── Create Design record ─────────────────────────────────────────────────
  // imageUrl   → PNG path in user-designs (resolveDesignImageUrl converts to signed URL at render time)
  // sourceBmpUrl → original BMP path in user-designs
  // isActive: false → design is pending admin review before appearing in the catalog
  const name =
    filename
      .replace(/\.bmp$/i, "")
      .replace(/[-_]+/g, " ")
      .trim() || "Untitled";

  const slug = `upload-${crypto.randomUUID()}`;

  let design: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string;
    width: number;
    height: number;
    isActive: boolean;
    createdAt: Date;
  };

  try {
    design = await db.design.create({
      data: {
        tenantId: tenant.id,
        name,
        slug,
        imageUrl: pngPath,
        sourceBmpUrl: storagePath,
        width,
        height,
        palette,
        uploadedById: tenantUser.id,
        isActive: false,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        imageUrl: true,
        width: true,
        height: true,
        isActive: true,
        createdAt: true,
      },
    });
  } catch (err) {
    // Roll back both storage objects so we don't leave orphaned files.
    await admin.storage.from(USER_DESIGNS_BUCKET).remove([storagePath, pngPath]);
    console.error("Design creation error:", err);
    return NextResponse.json({ error: "Failed to save design" }, { status: 500 });
  }

  // Return the design with a pre-generated signed URL so the client can
  // display the thumbnail immediately without a second round-trip.
  const signedImageUrl = await getSignedUrl(USER_DESIGNS_BUCKET, pngPath);

  return NextResponse.json(
    { design: { ...design, imageUrl: signedImageUrl } },
    { status: 201 }
  );
}
