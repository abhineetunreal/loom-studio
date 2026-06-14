import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

// ─── PUT /api/colorways/folders/[id] ─────────────────────────────────────────
// Rename a folder (owner only).
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

  const folder = await db.colorwayFolder.findFirst({
    where: { id, userId: tenantUser.id },
    select: { id: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const name: string = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    await db.colorwayFolder.update({ where: { id }, data: { name } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }
}

// ─── DELETE /api/colorways/folders/[id] ──────────────────────────────────────
// Delete a folder. Colorways inside are moved to "no folder" (folderId → null).
export async function DELETE(
  _request: NextRequest,
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

  const folder = await db.colorwayFolder.findFirst({
    where: { id, userId: tenantUser.id },
    select: { id: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The FK onDelete: SetNull handles moving colorways to root automatically
  await db.colorwayFolder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
