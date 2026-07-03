import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

// ─── Shared admin auth helper ────────────────────────────────────────────────
async function resolveAdmin() {
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

  if (!tenantUser || (tenantUser.role !== "OWNER" && tenantUser.role !== "ADMIN")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { tenantUser, tenant };
}

// ─── GET /api/colorways/folders/[id]/access ──────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveAdmin();
  if ("error" in auth) return auth.error;

  const rows = await db.folderAccess.findMany({
    where: { folderId: id },
    select: { id: true, userEmail: true, createdAt: true },
    orderBy: { userEmail: "asc" },
  });

  return NextResponse.json({ access: rows });
}

// ─── PUT /api/colorways/folders/[id]/access ──────────────────────────────────
// Replaces the full access list with the provided emails.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await resolveAdmin();
  if ("error" in auth) return auth.error;
  const { tenant } = auth;

  const body = await request.json();
  const emails: string[] = Array.isArray(body.emails) ? body.emails : [];

  // Verify folder exists and belongs to this tenant
  const folder = await db.colorwayFolder.findFirst({
    where: { id, tenantId: tenant.id },
    select: { id: true },
  });
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  // Replace existing access rows
  await db.folderAccess.deleteMany({ where: { folderId: id } });

  if (emails.length > 0) {
    await db.folderAccess.createMany({
      data: emails.map((email) => ({
        folderId: id,
        userEmail: email,
        tenantId: tenant.id,
      })),
      skipDuplicates: true,
    });
  }

  const access = await db.folderAccess.findMany({
    where: { folderId: id },
    select: { id: true, userEmail: true, createdAt: true },
    orderBy: { userEmail: "asc" },
  });

  return NextResponse.json({ access });
}
