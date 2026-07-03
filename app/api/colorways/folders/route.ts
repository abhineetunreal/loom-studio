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

  const isAdmin = tenantUser.role === "OWNER" || tenantUser.role === "ADMIN";

  const selectFields = {
    id: true,
    name: true,
    isPrivate: true,
    userId: true,
    createdAt: true,
    _count: { select: { colorways: true } },
  } as const;

  let folders;
  if (isAdmin) {
    // Admins see all tenant folders
    folders = await db.colorwayFolder.findMany({
      where: { tenantId: tenant.id },
      select: selectFields,
      orderBy: { name: "asc" },
    });
  } else {
    // Regular users: own folders + public folders + private folders with explicit access
    const session = await getSession();
    const email = session!.user.email!;
    folders = await db.colorwayFolder.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { userId: tenantUser.id },
          { isPrivate: false },
          {
            isPrivate: true,
            folderAccess: { some: { userEmail: email } },
          },
        ],
      },
      select: selectFields,
      orderBy: { name: "asc" },
    });
  }

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

  const isPrivate = body.isPrivate === true;

  try {
    const folder = await db.colorwayFolder.create({
      data: { tenantId: tenant.id, userId: tenantUser.id, name, isPrivate },
      select: { id: true, name: true, isPrivate: true, createdAt: true },
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A folder with that name already exists" }, { status: 409 });
  }
}
