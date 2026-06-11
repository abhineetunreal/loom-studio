// Admin-only: delete a catalog design and its associated storage objects.
// User-uploaded designs (uploadedById !== null) are rejected — those belong
// to the user, not the catalog, and must be managed separately.
//
// DELETE /api/admin/designs/:id
// Returns: { ok: true }

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET } from "@/lib/supabase";

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
