import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { getDefaultTierInfo } from "@/lib/tier";

// ─── Shared auth helper ───────────────────────────────────────────────────────
async function resolveUser() {
  const session = await getSession();
  if (!session?.user.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const email = session.user.email;

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { id: true, role: true },
  });

  if (!tenantUser) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }

  if (tenantUser.role === "PENDING" || tenantUser.role === "DEMO") {
    return { error: NextResponse.json({ error: "Account not approved" }, { status: 403 }) };
  }

  return { tenantUser, tenant, email };
}

// ─── PUT /api/colorways/[id] ──────────────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, email } = auth;

  const colorway = await db.savedColorway.findFirst({
    where: { id, tenantId: auth.tenant.id },
    select: { userEmail: true },
  });
  if (!colorway) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (colorway.userEmail !== email) {
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
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession();
  if (!session?.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email;

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    select: { id: true, role: true },
  });
  if (!tenantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const tierInfo = await getDefaultTierInfo();
  const isAdmin = tierInfo.tier === "admin";

  const colorway = await db.savedColorway.findFirst({
    where: { id, tenantId: tenant.id },
    select: { userEmail: true },
  });
  if (!colorway) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isAdmin && colorway.userEmail !== email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.savedColorway.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
