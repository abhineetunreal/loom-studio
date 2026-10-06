// Admin-only: manage a single share link.
//
// PATCH  /api/admin/share-links/:id — update share link fields
// DELETE /api/admin/share-links/:id — delete share link (cascades sessions/approvals)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDefaultTierInfo } from "@/lib/tier";
import { getCurrentTenant } from "@/lib/tenant";

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const { id } = await ctx.params;
  const body = await request.json() as {
    isActive?: boolean;
    allowedLibraries?: string[];
    presets?: { colorwayId: string; displayName: string }[];
  };

  // Verify link belongs to this tenant
  const existing = await db.shareLink.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (body.allowedLibraries) data.allowedLibraries = body.allowedLibraries as never;
  if (body.presets) data.presets = body.presets as never;

  const updated = await db.shareLink.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, shareLink: updated });
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { tier } = await getDefaultTierInfo();
  if (tier !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const { id } = await ctx.params;

  // Verify link belongs to this tenant
  const existing = await db.shareLink.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  // Cascade is handled by the DB (onDelete: Cascade on sessions and approvals)
  await db.shareLink.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
