// Admin-only: update a design's catalog colors (palette + thumbnail).
//
// POST /api/admin/designs/:id/update-catalog
//
// Body: { palette: PaletteEntry[], snapshotDataUrl: string }
//   - palette: the updated palette entries with new yarn codes and hex values
//   - snapshotDataUrl: base64 PNG of the recolored design (new thumbnail)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { createAdminClient, DESIGNS_BUCKET } from "@/lib/supabase";
import { getCurrentTenant } from "@/lib/tenant";
import { getSession } from "@/lib/auth";
import type { PaletteEntry } from "@/types";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  // ── Admin guard ──────────────────────────────────────────────────────────────
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await ctx.params;

  const body = await request.json() as {
    palette: PaletteEntry[];
    snapshotDataUrl: string;
  };

  if (!body.palette || !Array.isArray(body.palette)) {
    return NextResponse.json({ error: "palette is required" }, { status: 400 });
  }
  if (!body.snapshotDataUrl || typeof body.snapshotDataUrl !== "string") {
    return NextResponse.json({ error: "snapshotDataUrl is required" }, { status: 400 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  // ── Look up the design ─────────────────────────────────────────────────────
  const design = await db.design.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true, slug: true, imageUrl: true, name: true },
  });

  if (!design) {
    return NextResponse.json({ error: "Design not found" }, { status: 404 });
  }

  // ── Upload new thumbnail ───────────────────────────────────────────────────
  const admin = createAdminClient();
  const base64 = body.snapshotDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  // Use the same path convention as the original design PNG
  const storagePath = `${tenant.slug}/${design.slug}.png`;

  const { error: uploadError } = await admin.storage
    .from(DESIGNS_BUCKET)
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (uploadError) {
    console.error("[UpdateCatalog] Thumbnail upload failed:", uploadError.message);
    return NextResponse.json(
      { error: "Failed to upload new thumbnail" },
      { status: 500 }
    );
  }

  // Get the public URL for the new thumbnail (with cache-bust)
  const { data: urlData } = admin.storage.from(DESIGNS_BUCKET).getPublicUrl(storagePath);
  const newImageUrl = urlData.publicUrl;

  // ── Get current user email for audit ───────────────────────────────────────
  const session = await getSession();
  const updatedBy = session?.user?.email ?? "unknown";

  // ── Update the Design record ───────────────────────────────────────────────
  await db.design.update({
    where: { id },
    data: {
      palette: body.palette as unknown as never,
      imageUrl: newImageUrl,
      catalogUpdatedBy: updatedBy,
      catalogUpdatedAt: new Date(),
    },
  });

  console.log(
    `[UpdateCatalog] Design "${design.name}" (${id}) catalog colors updated by ${updatedBy}`
  );

  return NextResponse.json({ ok: true, imageUrl: newImageUrl });
}
