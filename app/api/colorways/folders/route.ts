import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";

// ─── GET /api/colorways/folders ───────────────────────────────────────────────
// List the current user's colorway folders.
export async function GET() {
  const authUser = await getUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
// Create a new folder.
export async function POST(request: NextRequest) {
  const authUser = await getUser();
  if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tenant = await getCurrentTenant();
  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true },
  });
  if (!tenantUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
