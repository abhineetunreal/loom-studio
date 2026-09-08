import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
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

  // Check for admin "View as user" preview
  const isAdmin = tenantUser.role === "OWNER" || tenantUser.role === "ADMIN";
  const cookieStore = await cookies();
  const previewCookie = cookieStore.get("previewAsUser")?.value;
  const previewEmail = isAdmin && previewCookie ? previewCookie : null;

  return { tenantUser, tenant, previewEmail };
}

// ─── GET /api/colorways/folders ───────────────────────────────────────────────
export async function GET() {
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant, previewEmail } = auth;

  const selectFields = {
    id: true,
    name: true,
    isPrivate: true,
    userId: true,
    createdAt: true,
    _count: { select: { colorways: true } },
  } as const;

  let folders;

  if (previewEmail) {
    // Admin previewing as another user — show folders as the preview user would see them
    const previewUser = await db.tenantUser.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: previewEmail } },
      select: { id: true },
    });
    if (!previewUser) {
      return NextResponse.json({ folders: [] });
    }
    folders = await db.colorwayFolder.findMany({
      where: {
        tenantId: tenant.id,
        OR: [
          { userId: previewUser.id },
          { isPrivate: false },
          {
            isPrivate: true,
            folderAccess: { some: { userEmail: previewEmail } },
          },
        ],
      },
      select: selectFields,
      orderBy: { name: "asc" },
    });
  } else if (tenantUser.role === "OWNER" || tenantUser.role === "ADMIN") {
    // Admins (not previewing) see all tenant folders
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
  const { tenantUser, tenant, previewEmail } = auth;

  // Block writes during admin preview
  if (previewEmail) {
    return NextResponse.json({ error: "Read-only during preview" }, { status: 403 });
  }

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
