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

// ─── GET /api/colorways/folders ───────────────────────────────────────────────
export async function GET() {
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant } = auth;

  const folders = await db.colorwayFolder.findMany({
    where: { tenantId: tenant.id, userId: tenantUser.id },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { colorways: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ folders });
}

// ─── POST /api/colorways/folders ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant } = auth;

  const body = await request.json();
  const name: string = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const folder = await db.colorwayFolder.create({
      data: { tenantId: tenant.id, userId: tenantUser.id, name },
      select: { id: true, name: true, createdAt: true },
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }
}
