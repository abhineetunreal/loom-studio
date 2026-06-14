// Admin-only: manage a single catalog design.
//
// PATCH /api/admin/designs/:id  — update externalSku
// DELETE /api/admin/designs/:id — delete design and storage objects

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";

// ─── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/admin/designs/[id]">
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await request.json() as { externalSku?: string | null };

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  // Normalize empty string to null
  const externalSku = body.externalSku?.trim() || null;

  try {
    const updated = await db.design.update({
      where: { id },
      data: { externalSku },
      select: { id: true, externalSku: true },
    });
    return NextResponse.json({ ok: true, externalSku: updated.externalSku });
  } catch (err: unknown) {
    // P2002 = unique constraint violation (another design has this SKU in the same tenant)
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json(
        { error: "This SKU is already used by another design in this catalog." },
        { status: 409 }
      );
    }
    throw err;
  }
}

// Extract the storage path from a public URL in the designs bucket.
// getPublicUrl returns something like:
//   https://<project>.supabase.co/storage/v1/object/public/designs/{slug}/{file}
// We need just the part after "/public/designs/".
function publicUrlToStoragePath(publicUrl: string): string | null {
  try {
    const url = new URL(publicUrl);
    // pathname: /storage/v1/object/public/{bucket}/{path}
    const prefix = `/storage/v1/object/public/${DESIGNS_BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) return null;
    return decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/admin/designs/[id]">
) {
  // ── Admin guard ────────────────────────────────────────────────────────────
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;

  // ── (a) Look up the design ─────────────────────────────────────────────────
  const design = await db.design.findUnique({
    where: { id },
    select: {
      id: true,
      imageUrl: true,
      sourceBmpUrl: true,
      uploadedById: true,
    },
  });

  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  // User-uploaded designs are off-limits — they belong to the uploader.
  if (design.uploadedById !== null) {
    return NextResponse.json(
      { error: "Cannot delete a user-uploaded design from the admin catalog endpoint" },
      { status: 403 }
    );
  }

  // ── (b) Delete associated SavedColorway rows ───────────────────────────────
  await db.savedColorway.deleteMany({ where: { designId: id } });

  // ── (c) Delete storage objects ─────────────────────────────────────────────
  // Collect storage paths from both the PNG and BMP public URLs.
  const pathsToDelete: string[] = [];

  const pngPath = publicUrlToStoragePath(design.imageUrl);
  if (pngPath) pathsToDelete.push(pngPath);

  const bmpPath = publicUrlToStoragePath(design.sourceBmpUrl);
  if (bmpPath) pathsToDelete.push(bmpPath);

  if (pathsToDelete.length > 0) {
    const admin = createAdminClient();
    const { error: storageError } = await admin.storage
      .from(DESIGNS_BUCKET)
      .remove(pathsToDelete);

    if (storageError) {
      // Log but don't abort — a missing storage object shouldn't block DB cleanup.
      console.warn("Storage deletion warning:", storageError.message);
    }
  }

  // ── (d) Delete the Design row ──────────────────────────────────────────────
  // SavedColorways are already gone; ColorwaySubmissions cascade on the design FK
  // is not set to Cascade in the schema, so we delete them explicitly first.
  await db.colorwaySubmission.deleteMany({ where: { designId: id } });
  await db.design.delete({ where: { id } });

  // ── (e) Return success ─────────────────────────────────────────────────────
  return NextResponse.json({ ok: true });
}
