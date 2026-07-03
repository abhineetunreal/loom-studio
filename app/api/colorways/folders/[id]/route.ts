import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

// ─── Shared auth helper ───────────────────────────────────────────────────────
async function resolveUser() {
  const session = await getSession();
  if (!session?.user.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }

  const tenantUser = await db.tenantUser.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: session.user.email } },
    select: { id: true, role: true },
  });

  if (!tenantUser) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }

  if (tenantUser.role === "PENDING" || tenantUser.role === "DEMO") {
    return { error: NextResponse.json({ error: "Account not approved" }, { status: 403 }) };
  }

  return { tenantUser, tenant };
}

// ─── PUT /api/colorways/folders/[id] ─────────────────────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant } = auth;

  const isAdmin = tenantUser.role === "OWNER" || tenantUser.role === "ADMIN";

  // Admins can edit any tenant folder; regular users only their own
  const folder = await db.colorwayFolder.findFirst({
    where: isAdmin
      ? { id, tenantId: tenant.id }
      : { id, userId: tenantUser.id },
    select: { id: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const name: string = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const data: { name: string; isPrivate?: boolean } = { name };
  if (typeof body.isPrivate === "boolean") data.isPrivate = body.isPrivate;

  try {
    await db.colorwayFolder.update({ where: { id }, data });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }
}

// ─── DELETE /api/colorways/folders/[id] ──────────────────────────────────────
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant } = auth;

  const isAdmin = tenantUser.role === "OWNER" || tenantUser.role === "ADMIN";

  const folder = await db.colorwayFolder.findFirst({
    where: isAdmin
      ? { id, tenantId: tenant.id }
      : { id, userId: tenantUser.id },
    select: { id: true },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // onDelete: SetNull on the FK moves colorways to root automatically
  await db.colorwayFolder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
