import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";

// ─── PUT /api/colorways/[id] ──────────────────────────────────────────────────
// Update name, folderId, or operations of a saved colorway (owner only).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authUser = await getUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const colorway = await db.savedColorway.findFirst({
    where: { id, tenantId: tenant.id },
    select: { userId: true },
  });
  if (!colorway) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (colorway.userId !== tenantUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, folderId, operations } = body as {
    name?: string;
    folderId?: string | null;
    operations?: unknown;
  };

  if (folderId !== undefined && folderId !== null) {
    const folder = await db.colorwayFolder.findFirst({
      where: { id: folderId, userId: tenantUser.id },
      select: { id: true },
    });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  await db.savedColorway.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(folderId !== undefined ? { folderId } : {}),
      ...(operations !== undefined ? { operations: operations as never } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

// ─── DELETE /api/colorways/[id] ───────────────────────────────────────────────
// Delete a saved colorway (owner or admin).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authUser = await getUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const tierInfo = await getDefaultTierInfo();
  const isAdmin = tierInfo.tier === "admin";

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const colorway = await db.savedColorway.findFirst({
    where: { id, tenantId: tenant.id },
    select: { userId: true },
  });
  if (!colorway) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin && colorway.userId !== tenantUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.savedColorway.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
