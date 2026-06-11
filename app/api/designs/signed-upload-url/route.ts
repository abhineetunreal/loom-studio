// Returns a Supabase signed upload URL so the browser can PUT the BMP
// directly to Storage without routing the body through our server.
// (Vercel's 4.5 MB request body limit makes server-side relay impractical
// for large BMP files.)

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentTenant } from "@/lib/tenant";
import { getUser } from "@/lib/auth";
import { createAdminClient, USER_DESIGNS_BUCKET } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authUser = await getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // ── Permission ────────────────────────────────────────────────────────────
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 500 });
  }

  const tenantUser = await db.tenantUser.findFirst({
    where: { tenantId: tenant.id, authUserId: authUser.id },
    select: { id: true, canUpload: true },
  });
  if (!tenantUser?.canUpload) {
    return NextResponse.json({ error: "Upload permission denied" }, { status: 403 });
  }

  // ── Validate query param ──────────────────────────────────────────────────
  const filename = request.nextUrl.searchParams.get("filename") ?? "";
  if (!filename.toLowerCase().endsWith(".bmp")) {
    return NextResponse.json({ error: "filename must end with .bmp" }, { status: 400 });
  }

  // ── Generate storage path and signed URL ──────────────────────────────────
  // Path: {authUserId}/{uuid}.bmp — the authUserId prefix lets Supabase RLS
  // policies scope access per user without any extra metadata lookup.
  const storagePath = `${authUser.id}/${crypto.randomUUID()}.bmp`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(USER_DESIGNS_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error("createSignedUploadUrl error:", error);
    return NextResponse.json({ error: "Failed to create upload URL" }, { status: 500 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl, storagePath, token: data.token });
}
