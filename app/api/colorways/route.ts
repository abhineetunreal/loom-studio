import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/tenant";
import { createAdminClient } from "@/lib/supabase";

const SNAPSHOTS_BUCKET = process.env.SUPABASE_SNAPSHOTS_BUCKET ?? "snapshots";

// ─── Shared auth helper ───────────────────────────────────────────────────────
// Returns { tenantUser, email } or a NextResponse error to return immediately.
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
    select: { id: true, email: true, role: true },
  });

  if (!tenantUser) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }

  // Only APPROVED, ADMIN, and OWNER roles may save colorways
  if (tenantUser.role === "PENDING" || tenantUser.role === "DEMO") {
    return { error: NextResponse.json({ error: "Account not approved" }, { status: 403 }) };
  }

  return { tenantUser, tenant, email };
}

// ─── GET /api/colorways ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenant, email } = auth;

  const { searchParams } = new URL(request.url);
  const folderId = searchParams.get("folderId");

  const colorways = await db.savedColorway.findMany({
    where: {
      tenantId: tenant.id,
      userEmail: email,
      folderId: folderId ?? null,
    },
    select: {
      id: true,
      name: true,
      folderId: true,
      snapshotUrl: true,
      createdAt: true,
      updatedAt: true,
      design: { select: { id: true, name: true, imageUrl: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ colorways });
}

// ─── POST /api/colorways ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await resolveUser();
  if ("error" in auth) return auth.error;
  const { tenantUser, tenant, email } = auth;

  const body = await request.json();
  const { designId, name, operations, folderId, snapshotDataUrl } = body as {
    designId: string;
    name: string;
    operations: unknown;
    folderId?: string | null;
    snapshotDataUrl?: string | null;
  };

  if (!designId || !name?.trim()) {
    return NextResponse.json({ error: "designId and name are required" }, { status: 400 });
  }

  // Verify design belongs to this tenant
  const design = await db.design.findFirst({
    where: { id: designId, tenantId: tenant.id },
    select: { id: true },
  });
  if (!design) return NextResponse.json({ error: "Design not found" }, { status: 404 });

  // Validate folderId if provided
  if (folderId) {
    const folder = await db.colorwayFolder.findFirst({
      where: { id: folderId, userId: tenantUser.id },
      select: { id: true },
    });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  let colorway: { id: string };
  try {
    colorway = await db.savedColorway.create({
      data: {
        designId,
        userId: tenantUser.id,
        tenantId: tenant.id,
        name: name.trim(),
        userEmail: email,
        operations: (operations ?? {}) as never,
        colorMapping: {},
        folderId: folderId ?? null,
      },
      select: { id: true },
    });
    console.log(`[SaveColorway] SUCCESS email=${email} tenantId=${tenant.id} colorwayId=${colorway.id}`);
  } catch (err) {
    console.error(`[SaveColorway] FAILED email=${email} tenantId=${tenant.id}`, err);
    return NextResponse.json({ error: "Failed to save colorway" }, { status: 500 });
  }

  // Upload snapshot async (fire-and-forget)
  if (snapshotDataUrl) {
    uploadSnapshot(colorway.id, tenantUser.id, tenant.id, snapshotDataUrl)
      .then((url) => db.savedColorway.update({ where: { id: colorway.id }, data: { snapshotUrl: url } }))
      .catch((err) => console.error("Snapshot upload failed:", err));
  }

  return NextResponse.json({ id: colorway.id }, { status: 201 });
}

// ─── Snapshot upload ──────────────────────────────────────────────────────────
async function uploadSnapshot(
  colorwayId: string,
  userId: string,
  tenantId: string,
  dataUrl: string
): Promise<string> {
  const admin = createAdminClient();
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const storagePath = `colorways/${tenantId}/${userId}/${colorwayId}.png`;

  const { error } = await admin.storage
    .from(SNAPSHOTS_BUCKET)
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (error) throw new Error(`Snapshot upload failed: ${error.message}`);

  const { data } = admin.storage.from(SNAPSHOTS_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}
